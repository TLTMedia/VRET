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

// Teeth morph targets coupled to face shapes
const TEETH_COUPLING = {
  jawOpen:     'h_teeth.t_MouthOpen_h',
  mouthFunnel: 'h_teeth.t_Shout_h',
  mouthClose:  'h_teeth.t_MPB_h',
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

    // Build morph target map from all relevant meshes
    this._morphMap = new Map();
    const meshNames = ['H_DDS_HighRes', 'h_TeethDown', 'h_TeethUp'];
    for (const name of meshNames) {
      const mesh = scene.getMeshByName(name);
      const mgr  = mesh?.morphTargetManager;
      if (!mgr) continue;
      for (let i = 0; i < mgr.numTargets; i++) {
        const t = mgr.getTarget(i);
        this._morphMap.set(t.name, t);
      }
    }

    // Eye bones from VRM humanoid map
    this._leftEye  = vrmManager.humanoidBone['leftEye']  ?? null;
    this._rightEye = vrmManager.humanoidBone['rightEye'] ?? null;

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

  /** Zero every shape and reset eye bones to identity. */
  reset() {
    for (const name of Object.keys(this._values)) this._values[name] = 0;
    for (const [, mt] of this._morphMap) mt.influence = 0;
    const id = BABYLON.Quaternion.Identity();
    if (this._leftEye)  this._leftEye.rotationQuaternion  = id.clone();
    if (this._rightEye) this._rightEye.rotationQuaternion = id.clone();
  }

  /** Static mechanism map for test labeling. */
  static get MECHANISM() { return MECHANISM; }

  // ── private ──────────────────────────────────────────────────────────────

  _flush(name) {
    const mech = MECHANISM[name];

    if (mech === 'morph_direct') {
      this._setMorph(name, this._values[name]);
      // Teeth coupling
      const teethName = TEETH_COUPLING[name];
      if (teethName) this._setMorph(teethName, this._values[name]);
      return;
    }

    if (mech === 'morph_alias') {
      this._setMorph(MORPH_ALIAS[name], this._values[name]);
      return;
    }

    if (mech === 'morph_approx') {
      this._setMorph(MORPH_APPROX[name], this._values[name]);
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

    // Left eye: In = yaw right (toward nose), Out = yaw left
    const pitchL = (v.eyeLookUpLeft    - v.eyeLookDownLeft)  * MAX_EYE_PITCH;
    const yawL   = (v.eyeLookInLeft    - v.eyeLookOutLeft)   * MAX_EYE_YAW;

    // Right eye: In = yaw left (toward nose), Out = yaw right
    const pitchR = (v.eyeLookUpRight   - v.eyeLookDownRight) * MAX_EYE_PITCH;
    const yawR   = (v.eyeLookOutRight  - v.eyeLookInRight)   * MAX_EYE_YAW;

    if (this._leftEye) {
      this._leftEye.rotationQuaternion =
        BABYLON.Quaternion.RotationYawPitchRoll(yawL, pitchL, 0);
    }
    if (this._rightEye) {
      this._rightEye.rotationQuaternion =
        BABYLON.Quaternion.RotationYawPitchRoll(yawR, pitchR, 0);
    }
  }
}
