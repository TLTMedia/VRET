# Proposal: VRE "Play" System (Machinima Engine)

A system for creating multi-character performances (plays/machinima) built on **Babylon.js**.
A-Frame is retired from this roadmap. Babylon.js Editor (BJSE) is a long-shot integration goal — see §6.

---

## 1. Core Concept: The Script

A **Scene Script** (JSON) defines the entire performance — actors, positions, animation timeline, speech.

### Example: `scene_01.json`
```json
{
  "metadata": {
    "title": "The Encounter",
    "description": "A hero meets a stranger in the park",
    "environment": "forest"
  },
  "actors": [
    {
      "id": "hero",
      "vrm": "models/Asian/Asian_F_1_Casual.vrm",
      "startPosition": {"x": 0, "y": 0, "z": 5},
      "startRotation": {"y": 180}
    },
    {
      "id": "stranger",
      "vrm": "models/Black/Black_M_1_Busi.vrm",
      "startPosition": {"x": 2, "y": 0, "z": 0},
      "startRotation": {"y": 0}
    }
  ],
  "timeline": [
    {
      "start": 0.0,
      "actor": "hero",
      "action": "animate",
      "clip": "vrma/02_01.vrma",
      "loop": true,
      "duration": 4.0,
      "description": "Walking forward"
    },
    {
      "start": 0.0,
      "actor": "hero",
      "action": "move",
      "to": {"x": 0, "y": 0, "z": 1},
      "duration": 4.0
    },
    {
      "start": 4.5,
      "actor": "stranger",
      "action": "animate",
      "clip": "vrma/111_37.vrma",
      "description": "Wave"
    },
    {
      "start": 5.0,
      "actor": "stranger",
      "action": "speak",
      "audio": "audio/houston.wav",
      "lipSync": "audio/houston.json",
      "text": "Hello! Welcome to the VRM Environment."
    }
  ]
}
```

---

## 2. Technical Architecture (Babylon.js)

### `PlayController` — the brain
A plain TypeScript class (not tied to any framework) that:
- Loads the JSON script
- Spawns and positions `Actor` instances
- Runs a global clock via `scene.onBeforeRenderObservable`
- Exposes `play()`, `pause()`, `seek(t)`, `stop()`

### `Actor` — the performer
Wraps `VrmaPlayer` (already built) and adds:
- Position/rotation state
- Animation blending via `BABYLON.AnimationGroup` weight lerp
- `speak()` — coordinates audio + lip-sync morph targets

### `TimelineEngine` — scheduling
Pure utility class:
- Parses the script into sorted event queues per actor
- Fires events at the right clock time
- Pre-loads all VRM + VRMA assets before `play()` is enabled

### Animation blending
Babylon.js `AnimationGroup` supports `.weight` (0–1). Cross-fade between clips
by lerping out the outgoing group and lerping in the incoming group over N frames —
no Three.js AnimationMixer needed.

---

## 3. Facial Animation — Two Pipelines

This is a key architectural split discovered during development:

| Channel | Source | Target | Status |
|---|---|---|---|
| **Body** | VRMA clips | Humanoid bones (all VRMs) | ✅ Working |
| **VRM expressions** | VRMA expression channel | VRM BlendShapeProxy (joy, angry, A, I…) | ✅ For VRoid/CC0 avatars |
| **ARKit 52 shapes** | Live face tracking (MediaPipe/iPhone) | CLEANED model morph targets | 🔧 Separate pipeline |

**CLEANED models** have ARKit 52 blend shapes (`eyeBlinkLeft`, `jawOpen`…) instead of VRM expressions.
VRMA expression data cannot drive them directly. For CLEANED models, facial animation requires
a live tracking feed or a pre-recorded ARKit stream — a separate integration from VRMA playback.

For the `speak` action, lip-sync visemes map to:
- VRoid/CC0 models → VRM expression clips (A, I, U, E, O)
- CLEANED models → ARKit shapes (`jawOpen`, `mouthSmile`…) via custom mapper

---

## 4. Avatar Strategy

