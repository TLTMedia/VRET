/**
 * Actor.ts — a VRM character in the scene with its own world-space root node.
 *
 * Uses loadVrm() (VrmLoader.ts) for VRM loading and VrmaPlayer for animation.
 * The Actor is positioned by setting rootNode.position/rotation after load —
 * the loadVrm() call creates the root node at the specified pos/rotY.
 */

import { VrmModel } from './VrmModel';
import { loadVrm } from './VrmLoader';
import { VrmaPlayer } from './VrmaPlayer';

export interface ActorDef {
  id: string;
  vrm: string;
  startPosition?: { x: number; y: number; z: number };
  startRotation?: { y: number };
}

export class Actor {
  readonly id: string;
  private scene: any;
  vrm: VrmModel | null = null;
  player: VrmaPlayer | null = null;

  constructor(id: string, scene: any) {
    this.id    = id;
    this.scene = scene;
  }

  async load(vrmUrl: string, pos = { x: 0, y: 0, z: 0 }, rotY = 0): Promise<void> {
    console.log(`[Actor:${this.id}] loading ${vrmUrl}…`);
    this.vrm    = await loadVrm(vrmUrl, this.scene, pos, rotY);
    this.player = new VrmaPlayer(this.scene, this.vrm);
    console.log(`[Actor:${this.id}] loaded`);
  }

  async animate(vrmaUrl: string, loop = true): Promise<any> {
    console.log(`[Actor:${this.id}] animate ${vrmaUrl}`);
    return this.player?.play(vrmaUrl, loop) ?? null;
  }

  stop(): void {
    this.player?.stop();
  }

  dispose(): void {
    this.player?.dispose();
    this.vrm?.rootNode?.dispose();
    this.vrm = null;
    this.player = null;
  }
}
