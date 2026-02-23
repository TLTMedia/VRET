/**
 * app.ts — Babylon.js VRM + VRMA player (Vite entry point)
 *
 * Babylon.js and babylon-vrm-loader are loaded via CDN in index.html.
 * VrmaPlayer, Actor, and PlayController are proper TS modules importable
 * into any project including Babylon.js Editor (see bjse-project/).
 *
 * Coordinate space rules (all three must hold simultaneously):
 *   1. Camera alpha = -π/2  → avatar faces -Z, camera at -Z sees the front
 *   2. Rotation keyframes   → conjugate by 180°Y: (-qx, qy, -qz, qw)
 *   3. Hips position        → pre-negate X and Z before __root__ applies its flip
 */

export { VrmaPlayer } from './VrmaPlayer';
export { Actor }      from './Actor';
export { PlayController } from './PlayController';

const B = (window as any).BABYLON as typeof import("@babylonjs/core");

async function init() {
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.id = "renderCanvas";
  document.body.appendChild(canvas);

  const engine = new B.Engine(canvas, true);
  engine.setHardwareScalingLevel(1);
  const scene = new B.Scene(engine);

  // Camera — avatar faces -Z; alpha=-π/2 puts camera at -Z → sees front
  const camera = new B.ArcRotateCamera(
    "cam", -Math.PI / 2, Math.PI / 2 - 0.12, 5,
    new B.Vector3(0, 0.9, 0), scene
  );
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 0.5;
  camera.upperRadiusLimit = 15;

  new B.HemisphericLight("hemi", new B.Vector3(0, 1, 0), scene);
  const dir = new B.DirectionalLight("dir", new B.Vector3(-1, -2, -1), scene);
  dir.intensity = 0.5;

  (window as any).animationReady = false;

  // AliciaSolid.vrm — freely available from virtual-cast/babylon-vrm-loader test suite
  await B.ImportMeshAsync("models/AliciaSolid.vrm", scene);
  const vrmManager = scene.metadata?.vrmManagers?.[0];
  if (!vrmManager) throw new Error("VRM manager not found");

  const { VrmaPlayer } = await import('./VrmaPlayer');
  const player = new VrmaPlayer(scene, vrmManager);
  // CMU walk cycle (02_01) — public domain motion capture
  await player.play("vrma/02_01.vrma");

  (window as any).animationReady = true;

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
}

init().catch(console.error);
