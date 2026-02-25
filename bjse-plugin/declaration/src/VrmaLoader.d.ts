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
export interface VrmaClip {
    /** The retargeted AnimationGroup — call group.start() to play */
    group: any;
    /** The AssetContainer the raw VRMA was loaded into — dispose when done */
    container: any;
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
export declare function buildVrmaClip(vrmaUrl: string, vrm: VrmModel, scene: any): Promise<VrmaClip>;
