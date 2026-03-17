# VRMA Sequential Player — Blend Bug Fix

## The Problem

`vrmaAll.html` plays 2548 VRMA animations in sequence with a 1-second crossfade between each.
The symptom: after every transition, the avatar snapped to a **T-pose** (arms out, no motion)
instead of smoothly continuing into the new animation.

The visual effect should be:

```
Animation A (exit) → 1s smooth crossfade → Animation B (entry) → B plays normally
```

What was actually happening:

```
Animation A (exit) → 1s crossfade into T-pose → T-pose holds indefinitely
```

---

## Root Cause Diagnosis

The transition system has three stages:

1. **Capture** — before loading animation B, record the exit pose of animation A
2. **Blend** — manually lerp bone rotations from exit pose → entry pose over 1 second
3. **Play** — start animation B playing from its first real motion frame

Each stage had its own bug.

---

## Bug 1: `findMotionFrame` — Wrong Reference Frame

### What `findMotionFrame` does

Many VRMA files embed a **T-pose reference frame at frame 0** before the real animation
begins. If we start blending toward frame 0, the avatar morphs into a T-pose during
the crossfade — the opposite of what we want.

`findMotionFrame()` scans the first 12 frames of a new animation to find the first
frame with real motion, skipping any leading T-pose frames.

### The broken scoring formula

The original approach scored each frame by:

```js
score = Σ(1 − |q.w|)   // for each bone's quaternion
```

This measures how far each quaternion is from **identity** (the mathematical T-pose,
where all bones have `w=1`). A true T-pose scores ≈ 0; a motion pose scores high.

### Why it failed

The AIAN model's natural **standing bind-pose** has non-identity quaternions — in
particular, the leg bones have `w ≈ 0` (representing ~90° rotations for the standing
stance). This is a *model-specific* property, not a T-pose in the classical sense.

So even at frame 0 of any animation, the score was already high (≈ 4.5) and immediately
exceeded the threshold. `findMotionFrame` always returned frame 0 — which is often the
T-pose reference frame it was supposed to skip.

### The fix

Instead of measuring distance from mathematical identity, measure distance **from the
animation's own frame 0**:

```js
// Capture frame 0 as the animation's reference pose
group.goToFrame(group.from);
const refQuats = new Map();
for (const [, b] of animBones) {
  if (b?.rotationQuaternion) refQuats.set(b, b.rotationQuaternion.clone());
}

// Score subsequent frames by how much they diverge from frame 0
for (let f = group.from + 1; f <= limit; f++) {
  group.goToFrame(f);
  let score = 0;
  for (const [, b] of animBones) {
    const q = b?.rotationQuaternion;
    const r = refQuats.get(b);
    if (q && r) {
      const dot = Math.abs(q.x*r.x + q.y*r.y + q.z*r.z + q.w*r.w);
      score += 1 - dot;  // 0 = identical to frame 0, positive = has diverged
    }
  }
  ...
}
```

**Why this works:** If frame 0 is a T-pose reference, frames 1–3 will also score near 0
(still in T-pose), and frame 4 will score high when the actual motion begins. If frame 0
is already a valid motion frame (no reference T-pose), no subsequent frame will score
significantly higher — so `bestFrame` stays at `group.from` and we return frame 0, which
is correct.

The key insight: **we don't care what the pose looks like in absolute terms, only whether
the animation has started moving relative to its own starting position.**

---

## Bug 2: `start()` on an Already-Started Group

### The blend pipeline

When a new animation loads, the code does this setup:

```js
remapped.start(false, 1.0, remapped.from, remapped.to, false);  // creates animatables
remapped.pause();                                                  // freeze the clock
const motionFrom = findMotionFrame(remapped);                     // seek to best frame
_startPose = capturePose();                                        // record entry pose
```

`start()` must be called first because `AnimationGroup.goToFrame()` is a no-op without
`_animatables` (the internal array Babylon creates when you start an animation). After
`pause()`, `findMotionFrame()` can seek through frames with `goToFrame()` and the bones
actually update.

Then 1 second later, when the blend completes:

```js
// BROKEN:
remapped.start(false, 1.0, motionFrom, remapped.to, false);
```

### Why this failed

Babylon.js's `AnimationGroup.start()` behaves differently depending on whether
`_animatables` already exists:

