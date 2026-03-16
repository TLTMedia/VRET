/**
 * VrmModel.ts — the "VRM object" interface.
 *
 * Mirrors the role of three-vrm's `VRM` type: the result of loading a VRM file.
 * Produced by `loadVrm()` in VrmLoader.ts.
 * Consumed by `buildVrmaClip()` in VrmaLoader.ts and `VrmaPlayer`.
 */

const B = (window as any).BABYLON;

export interface VrmModel {
  /** The vrmManager provided by babylonjs-vrm loader */
  manager: any;
  /** Humanoid bone name → Babylon TransformNode */
  humanoidBone: Record<string, any>;
  /** World-space Y of the hips bone — used to scale VRMA translations */
  hipsY: number;
  /** All meshes that belong to this VRM (used for disposal) */
  meshes: any[];  // BABYLON.AbstractMesh[]
  /** World-space root node — set its position/rotation to place the actor */
  rootNode: any;  // BABYLON.TransformNode
}
