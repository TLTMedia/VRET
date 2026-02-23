/**
 * app.ts — Babylon.js VRM + VRMA player (TypeScript entry point for Vite)
 *
 * Babylon.js and babylon-vrm-loader are loaded via CDN in index.html.
 * This file uses the window.BABYLON global and provides a typed wrapper.
 *
 * Coordinate space rules (all three must hold simultaneously):
 *   1. Camera alpha = -π/2  → avatar faces -Z, camera at -Z sees the front
 *   2. Rotation keyframes   → conjugate by 180°Y: (-qx, qy, -qz, qw)
 *   3. Hips position        → pre-negate X and Z before __root__ applies its flip
 */

// BABYLON is loaded from CDN — access via window global
const B = (window as any).BABYLON as typeof import("@babylonjs/core");

// ---------------------------------------------------------------------------
// VrmaPlayer — retargets a VRMA animation onto a loaded VRM model
// ---------------------------------------------------------------------------
export class VrmaPlayer {
  private scene: any;
  private vrmManager: any;
  private vrmHipsY: number = 1;
  private currentGroup: any = null;
  private currentContainer: any = null;

  constructor(scene: any, vrmManager: any) {
    this.scene = scene;
    this.vrmManager = vrmManager;

    const hips = vrmManager.humanoidBone["hips"];
    this.vrmHipsY =
      hips?.absolutePosition?.y ?? hips?.getAbsolutePosition?.().y ?? 1;
  }

  async play(vrmaUrl: string, loop = true): Promise<any> {
    // Stop & dispose previous
    if (this.currentGroup) {
      this.currentGroup.stop();
      this.currentGroup.dispose();
      this.currentGroup = null;
    }
    if (this.currentContainer) {
      this.currentContainer.dispose();
      this.currentContainer = null;
    }
    if (this.scene.metadata?.vrmAnimationManagers) {
      this.scene.metadata.vrmAnimationManagers = [];
    }

    const container = await B.LoadAssetContainerAsync(vrmaUrl, this.scene);
    this.currentContainer = container;

    const vrmAnimManager = this.scene.metadata?.vrmAnimationManagers?.[0];
    const animGroup = container.animationGroups[0];

    if (!vrmAnimManager?.animationMap || !animGroup) {
      console.warn("[VrmaPlayer] No animation data in", vrmaUrl);
      return null;
    }

    // Translation scale: match VRM avatar height to VRMA rig height
    let translationScale = 1;
    const hipsEntry = [...vrmAnimManager.animationMap.entries()]
      .find(([, name]: [number, string]) => name === "hips");
    const hipsIdx = hipsEntry?.[0];
    if (hipsIdx != null) {
      const vrmaHipsY =
        animGroup.targetedAnimations[hipsIdx]?.target?.absolutePosition?.y ?? 0;
      if (vrmaHipsY !== 0) translationScale = this.vrmHipsY / vrmaHipsY;
    }

    const remapped = new B.AnimationGroup("vrma-remapped", this.scene);

    animGroup.targetedAnimations.forEach((targeted: any, i: number) => {
      const boneName: string = vrmAnimManager.animationMap.get(i);
      const bone = this.vrmManager.humanoidBone[boneName];
      if (!bone) return;

      const anim = targeted.animation.clone(`anim_${boneName}`);

      if (anim.targetProperty === "rotationQuaternion") {
        // VRMA quaternions are in glTF right-handed canonical space.
        // VRM bones sit under __root__ (180°Y). Conjugate by 180°Y: (-qx, qy, -qz, qw).
        anim.getKeys().forEach((kf: any) => {
          const q = kf.value;
          kf.value = new B.Quaternion(-q.x, q.y, -q.z, q.w);
        });
      }

      if (anim.targetProperty === "position" && boneName === "hips") {
        // Pre-negate X and Z so __root__ (180°Y) maps them to the correct world direction.
        // glTF forward (-Z) → local +Z → world -Z (toward camera at -Z) ✓
        anim.getKeys().forEach((kf: any) => {
          const v = kf.value.scale(translationScale);
          kf.value = new B.Vector3(-v.x, v.y, -v.z);
        });
      }

      remapped.addTargetedAnimation(anim, bone);
    });

    remapped.start(loop, 1.0, remapped.from, remapped.to, false);
    remapped.goToFrame(remapped.from); // prevent 1-frame T-pose flash
    this.scene.render();

    this.currentGroup = remapped;
    (window as any).animationReady = true;
    (window as any).remappedGroup = remapped;
    (window as any).vrmScene = this.scene;
    console.log(`[VrmaPlayer] playing ${vrmaUrl} — ${remapped.targetedAnimations.length} tracks`);
    return remapped;
  }

  stop() {
    this.currentGroup?.stop();
  }
}

// ---------------------------------------------------------------------------
// App — wires up the scene and loads a demo VRM + animation
// ---------------------------------------------------------------------------
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

  const player = new VrmaPlayer(scene, vrmManager);
  // CMU walk cycle (02_01) — public domain motion capture
  await player.play("vrma/02_01.vrma");

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
}

init().catch(console.error);
