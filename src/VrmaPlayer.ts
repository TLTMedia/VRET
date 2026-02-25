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
import { buildVrmaClip } from './VrmaLoader';

export class VrmaPlayer {
  private scene: any;
  private vrm: VrmModel;
  private currentGroup: any = null;
  private currentContainer: any = null;

  constructor(scene: any, vrm: VrmModel) {
    this.scene = scene;
    this.vrm   = vrm;
  }

  /**
   * Load and play a VRMA clip.
   * Stops and disposes any currently playing clip first.
   *
   * @param vrmaUrl URL or path to the .vrma file
   * @param loop    Whether to loop the animation (default true)
   * @returns The started AnimationGroup, or null on error
   */
  async play(vrmaUrl: string, loop = true): Promise<any> {
    this.dispose();

    let clip;
    try {
      clip = await buildVrmaClip(vrmaUrl, this.vrm, this.scene);
    } catch (err) {
      console.warn('[VrmaPlayer]', err);
      return null;
    }

    const { group, container } = clip;
    this.currentGroup     = group;
    this.currentContainer = container;

    group.start(loop, 1.0, group.from, group.to, false);
    group.goToFrame(group.from); // prevent 1-frame T-pose flash
    this.scene.render();

    console.log(`[VrmaPlayer] ${vrmaUrl} — ${group.targetedAnimations.length} tracks`);
    return group;
  }

  stop(): void {
    this.currentGroup?.stop();
  }

  dispose(): void {
    this.currentGroup?.stop();
    this.currentGroup?.dispose();
    this.currentContainer?.dispose();
    this.currentGroup     = null;
    this.currentContainer = null;
  }
}