| Use case | Avatar source | License | Facial |
|---|---|---|---|
| Demo / contribution | AliciaSolid.vrm | MIT (virtual-cast test suite) | VRM expressions |
| Open production | ToxSam CC0 collection (300+) | CC0 | VRM expressions |
| High-fidelity VR | CLEANED models | Proprietary | ARKit |

---

## 5. Implementation Roadmap

1. **Phase 1 — Multi-actor body**: Load two VRMs, play two VRMAs simultaneously via `VrmaPlayer`.
2. **Phase 2 — JSON script parser**: `TimelineEngine` fires `animate` and `move` events from the script.
3. **Phase 3 — Speech**: `speak` action — audio playback + viseme-driven lip-sync.
4. **Phase 4 — UI**: On-screen timeline scrubber, actor labels, log console (Director's View).
5. **Phase 5 (long-shot) — BJSE**: Package as a Babylon.js Editor plugin (see §6).

---

## 6. Babylon.js Editor — Honest Assessment

### Scenes
Unity has `SceneManager` — load/unload scenes additively, each scene is a discrete asset.

**BJSE does not have this.** Each BJSE project has one `scene.babylon` file.
Multiple "scenes" are handled by manually disposing the current scene and loading a new one in code:
```ts
scene.dispose();
scene = await BABYLON.LoadAssetContainerAsync("scene2/scene.babylon", engine);
```
There is no built-in scene manager, no additive loading, no cross-scene references.

### The Animation Timeline — What It Can and Cannot Do

BJSE has an animation timeline. It is **not usable for VRMA editing**. Here is why:

| Capability | BJSE Timeline | Our PlayController |
|---|---|---|
| Edit camera moves | ✅ | — |
| Animate scene objects (doors, lights…) | ✅ | — |
| Import VRMA and play it | ✅ (via our code as a script) | ✅ |
| **Edit** VRMA keyframes | ❌ | ❌ (edit in source tool) |
| Retarget animation onto VRM bones | ❌ | ✅ |
| Sequence actors across a timeline | ❌ | ✅ (JSON script) |

**Why VRMA is not editable in BJSE:**
1. **Targets are runtime-only** — VRM humanoid bones are created dynamically by the VRM loader. They never exist in the `.babylon` scene file the editor manages. The timeline has nothing to attach to.
2. **Retargeting is code-only** — correcting VRMA quaternions (`-qx, qy, -qz, qw`) and position (`-vx, vy, -vz`) requires a code transform. A keyframe editor stores raw values and has no concept of coordinate space correction.
3. **No VRM import in BJSE** — the VRM loader is injected via CDN `<script>` at runtime. BJSE cannot open `.vrm` files as assets.
4. **AnimationGroups from external files are ephemeral** — loading a VRMA at runtime produces an `AnimationGroup` that is not saved back into the `.editorproject` on the next open.

**The correct mental model — same as Unity + Mecanim:**
> You do not edit motion capture clips in Unity's timeline. You import `.anim` files and wire them up in code/Animator. BJSE is the same: import via code, play via code, edit in the source tool.

### Full Pipeline

```
Source tools (Blender / Unity+UniVRM / MotionBuilder)
        │  author & export
        ▼
  .vrma files  ──────────────────────────────────────────────┐
        │  VrmaPlayer retargets onto VRM bones at runtime    │
        ▼                                                    │
  PlayController  ◄── scene_01.json (actor timing/speech)   │
        │                                                    │
        ▼                                                    │
  BJSE scene  ◄── visual set dressing: environment,         │
   (.babylon)      cameras, lights, world objects            │
        │          BJSE timeline drives world, not actors ───┘
        ▼
  Final render / VR experience
```

**What BJSE is used for in this project:**
- Visually place and position environment assets
- Design camera paths and cinematics for scene-level objects
- Export `.babylon` scene files consumed by the runtime
- TypeScript scripting with hot-reload during development

**What BJSE is NOT used for:**
- Editing VRMA animation clips (use source DCC tool)
- Sequencing actor timelines (use `scene_01.json` + `PlayController`)
- Any VRM bone retargeting (all code, always)

**Near-term**: standalone Vite + TypeScript app (already scaffolded) is the right target.
BJSE integration is a Phase 5+ stretch goal once the core play system is proven.

---

*This system transforms the VRE from a model viewer into a creative engine for storytelling and performance.*
