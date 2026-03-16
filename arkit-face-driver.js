/**
 * arkit-face-driver.js
 *
 * Routes all 52 ARKit blend shape names to the correct mechanism on a
 * VALID-derived VRM model loaded in Babylon.js.
 *
 * Mechanisms:
 *   morph_direct  — shape key already exists by ARKit name in H_DDS_HighRes
 *   morph_alias   — shape exists under an h_expressions.* name (unmapped in cleanup script)
 *   morph_approx  — closest available h_expressions.* shape (approximation)
 *   eye_bone      — drive leftEye / rightEye VRM humanoid bones
 *   none          — tongueOut: no tongue mesh, no-op
 */

// ---------------------------------------------------------------------------
// Morph target routing
// ---------------------------------------------------------------------------
// Direct ARKit names already present in the CLEANED model:
const MORPH_DIRECT = [
  'eyeBlinkLeft','eyeBlinkRight','eyeWideLeft','eyeWideRight',
  'eyeSquintLeft','eyeSquintRight',
  'jawOpen','jawForward','jawLeft','jawRight',
  'mouthClose','mouthFunnel','mouthPucker','mouthLeft','mouthRight',
  'mouthSmileLeft','mouthSmileRight','mouthFrownLeft','mouthFrownRight',
  'mouthDimpleLeft','mouthDimpleRight','mouthStretchLeft','mouthStretchRight',
  'mouthUpperUpLeft','mouthUpperUpRight','mouthLowerDownLeft','mouthLowerDownRight',
  'mouthPressLeft','mouthPressRight',
  'browDownLeft','browDownRight','browInnerUp','browOuterUpLeft','browOuterUpRight',
  'cheekPuff','noseSneerLeft','noseSneerRight',
];

// ARKit name → existing h_expressions.* morph target name (unmapped aliases)
const MORPH_ALIAS = {
  cheekSquintLeft:  'h_expressions.LlowLid_h',
  cheekSquintRight: 'h_expressions.RlowLid_h',
};

// ARKit name → closest h_expressions.* morph target (approximations)
const MORPH_APPROX = {
  mouthRollLower:  'h_expressions.JawCompress_h',
  mouthRollUpper:  'h_expressions.MPB_Up_h',
  mouthShrugLower: 'h_expressions.Chin_h',
  mouthShrugUpper: 'h_expressions.Shout_h',
};

// Eye look shapes — resolved to bone rotations
const EYE_LOOK_SHAPES = [
  'eyeLookDownLeft','eyeLookDownRight',
  'eyeLookInLeft',  'eyeLookInRight',
  'eyeLookOutLeft', 'eyeLookOutRight',
  'eyeLookUpLeft',  'eyeLookUpRight',
];

// Teeth morph targets coupled to face shapes.
// Use base names (no mesh prefix) — the morphMap registers both 't_X' and
// 'h_teeth.t_X' forms, so this resolves on both Busi and Casual models.
//
// Rule: only jaw-bone shapes drive the teeth mesh.  Soft-tissue lip shapes
// (mouthLowerDownLeft/Right) do NOT drive the teeth — in real anatomy those
// shapes move the lower lip skin, not the jaw or teeth.  Coupling them to
// t_MouthOpen_h causes the gum line to become visible (too much teeth travel).
// Multiple shapes can share the same teeth target; influence is accumulated
// (summed, clamped to 1) so all contributors are correct simultaneously.
const TEETH_COUPLING = {
  jawOpen:     't_MouthOpen_h',
  mouthFunnel: 't_Shout_h',
  mouthClose:  't_MPB_h',
  jawLeft:     't_Ljaw_h',
  jawRight:    't_Rjaw_h',
  jawForward:  't_JawFront_h',
};

// Per-shape weight for teeth coupling (defaults to 1.0 if not listed).
const TEETH_COUPLING_WEIGHT = {};

