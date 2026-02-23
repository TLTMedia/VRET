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
import { IScript, visibleAsString } from 'babylonjs-editor-tools';
import { PlayController } from './PlayController';

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
   * Editable in the BJSE Inspector. 
   * Point this at the JSON scene script (e.g. scenes/test_scene.json)
   */
  @visibleAsString("Script URL", "scenes/test_scene.json")
  public scriptUrl: string = 'scenes/test_scene.json';

  private controller: PlayController | null = null;

  public constructor(public node: TransformNode) {
    console.log('[VrmStartup] script attached to node:', node.name);
  }

  /**
   * Called by BJSE when the scene starts playing.
   */
  public onStart(): void {
    console.log(`[VrmStartup] onStart() — using scriptUrl: ${this.scriptUrl}`);
    this._start();
  }

  private async _start(): Promise<void> {
    await loadVrmLoader();
    const scene = this.node.getScene();

    this.controller = new PlayController(scene);
    await this.controller.loadScript(this.scriptUrl);
    await this.controller.preload();
    await this.controller.play();

    (window as any).playController = this.controller;
    (window as any).playReady = true;
    console.log('[VrmStartup] play system ready');
  }

  /** Called by BJSE when the scene stops. */
  public onStop(): void {
    this.controller?.dispose();
    this.controller = null;
    (window as any).playReady = false;
  }
}
