/**
 * vrm-startup.ts — Babylon.js Editor attached script
 *
 * HOW TO USE IN BABYLON.JS EDITOR:
 *   1. Open Babylon.js Editor, create or open a project
 *   2. In the scene, add a TransformNode — name it "VRMStage"
 *   3. In the Inspector, click "Add Script" → select this file
 *   4. Set the `scriptUrl` property to your scene JSON path
 *   5. Copy VRM models and VRMA files into the project's public/ folder
 *   6. Press Play in the editor — VRM actors will load and animate
 *
 * WHAT THE EDITOR CONTROLS:
 *   - Environment (sky, ground, fog)
 *   - Lights and shadows
 *   - Camera starting position
 *   - Any non-VRM scene objects
 *
 * WHAT THIS SCRIPT CONTROLS:
 *   - Loading VRM avatars from the scene JSON
 *   - Playing VRMA animations via VrmaPlayer retargeting
 *   - Actor positions defined in the scene JSON
 *
 * NOT EDITABLE IN THE BJSE TIMELINE:
 *   - VRMA keyframes (edit in Blender / UniVRM)
 *   - Actor animation sequencing (edit scenes/test_scene.json)
 */

import { TransformNode } from '@babylonjs/core';
import { IScript, visibleAsString, visibleAsBoolean } from 'babylonjs-editor-tools';
import { PlayController } from './PlayController';
import { Actor } from './Actor';

// Monkey-patch: AnimatorAvatar's getChildMeshes predicate calls getTotalVertices
// on ALL descendants including VRM TransformNode bones (which lack this method).
// Return 0 so TransformNodes are filtered out as zero-vertex meshes.
(TransformNode.prototype as any).getTotalVertices ??= function() { return 0; };

// The VRM loader must be injected from CDN — it is not available as an npm package
// compatible with Babylon.js 8.x. This runs once before any VRM loads.
async function loadVrmLoader(): Promise<void> {
  if ((window as any).__vrmLoaderReady) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://xuhuisheng.github.io/babylonjs-vrm/babylon-vrm-loader.js';
    s.onload = () => { (window as any).__vrmLoaderReady = true; resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export default class VrmStartup implements IScript {
  /**
   * Global mode: Point this at the JSON scene script (e.g. scenes/test_scene.json)
   */
  @visibleAsString("Script URL", "")
  public scriptUrl: string = "";

  /**
   * Actor mode (Draggable): URL of the .vrm file (e.g. models/Alice.vrm)
   */
  @visibleAsString("VRM URL", "")
  public vrmUrl: string = "";

  /**
   * Actor mode (Draggable): URL of the initial .vrma file (e.g. vrma/13_01.vrma)
   */
  @visibleAsString("Initial VRMA", "")
  public vrmaUrl: string = "";

  /**
   * Actor mode (Draggable): Whether to loop the initial VRMA
   */
  @visibleAsBoolean("Loop VRMA", true)
  public loop: boolean = true;

  private controller: PlayController | null = null;
  private actor: Actor | null = null;

  public constructor(public node: TransformNode) {
    console.log('[VrmStartup] script attached to node:', node.name);
  }

  /**
   * Called by BJSE when the scene starts playing.
   */
  public onStart(): void {
    console.log(`[VrmStartup] onStart() — node: ${this.node.name}`);
    this._start();
  }

  private async _start(): Promise<void> {
    await loadVrmLoader();
    const scene = this.node.getScene();

    // 1. GLOBAL MODE (Legacy/Orchestration)
    if (this.scriptUrl) {
      console.log(`[VrmStartup] Loading global script: ${this.scriptUrl}`);
      this.controller = new PlayController(scene);
      await this.controller.loadScript(this.scriptUrl);
      await this.controller.preload();
      await this.controller.play();
      (window as any).playController = this.controller;
    } 
    // 2. ACTOR MODE (Integrated/Draggable)
    else if (this.vrmUrl) {
      console.log(`[VrmStartup] Loading integrated actor: ${this.vrmUrl}`);
      this.actor = new Actor(this.node.name, scene);
      
      // Load VRM onto this node's position/rotation
      const pos = { x: this.node.position.x, y: this.node.position.y, z: this.node.position.z };
      const rotY = this.node.rotation.y * (180 / Math.PI); // Actor expects degrees
      
      await this.actor.load(this.vrmUrl, pos, rotY);
      
      if (this.vrmaUrl) {
        await this.actor.animate(this.vrmaUrl, this.loop);
      }

      // Hide the transform node if it's just a placeholder, 
      // though typically the VRM root will be a child or replacement.
      // this.node.setEnabled(false);
    }

    (window as any).playReady = true;
    console.log('[VrmStartup] system ready');
  }

  /** Called by BJSE when the scene stops. */
  public onStop(): void {
    this.controller?.dispose();
    this.controller = null;
    
    this.actor?.dispose();
    this.actor = null;

    (window as any).playReady = false;
  }
}