// Scale applied to the FACE morph influence before setting it on H_DDS_HighRes.
// Keeps lower-lip shapes from pushing the lip below the lower gum line.
// The lower gum should never be visible during normal speech.
// 1.0 = full ARKit strength; reduce if the lower gum line becomes visible.
const MORPH_FACE_SCALE = {
  // Lower-lip-down: limited to ~35% so the lip reveals lower teeth (natural)
  // without ever dropping past the gum line.  Raise toward 0.5 if you want
  // more visible lower-lip movement and the gum stays hidden.
  mouthLowerDownLeft:  0.35,
  mouthLowerDownRight: 0.35,
  mouthShrugLower:     0.5,   // MORPH_APPROX → h_expressions.Chin_h also pulls lip down
};

// Max eye rotation in radians (~20°).  Signs are: positive pitch = look down,
// negative pitch = look up; for left eye positive yaw = look right (= inward).
// Flip these if test screenshots show inverted direction.
const MAX_EYE_PITCH = 0.35;
const MAX_EYE_YAW   = 0.35;

// ---------------------------------------------------------------------------
// Mechanism map (exported for test labeling)
// ---------------------------------------------------------------------------
const MECHANISM = {};
for (const n of MORPH_DIRECT)              MECHANISM[n] = 'morph_direct';
for (const n of Object.keys(MORPH_ALIAS))  MECHANISM[n] = 'morph_alias';
for (const n of Object.keys(MORPH_APPROX)) MECHANISM[n] = 'morph_approx';
for (const n of EYE_LOOK_SHAPES)           MECHANISM[n] = 'eye_bone';
MECHANISM['tongueOut'] = 'none';

// ---------------------------------------------------------------------------
// ARKitFaceDriver
// ---------------------------------------------------------------------------
export class ARKitFaceDriver {

  /**
   * @param {object} vrmManager  — scene.metadata.vrmManagers[0]
   * @param {object} scene       — BABYLON.Scene (unused currently, reserved)
   */
  constructor(vrmManager, scene) {
    this._scene = scene;

    // Build morph target map from all relevant meshes.
    // Register each target under both its full name and its unprefixed name so
    // that 'h_teeth.t_MouthOpen_h' (Casual) and 't_MouthOpen_h' (Busi) both resolve.
    this._morphMap = new Map();
    const meshNames = ['H_DDS_HighRes', 'h_TeethDown', 'h_TeethUp'];
    for (const name of meshNames) {
      const mesh = scene.getMeshByName(name);
      const mgr  = mesh?.morphTargetManager;
      if (!mgr) continue;
      for (let i = 0; i < mgr.numTargets; i++) {
        const t = mgr.getTarget(i);
        this._morphMap.set(t.name, t);
        // Also register without mesh-name prefix (e.g. 'h_teeth.foo' → 'foo')
        const dot = t.name.indexOf('.');
        if (dot !== -1) this._morphMap.set(t.name.slice(dot + 1), t);
      }
    }

    // Eye bones from VRM humanoid map
    this._leftEye  = vrmManager.humanoidBone['leftEye']  ?? null;
    this._rightEye = vrmManager.humanoidBone['rightEye'] ?? null;

    // Capture initial rotations to use as base
    this._initialLeftEyeRot  = this._leftEye?.rotationQuaternion?.clone()  ?? BABYLON.Quaternion.Identity();
    this._initialRightEyeRot = this._rightEye?.rotationQuaternion?.clone() ?? BABYLON.Quaternion.Identity();

    // ── Diagnostic ────────────────────────────────────────────────────────────
    console.group('[ARKitFaceDriver] init');
    console.log('morphMap size:', this._morphMap.size);

    // Report meshes not found
    for (const name of meshNames) {
      if (!scene.getMeshByName(name)) console.warn('  mesh NOT found:', name);
    }

    // Report each morph-direct shape that has no target
    const missing = MORPH_DIRECT.filter(n => !this._morphMap.has(n));
    if (missing.length) console.warn('  MORPH_DIRECT missing targets:', missing);
    else                console.log('  all MORPH_DIRECT targets found ✓');

    // Report teeth coupling resolution
    console.group('  TEETH_COUPLING');
    const seenTeethTargets = new Set();
    for (const [shape, targetName] of Object.entries(TEETH_COUPLING)) {
      const w = TEETH_COUPLING_WEIGHT[shape] ?? 1.0;
      const wStr = w !== 1.0 ? ` (×${w})` : '';
      if (this._morphMap.has(targetName)) console.log(`  ${shape}${wStr} → "${targetName}" ✓`);
      else                                console.warn(`  ${shape}${wStr} → "${targetName}" NOT FOUND`);
      seenTeethTargets.add(targetName);
    }
    console.groupEnd();

    // Report eye bones
    console.log('  leftEye bone:', this._leftEye?.name ?? 'NOT FOUND');
    console.log('  rightEye bone:', this._rightEye?.name ?? 'NOT FOUND');
    console.groupEnd();
    // ── End diagnostic ────────────────────────────────────────────────────────

    // Current values for all 52 shapes (needed for eye accumulation)
    this._values = {};
    for (const name of Object.keys(MECHANISM)) this._values[name] = 0;
  }

