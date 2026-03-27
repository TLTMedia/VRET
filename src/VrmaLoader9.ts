/**
 * VrmaLoader9.ts — VRMA retargeting using Babylon.js 9.0 AnimatorAvatar.
 * 
 * This is a proof-of-concept loader that replaces manual coordinate math
 * with the native AnimatorAvatar.retargetAnimationGroup() method.
 */

import { VrmModel } from './VrmModel';

/** Lazy accessor — avoids capturing window.BABYLON at module load time. */
function getB(): any {
  const b = (window as any).BABYLON;
  if (!b) throw new Error('[VrmaLoader9] window.BABYLON is not set');
  return b;
}

export interface VrmaClip {
  group: any;     // BABYLON.AnimationGroup
  container: any; // BABYLON.AssetContainer
}

/**
 * Load a VRMA file and retarget it onto a VrmModel using AnimatorAvatar.
 */
export async function buildVrmaClip(
  vrmaUrl: string,
  vrm: VrmModel,
  scene: any,
): Promise<VrmaClip> {
  const B = getB();

  // 1. Monkey-patch AnimatorAvatar if needed (TransformNodes lack getTotalVertices)
  B.TransformNode.prototype.getTotalVertices ??= function() { return 0; };

  // 2. Identify/Create the AnimatorAvatar for this VRM
  // We store it on the vrm object for reuse.
  if (!(vrm as any).vrmAvatar) {
    const rootMesh = vrm.rootNode; // Usually the __root__ or the transform node
    (vrm as any).vrmAvatar = new B.AnimatorAvatar(`avatar-${vrm.rootNode.name}`, rootMesh);
    console.log('[VrmaLoader9] Created AnimatorAvatar for', vrm.rootNode.name);
  }
  const vrmAvatar = (vrm as any).vrmAvatar;

  // 3. Load the VRMA AssetContainer
  const managersBefore = (scene.metadata?.vrmAnimationManagers ?? []).length;
  const container = await B.LoadAssetContainerAsync(vrmaUrl, scene);

  // 4. Resolve the VRMA metadata (Mapped by vrm1-loader.js)
  const managers = scene.metadata?.vrmAnimationManagers ?? [];
  const vrmAnimMgr = managers[managersBefore] ?? managers[managers.length - 1];
  const animGroup = container.animationGroups[0];

  if (!vrmAnimMgr?.animationMap || !animGroup) {
    container.dispose();
    throw new Error(`[VrmaLoader9] No VRM animation metadata found in ${vrmaUrl}`);
  }

  // 5. Build the bone name map: VRMA Source Name -> VRM Bone Name
  // AnimatorAvatar needs to know which track target maps to which humanoid bone.
  const mapNodeNames = new Map<string, string>();
  animGroup.targetedAnimations.forEach((targeted: any, i: number) => {
    const boneName = vrmAnimMgr.animationMap.get(i);
    const bone = vrm.humanoidBone[boneName];
    if (bone && targeted.target?.name) {
      mapNodeNames.set(targeted.target.name, bone.name);
    }
  });

  // 6. Retarget via AnimatorAvatar
  // fixRootPosition: true handles the VRM 180-degree-Y world orientation.
  const remapped = vrmAvatar.retargetAnimationGroup(animGroup, {
    animationGroupName:      `vrma-remapped-${vrmaUrl}`,
    fixRootPosition:         true,
    rootNodeName:            vrm.humanoidBone['hips']?.name,
    groundReferenceNodeName: vrm.humanoidBone['leftFoot']?.name,
    mapNodeNames,
  });

  return { group: remapped, container };
}
