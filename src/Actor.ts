/**
 * Actor.ts — a VRM character in the scene with its own world-space root node.
 *
 * Each Actor owns:
 *   - a BABYLON.TransformNode for world position/rotation
 *   - a VrmaPlayer for VRMA animation retargeting
 *
 * BJSE usage: attach a startup script to a TransformNode in the BJSE scene,
 * then call actor.load() passing that node's position.
 */

import { VrmaPlayer } from './VrmaPlayer';

const B = (window as any).BABYLON;

export interface ActorDef {
  id: string;
  vrm: string;
  startPosition?: { x: number; y: number; z: number };
  startRotation?: { y: number };
}

export class Actor {
  readonly id: string;
  private scene: any;
  player: VrmaPlayer | null = null;
  root: any = null;

  constructor(id: string, scene: any) {
    this.id    = id;
    this.scene = scene;
  }

  async load(vrmUrl: string, pos = { x: 0, y: 0, z: 0 }, rotY = 0): Promise<void> {
    console.log(`[Actor:${this.id}] loading ${vrmUrl}…`);

    // Root node gives this actor its own world position/rotation
    this.root = new B.TransformNode(`actor_root_${this.id}`, this.scene);
    this.root.position = new B.Vector3(pos.x, pos.y, pos.z);
    this.root.rotation = new B.Vector3(0, rotY * Math.PI / 180, 0);

    // Track mesh count before import so we parent only this actor's meshes
    const meshCountBefore = this.scene.meshes.length;

    await B.ImportMeshAsync(vrmUrl, this.scene);

    // Parent all newly-added root meshes to this actor's transform node
    this.scene.meshes.slice(meshCountBefore).forEach((m: any) => {
      if (!m.parent) m.parent = this.root;
    });

    const managers = this.scene.metadata?.vrmManagers ?? [];
    const vrmManager = managers[managers.length - 1];
    if (!vrmManager) throw new Error(`[Actor:${this.id}] VRM manager not found`);

    this.player = new VrmaPlayer(this.scene, vrmManager);
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
    this.root?.dispose();
    this.root = null;
    this.player = null;
  }
}
