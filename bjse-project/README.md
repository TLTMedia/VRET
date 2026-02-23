# VRM Play System — Babylon.js Editor Integration

## What this is

These files let you use VRM avatars and VRMA animations inside a Babylon.js Editor
project. The editor handles the scene visually; the scripts handle the avatars.

## Setup steps

### 1. Create a new Babylon.js Editor project
Download and open [Babylon.js Editor](https://editor.babylonjs.com/).
File → New Project.

### 2. Copy source files
Copy these into your BJSE project's `src/` folder:
```
src/VrmaPlayer.ts       (from VRE/src/)
src/Actor.ts            (from VRE/src/)
src/PlayController.ts   (from VRE/src/)
src/vrm-startup.ts      (from VRE/bjse-project/src/)
```

### 3. Copy assets
Copy into your project's `public/` folder:
```
models/AliciaSolid.vrm   (or any VRM)
vrma/02_01.vrma          (or any VRMA)
scenes/test_scene.json
```

### 4. Set up the scene in BJSE
- Add lights, environment, camera — whatever you like visually
- Add a **TransformNode**, name it `VRMStage`
- In Inspector → Add Script → select `src/vrm-startup.ts`
- Set the `scriptUrl` property to `scenes/test_scene.json`

### 5. Press Play
The VRM actors will load and animate. The BJSE timeline controls
everything else (cameras, environment, non-VRM objects).

---

## What you can edit in BJSE

| ✅ Use BJSE for | ❌ Do NOT use BJSE for |
|---|---|
| Environment, sky, ground | VRMA keyframe editing |
| Lights and shadows | Actor animation sequencing |
| Camera paths and moves | VRM bone retargeting |
| Non-VRM scene objects | Changing which VRMA plays when |

## VRM Cast Plugin (recommended)

Instead of editing JSON by hand, use the **VRM Cast Plugin** (`VRE/bjse-plugin/`)
to build your cast visually inside the editor.

### Install the plugin

```bash
cd VRE/bjse-plugin
npm install
npm run build
```

### Register in BJSE

1. Open your BJSE project
2. **Edit → Project... → Plugins tab**
3. Click **"From local disk"** → select the `VRE/bjse-plugin/build/` folder
4. A **"VRM Cast"** tab appears next to the Assets Browser

### Use the panel

- **↺ Scan** — finds all `.vrm` in `public/models/` and `.vrma` in `public/vrma/`
- **+ Add Actor** — pick a VRM model, set position/rotation, assign a starting clip
- **+ Add Event** — schedule a clip change at a later time (seconds)
- **Export cast.json** — writes `public/scenes/cast.json`

Point `vrm-startup.ts`'s `scriptUrl` property at `scenes/cast.json` and press Play.

During development the plugin hot-reloads: rebuild with `npm run build` (or
`npm run watch`) and the panel refreshes in ~3.5 seconds without restarting BJSE.

---

## Editing actor timing manually

If you prefer JSON directly, edit `scenes/cast.json` (or `scenes/test_scene.json`):
```json
{ "start": 4.5, "actor": "bob", "action": "animate",
  "clip": "vrma/111_37.vrma", "loop": true }
```

## Why VRMA is not editable in the BJSE timeline

VRMA retargeting requires a coordinate-space correction
(`-qx, qy, -qz, qw`) that cannot be expressed as keyframe curves.
The humanoid bone mapping is also resolved at runtime by the VRM loader.
See `play.md` §6 for the full technical explanation.
