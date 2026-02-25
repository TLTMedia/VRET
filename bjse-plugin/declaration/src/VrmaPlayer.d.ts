/**
 * VrmaPlayer.ts — playback state manager for a single VRMA clip on one VRM actor.
 *
 * Mirrors the role of THREE.AnimationMixer + clipAction():
 *   - Delegates retargeting to buildVrmaClip() (VrmaLoader.ts)
 *   - Owns the current group + container lifecycle (stop / dispose)
 *
 * Constructor takes a VrmModel (from loadVrm) instead of a raw vrmManager,
 * matching the three-vrm pattern where the VRM object is the retargeting target.
 */
import { VrmModel } from './VrmModel';
export declare class VrmaPlayer {
    private scene;
    private vrm;
    private currentGroup;
    private currentContainer;
    constructor(scene: any, vrm: VrmModel);
    /**
     * Load and play a VRMA clip.
     * Stops and disposes any currently playing clip first.
     *
     * @param vrmaUrl URL or path to the .vrma file
     * @param loop    Whether to loop the animation (default true)
     * @returns The started AnimationGroup, or null on error
     */
    play(vrmaUrl: string, loop?: boolean): Promise<any>;
    stop(): void;
    dispose(): void;
}