  /** Set a single ARKit shape weight (clamped 0–1). */
  set(name, value) {
    if (!(name in MECHANISM)) return;
    this._values[name] = Math.max(0, Math.min(1, value));
    this._flush(name);
  }

  /** Zero every shape and reset eye bones to initial pose. */
  reset() {
    for (const name of Object.keys(this._values)) this._values[name] = 0;
    for (const [, mt] of this._morphMap) mt.influence = 0;
    if (this._leftEye)  this._leftEye.rotationQuaternion  = this._initialLeftEyeRot.clone();
    if (this._rightEye) this._rightEye.rotationQuaternion = this._initialRightEyeRot.clone();
  }

  /** Static mechanism map for test labeling. */
  static get MECHANISM() { return MECHANISM; }

  // ── private ──────────────────────────────────────────────────────────────

  _flush(name) {
    const mech = MECHANISM[name];

    if (mech === 'morph_direct') {
      const faceScale = MORPH_FACE_SCALE[name] ?? 1.0;
      this._setMorph(name, this._values[name] * faceScale);
      // Teeth coupling — only jaw-bone shapes; re-sum all contributors to the
      // same target so simultaneous shapes accumulate correctly.
      const teethName = TEETH_COUPLING[name];
      if (teethName) {
        let total = 0;
        for (const [n, t] of Object.entries(TEETH_COUPLING)) {
          if (t === teethName) {
            // Use the applied face value (raw × MORPH_FACE_SCALE) so teeth
            // track actual lip position rather than the raw JSON value.
            const appliedVal = this._values[n] * (MORPH_FACE_SCALE[n] ?? 1.0);
            total += appliedVal * (TEETH_COUPLING_WEIGHT[n] ?? 1.0);
          }
        }
        this._setMorph(teethName, Math.min(1, total));
      }
      return;
    }

    if (mech === 'morph_alias') {
      this._setMorph(MORPH_ALIAS[name], this._values[name]);
      return;
    }

    if (mech === 'morph_approx') {
      const faceScale = MORPH_FACE_SCALE[name] ?? 1.0;
      this._setMorph(MORPH_APPROX[name], this._values[name] * faceScale);
      return;
    }

    if (mech === 'eye_bone') {
      this._updateEyes();
      return;
    }
    // 'none' — tongueOut: silent no-op
  }

  _setMorph(morphName, value) {
    const mt = this._morphMap.get(morphName);
    if (mt) mt.influence = value;
  }

  _updateEyes() {
    const v = this._values;

    // Inverted pitch: (down - up) so that 'up' weight results in negative X rotation (look up in GLTF/BJS)
    const pitchL = (v.eyeLookDownLeft  - v.eyeLookUpLeft)  * 0.25;
    const yawL   = (v.eyeLookInLeft    - v.eyeLookOutLeft)   * 0.25;

    const pitchR = (v.eyeLookDownRight - v.eyeLookUpRight) * 0.25;
    const yawR   = (v.eyeLookOutRight  - v.eyeLookInRight)   * 0.25;

    if (this._leftEye) {
      const delta = BABYLON.Quaternion.RotationYawPitchRoll(yawL, pitchL, 0);
      this._leftEye.rotationQuaternion = delta.multiply(this._initialLeftEyeRot);
    }
    if (this._rightEye) {
      const delta = BABYLON.Quaternion.RotationYawPitchRoll(yawR, pitchR, 0);
      this._rightEye.rotationQuaternion = delta.multiply(this._initialRightEyeRot);
    }
  }
}
