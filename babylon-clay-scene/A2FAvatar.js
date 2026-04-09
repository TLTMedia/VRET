/**
 * A2FAvatar — drop-in animated VRM avatar for Babylon.js
 *
 * Usage:
 *   import { A2FAvatar } from './A2FAvatar.js';
 *
 *   const avatar = new A2FAvatar(scene);
 *   await avatar.loadManifest('scene.json');
 *   await avatar.playSequence();           // plays all clips in order
 *   // or
 *   await avatar.playClip(0);             // play a single clip by index
 *   avatar.stopAndReset();
 */

// ─── Teeth morph targets driven alongside face shapes ────────────────────────
const TEETH_MAP = {
  jawOpen:     'h_teeth.t_MouthOpen_h',
  mouthFunnel: 'h_teeth.t_Shout_h',
  mouthClose:  'h_teeth.t_MPB_h',
};

// ─── State machine ───────────────────────────────────────────────────────────
const State = Object.freeze({
  UNLOADED:     'unloaded',
  IDLE:         'idle',
  PLAYING:      'playing',
  TRANSITIONING:'transitioning',
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function buildMorphMap(mesh) {
  const map = new Map();
  const mgr = mesh?.morphTargetManager;
  if (!mgr) return map;
  for (let i = 0; i < mgr.numTargets; i++) {
    const t = mgr.getTarget(i);
    map.set(t.name, t);
  }
  return map;
}

function lerp(a, b, t) {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/**
 * Returns a promise that resolves the next time conditionFn() returns true,
 * checked once per Babylon render frame.
 *
 * Uses a persistent observer (add, not addOnce) that removes itself when done.
 * Since _tick was registered first (during construction), this handler always
 * runs AFTER _tick in the same frame — so it sees any flag _tick just set.
 * No re-registration during iteration = no infinite loop risk.
 */
function waitUntil(scene, conditionFn) {
  return new Promise((resolve) => {
    const observer = scene.onBeforeRenderObservable.add(() => {
      if (conditionFn()) {
        scene.onBeforeRenderObservable.remove(observer);
        resolve();
      }
    });
  });
}

// ─── Main class ──────────────────────────────────────────────────────────────
export class A2FAvatar {

  constructor(scene) {
    this.scene = scene;

    // Mesh / morph state
    this.faceMesh      = null;
    this.faceMap        = new Map();
    this.teethDownMap   = new Map();
    this.teethUpMap     = new Map();

    // Root node (set after VRM load, for positioning)
    this.rootNode       = null;

    // Manifest data
    this.manifest       = null;
    this.clips          = [];

    // Playback state
    this.state          = State.UNLOADED;
    this.currentClipIdx = -1;
    this.playbackTime   = 0;
    this.audio          = null;

    // Completion flag — set by _tickTransition, polled by waitUntil in playClip
    this._clipDone      = false;
    this._aborted       = false;

    // Idle state
    this.idleConfig     = { blinkIntervalMin: 2, blinkIntervalMax: 5, blinkDuration: 0.15,
                            breathCycleSpeed: 0.4, breathJawAmount: 0.012 };
    this.nextBlinkAt    = 0;
    this.blinkTimer     = -1;
    this.idleElapsed    = 0;

    // Transition state
    this.transitionDuration  = 0.25;
    this.transitionElapsed   = 0;
    this.transitionSnapshot  = null;

    // All shapes we've ever touched (for cleanup)
    this.allTouchedShapes = new Set();

    // Event callbacks (optional, set from outside)
    this.onStateChange  = null;
    this.onClipStart    = null;
    this.onClipEnd      = null;
    this.onSequenceEnd  = null;

    // Register render tick — the SINGLE driver for all animation
    this._tickRef = this._tick.bind(this);
    this.scene.onBeforeRenderObservable.add(this._tickRef);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Loading
  // ═══════════════════════════════════════════════════════════════════════════

  async loadManifest(manifestPath) {
    const resp = await fetch(manifestPath);
    if (!resp.ok) throw new Error(`Failed to load manifest: HTTP ${resp.status}`);
    this.manifest = await resp.json();

    if (this.manifest.idle) {
      Object.assign(this.idleConfig, this.manifest.idle);
    }

    await this._loadVRM(this.manifest.avatar);

    this.clips = [];
    for (const entry of this.manifest.clips) {
      const animResp = await fetch(entry.animation);
      if (!animResp.ok) throw new Error(`Failed to load animation ${entry.animation}: HTTP ${animResp.status}`);
      const animData = await animResp.json();
      this.clips.push({ animData, audioSrc: entry.audio, id: entry.id, delayAfter: entry.delayAfter ?? 1.0 });
    }

    this._setState(State.IDLE);
    return this;
  }

  async _loadVRM(vrmPath) {
    // VRM is GLTF-based — use the standard GLTF loader (registered via @babylonjs/loaders/glTF)
    // by passing pluginExtension: ".glb". No CDN VRM loader needed.
    const result = await BABYLON.ImportMeshAsync(vrmPath, this.scene, { pluginExtension: ".glb" });
    this.rootNode = result.meshes[0] || null;

    this.faceMesh      = this.scene.getMeshByName('H_DDS_HighRes');
    const teethDown    = this.scene.getMeshByName('h_TeethDown');
    const teethUp      = this.scene.getMeshByName('h_TeethUp');

    this.faceMap       = buildMorphMap(this.faceMesh);
    this.teethDownMap  = buildMorphMap(teethDown);
    this.teethUpMap    = buildMorphMap(teethUp);

    if (!this.faceMesh) {
      console.error('[A2FAvatar] H_DDS_HighRes mesh not found. Available meshes:',
        this.scene.meshes.map(m => m.name));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Shape application
  // ═══════════════════════════════════════════════════════════════════════════

  _applyShape(name, value) {
    const ft = this.faceMap.get(name);
    if (ft) ft.influence = value;

    const teethName = TEETH_MAP[name];
    if (teethName) {
      const td = this.teethDownMap.get(teethName);
      const tu = this.teethUpMap.get(teethName);
      if (td) td.influence = value;
      if (tu) tu.influence = value;
    }

    this.allTouchedShapes.add(name);
  }

  _resetAllShapes() {
    for (const name of this.allTouchedShapes) {
      this._applyShape(name, 0);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Playback controls
  // ═══════════════════════════════════════════════════════════════════════════

  /** Play every clip in sequence, with idle loops between them. */
  async playSequence() {
    this._aborted = false;

    for (let i = 0; i < this.clips.length; i++) {
      if (this._aborted) break;
      console.log("Playing clip:");
      await this.playClip(i);
      console.log("Clip played!");

      if (this._aborted) break;

      const delay = this.clips[i].delayAfter;
      if (delay > 0 && i < this.clips.length - 1) {
        await this._idleFor(delay);
      }
    }

    this._setState(State.IDLE);
    if (this.onSequenceEnd) this.onSequenceEnd();
  }

  /**
   * Play a single clip by index.
   *
   * Flow (no stored resolve — uses flag + same-loop polling):
   *   1. Load audio, reset _clipDone flag, set state PLAYING, start audio
   *   2. _tick → _tickPlaying runs each render frame, applying weights
   *   3. When clip ends, _tickPlaying → _startTransition() → state TRANSITIONING
   *   4. _tick → _tickTransition blends to neutral, then sets _clipDone = true
   *   5. waitUntil (addOnce on same observable, fires AFTER _tick) sees flag → resolves
   */
  async playClip(index) {
    if (index < 0 || index >= this.clips.length) return;

    const clip = this.clips[index];
    this.currentClipIdx = index;

    // Load audio
    this.audio = null;
    if (clip.audioSrc) {
      try {
        this.audio = new Audio(clip.audioSrc);
        this.audio.preload = 'auto';
        await new Promise((res, rej) => {
          this.audio.addEventListener('canplaythrough', res, { once: true });
          this.audio.addEventListener('error', () => rej(new Error('Audio load failed')), { once: true });
        });
      } catch (e) {
        console.warn(`[A2FAvatar] Audio failed for clip "${clip.id}":`, e.message);
        this.audio = null;
      }
    }

    // Reset state
    this.playbackTime = 0;
    this._clipDone = false;

    // Go
    this._setState(State.PLAYING);
    if (this.onClipStart) this.onClipStart(index, clip.id);
    if (this.audio){
      console.log("Audio is valid!!");
      this.audio.play();
    }

    // Block until the transition after this clip completes.
    // waitUntil checks once per render frame, on the same observable as _tick.
    await waitUntil(this.scene, () => this._clipDone || this._aborted);
  }

  /** Stop everything, reset to idle. */
  stopAndReset() {
    this._aborted = true;
    this._clipDone = true;   // unblock any waiting playClip
    if (this.audio) { this.audio.pause(); this.audio = null; }
    this._resetAllShapes();
    this._setState(State.IDLE);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Idle
  // ═══════════════════════════════════════════════════════════════════════════

  /** Idle for a duration, using the same render-observable polling. */
  _idleFor(seconds) {
    this._setState(State.IDLE);
    const deadline = performance.now() + seconds * 1000;
    return waitUntil(this.scene, () => performance.now() >= deadline || this._aborted);
  }

  _tickIdle(dt) {
    this.idleElapsed += dt;
    const cfg = this.idleConfig;

    // Breathing
    const breathVal = (Math.sin(this.idleElapsed * cfg.breathCycleSpeed * Math.PI * 2) + 1) * 0.5;
    this._applyShape('jawOpen', breathVal * cfg.breathJawAmount);

    // Blinking
    if (this.blinkTimer < 0) {
      if (this.idleElapsed >= this.nextBlinkAt) {
        this.blinkTimer = 0;
      }
    }

    if (this.blinkTimer >= 0) {
      this.blinkTimer += dt;
      const t = this.blinkTimer / cfg.blinkDuration;

      if (t <= 1.0) {
        const blinkWeight = t < 0.5 ? t * 2 : (1 - t) * 2;
        this._applyShape('eyeBlinkLeft', blinkWeight);
        this._applyShape('eyeBlinkRight', blinkWeight);
      } else {
        this._applyShape('eyeBlinkLeft', 0);
        this._applyShape('eyeBlinkRight', 0);
        this.blinkTimer = -1;
        this.nextBlinkAt = this.idleElapsed +
          cfg.blinkIntervalMin + Math.random() * (cfg.blinkIntervalMax - cfg.blinkIntervalMin);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Transition (blend current pose → neutral)
  // ═══════════════════════════════════════════════════════════════════════════

  _startTransition() {
    const names = [];
    const weights = [];
    for (const name of this.allTouchedShapes) {
      const ft = this.faceMap.get(name);
      if (ft && ft.influence > 0.001) {
        names.push(name);
        weights.push(ft.influence);
      }
    }
    this.transitionSnapshot = { names, weights };
    this.transitionElapsed = 0;
    this._setState(State.TRANSITIONING);
  }

  _tickTransition(dt) {
    this.transitionElapsed += dt;
    const t = Math.min(1, this.transitionElapsed / this.transitionDuration);

    const snap = this.transitionSnapshot;
    for (let i = 0; i < snap.names.length; i++) {
      this._applyShape(snap.names[i], lerp(snap.weights[i], 0, t));
    }

    this._tickIdle(dt);

    if (t >= 1) {
      this.transitionSnapshot = null;
      this._setState(State.IDLE);
      this._clipDone = true;   // ← the ONLY signal — no stored resolve to call
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Clip playback
  // ═══════════════════════════════════════════════════════════════════════════

  _tickPlaying(dt) {
    const clip = this.clips[this.currentClipIdx];
    if (!clip) return;

    const animData = clip.animData;

    if (this.audio) {
      //console.log(`AUDIO TIMESTAMP ${this.audio.currentTime}`);
      this.playbackTime = this.audio.currentTime;
    } else {
      this.playbackTime += dt;
    }

    const duration = animData.frameCount / animData.fps;
    const frameIdx = Math.floor(this.playbackTime * animData.fps);
    const pastLastFrame = frameIdx >= animData.frames.length;
    const audioEnded = this.audio ? this.audio.ended : false;

    //console.log(`OUT OF DURATION TOTAL ${duration}`);
    if (this.playbackTime >= duration || audioEnded || pastLastFrame) {
      if (this.audio) { this.audio.pause(); this.audio = null; }
      if (this.onClipEnd) this.onClipEnd(this.currentClipIdx, clip.id);
      this._startTransition();
      return;
    }

    const frame = animData.frames[Math.min(frameIdx, animData.frames.length - 1)];
    if (!frame) return;

    const names = animData.blendShapeNames;
    const weights = frame.weights;
    for (let i = 0; i < names.length; i++) {
      this._applyShape(names[i], weights[i] || 0);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Main tick
  // ═══════════════════════════════════════════════════════════════════════════

  _lastTickMs = performance.now();

  _tick() {
    const now = performance.now();
    const dt = (now - this._lastTickMs) / 1000;
    this._lastTickMs = now;

    switch (this.state) {
      case State.IDLE:
        this._tickIdle(dt);
        break;
      case State.PLAYING:
        this._tickPlaying(dt);
        break;
      case State.TRANSITIONING:
        this._tickTransition(dt);
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  State management
  // ═══════════════════════════════════════════════════════════════════════════

  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    if (this.onStateChange) this.onStateChange(s, this.currentClipIdx);
  }

  dispose() {
    this.stopAndReset();
    this.scene.onBeforeRenderObservable.removeCallback(this._tickRef);
  }
}