/**
 * VrmaLoader.ts — pure VRMA retargeting function.
 *
 * Mirrors the role of three-vrm's createVRMAnimationClip():
 *   three-vrm:  createVRMAnimationClip(vrmAnimation, vrm) → THREE.AnimationClip
 *   here:       buildVrmaClip(vrmaUrl, vrm, scene) → { group, container }
 *
 * This function is stateless — it only loads and retargets.
 * Playback state (start/stop/dispose) is managed by VrmaPlayer.
 *
 * Coordinate space rules (VRM 0.x with 180°Y __root__ in Babylon):
 *   Rotations: conjugate 180°Y → (-qx, qy, -qz, qw)
 *   Hips position: pre-negate X and Z → (-vx, vy, -vz) × translationScale
 */

import { VrmModel } from './VrmModel';

/** Lazy accessor — avoids capturing window.BABYLON at module load time. */
function getB(): any {
  const b = (window as any).BABYLON;
  if (!b) throw new Error('[VrmaLoader] window.BABYLON is not set — call loadVrmLoader() first');
  return b;
}

export interface VrmaClip {
  /** The retargeted AnimationGroup — call group.start() to play */
  group: any;  // BABYLON.AnimationGroup
  /** The AssetContainer the raw VRMA was loaded into — dispose when done */
  container: any;  // BABYLON.AssetContainer
}

/**
 * Load a VRMA file and retarget it onto a VrmModel.
 *
 * Uses index-tracking to support multiple simultaneous VRMA loads:
 * records vrmAnimationManagers.length before load, grabs the entry appended after.
 *
 * @param vrmaUrl URL or path to the .vrma file
 * @param vrm     The target VrmModel (from loadVrm)
 * @param scene   Babylon.js Scene
 * @returns VrmaClip with retargeted group + raw container for disposal
 */
export async function buildVrmaClip(
  vrmaUrl: string,
  vrm: VrmModel,
  scene: any,
): Promise<VrmaClip> {
  const B = getB();

  // Record manager count so we grab only this VRMA's manager (multi-actor safe)
  const managersBefore = (scene.metadata?.vrmAnimationManagers ?? []).length;

  const container = await B.LoadAssetContainerAsync(vrmaUrl, scene);

  const managers = scene.metadata?.vrmAnimationManagers ?? [];
  const vrmAnimMgr = managers[managersBefore] ?? managers[managers.length - 1];
  const animGroup = container.animationGroups[0];

  if (!vrmAnimMgr?.animationMap || !animGroup) {
    container.dispose();
    throw new Error(`[VrmaLoader] No animation data in ${vrmaUrl}`);
  }

  // Translation scale: match VRMA rig proportions to VRM skeleton
  let translationScale = 1;
  const hipsEntry = [...vrmAnimMgr.animationMap.entries()]
    .find(([, name]: [number, string]) => name === 'hips');
  if (hipsEntry) {
    const vrmaHipsY = animGroup.targetedAnimations[hipsEntry[0]]
      ?.target?.absolutePosition?.y ?? 0;
    if (vrmaHipsY !== 0) translationScale = vrm.hipsY / vrmaHipsY;
  }

  const group = new B.AnimationGroup(`vrma-${vrmaUrl}`, scene);

  animGroup.targetedAnimations.forEach((targeted: any, i: number) => {
    const boneName: string = vrmAnimMgr.animationMap.get(i);
    const bone = vrm.humanoidBone[boneName];
    if (!bone) return;

    const anim = targeted.animation.clone(`anim_${boneName}_${vrmaUrl}`);

    if (anim.targetProperty === 'rotationQuaternion') {
      // VRM 0.x sits under a 180°Y __root__ node.
      // Conjugating by 180°Y maps (x,y,z,w) → (-x,y,-z,w).
      anim.getKeys().forEach((kf: any) => {
        const q = kf.value;
        kf.value = new B.Quaternion(-q.x, q.y, -q.z, q.w);
      });
    }

    if (anim.targetProperty === 'position' && boneName === 'hips') {
      // VRMA positions are glTF right-handed; pre-negate X and Z so that
      // after __root__'s 180°Y rotation the world direction is correct.
      anim.getKeys().forEach((kf: any) => {
        const v = kf.value.scale(translationScale);
        kf.value = new B.Vector3(-v.x, v.y, -v.z);
      });
    }

    group.addTargetedAnimation(anim, bone);
  });

  return { group, container };
}
