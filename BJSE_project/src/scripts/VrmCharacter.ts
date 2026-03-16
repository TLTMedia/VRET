import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";

import { IScript, visibleAsString, visibleAsBoolean } from "babylonjs-editor-tools";

import { loadVrm, loadVrmLoader } from "../VrmLoader";
import { VrmaPlayer } from "../VrmaPlayer";
import { ARKitFaceDriver } from "../arkit-face-driver";

/**
 * VrmCharacter.ts — Integrated VRM actor script for Babylon.js Editor.
 * 
 * Drives a VRM model with skeletal animation (VRMA) and facial animation (A2F JSON).
 */
export default class VrmCharacter implements IScript {
    @visibleAsString("VRM URL", "models/AIAN/AIAN_F_1_Casual.vrm")
    public vrmUrl: string = "models/AIAN/AIAN_F_1_Casual.vrm";

    @visibleAsString("VRMA Clip", "vrma/02_01.vrma")
    public vrmaUrl: string = "vrma/02_01.vrma";

    @visibleAsBoolean("Loop VRMA", true)
    public loopVrma: boolean = true;

    @visibleAsString("A2F JSON URL", "audio/a2f_sample.json")
    public a2fJsonUrl: string = "audio/a2f_sample.json";

    @visibleAsBoolean("Play on Start", true)
    public playOnStart: boolean = true;

    private _vrm: any = null;
    private _player: VrmaPlayer | null = null;
    private _faceDriver: ARKitFaceDriver | null = null;
    
    private _a2fData: any = null;
    private _startTime: number = 0;
    private _isPlaying: boolean = false;

    /**
     * @param node The TransformNode this script is attached to.
     */
    public constructor(public node: TransformNode) { }

    /**
     * Called by BJSE when the scene starts playing.
     */
    public async onStart(): Promise<void> {
        const scene = this.node.getScene();
        
        try {
            await loadVrmLoader();
            
            console.log(`[VrmCharacter] Loading VRM: ${this.vrmUrl}`);
            const pos = { x: this.node.position.x, y: this.node.position.y, z: this.node.position.z };
            const rotY = this.node.rotation.y * (180 / Math.PI);
            
            this._vrm = await loadVrm(this.vrmUrl, scene, pos, rotY);
            
            // Parent VRM root to this node so it follows the editor placement
            if (this._vrm.rootNode) {
                this._vrm.rootNode.parent = this.node;
                // Reset local pos/rot since we parented to the target node
                this._vrm.rootNode.position.set(0, 0, 0);
                this._vrm.rootNode.rotation.set(0, 0, 0);
            }

            this._player = new VrmaPlayer(scene, this._vrm);
            this._faceDriver = new ARKitFaceDriver(this._vrm.manager, scene);

            if (this.a2fJsonUrl) {
                console.log(`[VrmCharacter] Loading A2F: ${this.a2fJsonUrl}`);
                const resp = await fetch(this.a2fJsonUrl);
                this._a2fData = await resp.json();
            }

            if (this.playOnStart) {
                this.play();
            }

        } catch (err) {
            console.error("[VrmCharacter] Load failed:", err);
        }
    }

    public play(): void {
        if (!this._player || !this._vrm) return;
        
        if (this.vrmaUrl) {
            this._player.play(this.vrmaUrl, this.loopVrma);
        }
        
        this._startTime = performance.now();
        this._isPlaying = true;
    }

    public stop(): void {
        this._isPlaying = false;
        this._player?.stop();
        this._faceDriver?.reset();
    }

    /**
     * Called on each frame.
     */
    public onUpdate(): void {
        if (!this._isPlaying || !this._a2fData || !this._faceDriver) return;

        const elapsed = (performance.now() - this._startTime) / 1000;
        const frames = this._a2fData.frames;
        const fps = this._a2fData.metadata.fps;
        const shapeNames = this._a2fData.metadata.shapeNames;

        if (!frames || frames.length === 0) return;

        // Drive A2F Facial Animation
        const frameIdx = Math.floor(elapsed * fps) % frames.length;
        const weights = frames[frameIdx];
        
        for (let i = 0; i < shapeNames.length; i++) {
            this._faceDriver.set(shapeNames[i], weights[i]);
        }
    }

    /**
     * Called when the scene stops.
     */
    public onStop(): void {
        this.stop();
        this._player?.dispose();
        this._vrm?.rootNode?.dispose();
    }
}
