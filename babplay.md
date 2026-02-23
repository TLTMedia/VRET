# babplay — Implementation Spec

Concrete build plan for the Babylon.js multi-actor play system.
Reference `play.md` for architecture rationale and BJSE assessment.

---

## Current State (already built)

| File | What it does |
|---|---|
| `src/app.ts` — `VrmaPlayer` | Single actor VRMA retargeting — body bones only |
| `babvrm.html` | Single actor, random animation picker, `animations.json` |
| `arkit_bab.html` | ARKit morph target cycling on CLEANED models |
| `index.html` + Vite | TypeScript dev environment, Puppeteer-tested |

---

## Phase 1 — Multi-Actor Body (`babplay.html`)

**Goal**: Two VRM actors at different positions, each playing a different VRMA simultaneously.

### Files to create

```
src/Actor.ts          — wraps VrmaPlayer, owns position + root node
src/PlayController.ts — loads scene JSON, spawns actors, runs clock
scenes/test_scene.json — two-actor test script
babplay.html          — standalone demo (Live Server, no build step)
```

### `Actor` class

```typescript
class Actor {
  id: string
  rootNode: BABYLON.TransformNode   // position/rotation in world space
  player: VrmaPlayer

  async load(vrmUrl: string, pos: {x,y,z}, rot: {y: number})
  async animate(vrmaUrl: string, loop: boolean)
  async animateWithFace(vrmaUrl: string, a2fJsonUrl: string, loop: boolean)
  stop()
  dispose()
}
```

### `PlayController` class

```typescript
class PlayController {
  actors: Map<string, Actor>
  clock: number                     // seconds since play()

  async loadScript(url: string)     // fetch + parse scene JSON
  async preload()                   // load all VRMs before play()
  play()                            // start clock + fire timeline events
  pause()
  seek(t: number)
  stop()
}
```

### `scenes/test_scene.json`

```json
{
  "metadata": { "title": "Two Actors Test" },
  "actors": [
    { "id": "alice", "vrm": "models/AliciaSolid.vrm",
      "startPosition": {"x": -1, "y": 0, "z": 0},
      "startRotation": {"y": 0} },
    { "id": "bob",   "vrm": "models/AliciaSolid.vrm",
      "startPosition": {"x":  1, "y": 0, "z": 0},
      "startRotation": {"y": 0} }
  ],
  "timeline": [
    { "start": 0, "actor": "alice", "action": "animate",
      "clip": "vrma/02_01.vrma", "loop": true },
    { "start": 0, "actor": "bob",   "action": "animate",
      "clip": "vrma/111_37.vrma", "loop": true }
  ]
}
```

### Key fix required for multi-actor `VrmaPlayer`

Currently `VrmaPlayer.play()` does:
```typescript
scene.metadata.vrmAnimationManagers = [];  // ← BREAKS multi-actor
```
Each VRMA load appends to `vrmAnimationManagers`. With multiple actors this
clears the other actors' managers. Fix: record array length before loading,
grab the newly-appended entry by index after loading. Do NOT clear globally.

---

## Phase 2 — JSON Timeline

`PlayController` fires timeline events at clock time:
- `animate` — call `actor.animate(clip, loop)`
- `move`    — tween `actor.rootNode.position` over duration
- `stop`    — call `actor.stop()`

---

## Phase 3 — Morph Proxy (A2F facial)

Extend `VrmaPlayer.play()` with optional `a2fJsonUrl` parameter.
A2F JSON format (from Audio2Face blendshape export):
```json
{
  "fps": 30,
  "facsNames": ["eyeBlinkLeft", "jawOpen", ...],
  "weightMat": [[0.0, 0.1, ...], ...]   // [frame][shapeIndex]
}
```

Each morph target gets a `BABYLON.Animation` on `.influence` and is added
to the **same** `AnimationGroup` as the bone tracks — one `start()` drives
both body and face in perfect sync.

Target meshes: `H_DDS_HighRes`, `h_TeethDown`, `h_TeethUp` (CLEANED models only).

---

## Phase 4 — UI

- Timeline scrubber (`input[type=range]` → `playController.seek(t)`)
- Actor labels (floating `BABYLON.GUI.TextBlock` above each actor's head)
- Log console (on-screen div showing timeline events as they fire)

---

## Implementation Order

1. Fix `VrmaPlayer` multi-actor manager isolation bug
2. Create `Actor.ts` wrapping fixed `VrmaPlayer`
3. Create `PlayController.ts` with `loadScript` + `preload` + `play`
4. Create `scenes/test_scene.json`
5. Create `babplay.html` wiring it all together
6. Puppeteer test: both actors animating, `window.playReady === true`
7. Phase 2: add `move` and timeline clock
8. Phase 3: morph proxy with sample A2F JSON

---

## Test for Phase 1 Success

```
Two VRM actors visible in scene
Each playing a different VRMA simultaneously
No T-pose glitch, no loop glitch
window.playReady === true after both load
```