- **No animatables** → creates fresh ones from the specified `from` parameter ✓
- **Animatables already exist** (paused from the setup step) → reuses the existing
  paused animatables, **ignoring the new `from` parameter entirely**

The paused animatables were created with `remapped.from` (often frame 0). Calling
`start()` again just resumed them from frame 0, snapping the avatar to T-pose
immediately after the blend.

### The fix

Explicitly dispose the animatables with `stop()` before calling `start()`:

```js
// FIXED:
remapped.stop();                                                   // dispose animatables
remapped.start(false, 1.0, motionFrom, remapped.to, false);       // create fresh ones
```

After `stop()`, `_animatables` is empty. The subsequent `start()` creates new
animatables using the specified `motionFrom` as their starting frame.

---

## Bug 3 (Earlier Fix): `play()` vs `start()`

An even earlier version used `play()` at blend-end:

```js
remapped.goToFrame(motionFrom);
remapped.play();   // BROKEN
```

`AnimationGroup.play()` in Babylon 8.x is equivalent to `restart()` — it resets the
animation to `from` (frame 0) unconditionally, regardless of where `goToFrame()` left
things. This was the original source of the T-pose snap. It was replaced with `start()`,
which then revealed Bug 2.

---

## The Test: Detecting False Positives

The Puppeteer test (`vrmaAll_trans_test.mjs`) samples the blend at t=0, 0.25, 0.5, 0.75,
1.0 and then measures the live animation. It originally had a single check:

```js
// Old check — INSUFFICIENT
const tPoseScore = Σ(1 − |q.w|) across all bones
if (tPoseScore < 0.05) → "⚠ T-POSE"
```

This failed as a false positive because the AIAN model's standing pose scores ≈ 4.5
(non-identity quaternions) — so the check always passed even when exit ≈ entry (the
blend had no visual effect).

### New check 1: Trivial blend detection

```js
const maxBlendDiff = max bone angle between exit (t=0) and entry (t=1)
if (maxBlendDiff < 5°) → FAIL: "blend is trivial — poses are identical"
```

If exit ≈ entry, the crossfade was morphing between two copies of the same pose —
meaning `findMotionFrame` returned a wrong frame (often the same bind-pose as the
previous animation's exit).

### New check 2: Animation progress

After blend-end, sample the live pose at +0ms and again at +200ms:

```js
const maxBoneChange = max rotation diff across all bones (frame0 vs +200ms)
const hipsDelta     = world position change of hips in 200ms

if (maxBoneChange < 0.5° AND hipsDelta < 0.001) → FAIL: "animation appears static"
```

Uses a combined metric because slow animations (e.g. a seated "channel surfing" pose)
may show < 2° bone rotation change in 200ms but still have measurable position movement.
If EITHER metric shows change, the animation is playing.

---

## Summary of Fixes

| Bug | Symptom | Root Cause | Fix |
|-----|---------|-----------|-----|
| `findMotionFrame` identity scoring | Returned frame 0 (T-pose reference) | `Σ(1−\|q.w\|)` exceeded threshold immediately on non-identity bind-pose | Score frames relative to animation's own frame 0 |
| `start()` reusing animatables | Animation played from wrong frame | `start()` on group with existing animatables ignores new `from` param | `stop()` first to dispose animatables, then `start()` |
| `play()` at blend-end | T-pose snap at end of crossfade | `play()` ≡ `restart()` in Babylon 8, resets to frame 0 | Use `start(false, 1.0, motionFrom, to, false)` |
| T-pose score false positive | Test always passed even when broken | `Σ(1−\|q.w\|)` non-zero for standing pose | Added trivial blend check + animation progress check |

### Final verified results

```
══ Trivial blend check ═══════════════════════════════════════════
  ✓ max diff = 173.7°, avg = 17.32° — poses are meaningfully different

══ Animation progress check ══════════════════════════════════════
  ✓ animation progressing — max bone = 11°, hips delta = 0.0045 in 200ms

══ World-position continuity ═════════════════════════════════════
  t=0    x=0.8787  z=-2.3574
  t=0.25 x=0.8787  z=-2.3574  ✓
  t=0.5  x=0.8787  z=-2.3574  ✓
  t=0.75 x=0.8787  z=-2.3574  ✓
  t=1    x=0.8787  z=-2.3574  ✓
  live   x=0.8785  z=-2.3581  ✓ (< 0.001 drift)
```
