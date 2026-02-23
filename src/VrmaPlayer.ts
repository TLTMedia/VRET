/**
 * VrmaPlayer.ts — retargets a VRMA animation onto a loaded VRM model.
 *
 * Coordinate space rules (all three must hold simultaneously):
 *   1. Camera alpha = -π/2  → avatar faces -Z
 *   2. Rotation keyframes   → conjugate 180°Y: (-qx, qy, -qz, qw)
 *   3. Hips position        → pre-negate X and Z
 *
 * BJSE note: BABYLON is accessed via window global because the VRM loader
 * (xuhuisheng CDN) and @babylonjs/core npm are separate instances.
 * Inject the CDN loader before constructing this class.
 */

const B = (window as any).BABYLON;

export class VrmaPlayer {
  private scene: any;
  private vrmManager: any;
  private vrmHipsY: number;
  private currentGroup: any = null;
  private currentContainer: any = null;

  constructor(scene: any, vrmManager: any) {
    this.scene      = scene;
    this.vrmManager = vrmManager;

    const hips = vrmManager.humanoidBone['hips'];
    this.vrmHipsY = hips?.absolutePosition?.y ?? hips?.getAbsolutePosition?.().y ?? 1;
  }

  async play(vrmaUrl: string, loop = true): Promise<any> {
    if (this.currentGroup) {
      this.currentGroup.stop();
      this.currentGroup.dispose();
      this.currentGroup = null;
    }
    if (this.currentContainer) {
      this.currentContainer.dispose();
      this.currentContainer = null;
    }

    // Multi-actor fix: record manager count before load, grab ours after.
    // Never clear the global vrmAnimationManagers array.
    const managersBefore = (this.scene.metadata?.vrmAnimationManagers ?? []).length;

    const container = await B.LoadAssetContainerAsync(vrmaUrl, this.scene);
    this.currentContainer = container;

    const managers     = this.scene.metadata?.vrmAnimationManagers ?? [];
    const vrmAnimMgr   = managers[managersBefore] ?? managers[managers.length - 1];
    const animGroup    = container.animationGroups[0];

    if (!vrmAnimMgr?.animationMap || !animGroup) {
      console.warn('[VrmaPlayer] No animation data in', vrmaUrl);
      return null;
    }

    // Translation scale: VRM hips height / VRMA rig hips height
    let translationScale = 1;
    const hipsEntry = [...vrmAnimMgr.animationMap.entries()]
      .find(([, name]: [number, string]) => name === 'hips');
    if (hipsEntry) {
      const vrmaHipsY = animGroup.targetedAnimations[hipsEntry[0]]
        ?.target?.absolutePosition?.y ?? 0;
      if (vrmaHipsY !== 0) translationScale = this.vrmHipsY / vrmaHipsY;
    }

    const remapped = new B.AnimationGroup('vrma-' + vrmaUrl, this.scene);

    animGroup.targetedAnimations.forEach((targeted: any, i: number) => {
      const boneName: string = vrmAnimMgr.animationMap.get(i);
      const bone = this.vrmManager.humanoidBone[boneName];
      if (!bone) return;

      const anim = targeted.animation.clone(`anim_${boneName}_${vrmaUrl}`);

      if (anim.targetProperty === 'rotationQuaternion') {
        anim.getKeys().forEach((kf: any) => {
          const q = kf.value;
          kf.value = new B.Quaternion(-q.x, q.y, -q.z, q.w);
        });
      }

      if (anim.targetProperty === 'position' && boneName === 'hips') {
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

    console.log(`[VrmaPlayer] ${vrmaUrl} — ${remapped.targetedAnimations.length} tracks`);
    return remapped;
  }

  stop(): void {
    this.currentGroup?.stop();
  }

  dispose(): void {
    this.stop();
    this.currentGroup?.dispose();
    this.currentContainer?.dispose();
    this.currentGroup = null;
    this.currentContainer = null;
  }
}
