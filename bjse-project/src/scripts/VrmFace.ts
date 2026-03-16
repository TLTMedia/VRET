import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { IScript, visibleAsString, visibleAsBoolean } from "babylonjs-editor-tools";

import { ARKitFaceDriver } from "../arkit-face-driver";

/**
 * VrmFace.ts — Facial animation script for VRM 1.0 models.
 * 
 * Drives ARKit blendshapes from an Audio2Face exported JSON file.
 * This node should be the root of a loaded VRM model (or contain the face meshes).
 */
export default class VrmFace implements IScript {
    @visibleAsString("A2F JSON URL", "audio/a2f_sample.json")
    public a2fJsonUrl: string = "audio/a2f_sample.json";

    @visibleAsBoolean("Play on Start", true)
    public playOnStart: boolean = true;

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
            const vrmManagers = scene.metadata?.vrmManagers ?? [];
            const vrmManager = vrmManagers.find((m: any) => {
                const root = m.rootMesh || m.rootNode;
                return root === this.node || this.node.isDescendantOf(root) || root.isDescendantOf(this.node);
            }) || vrmManagers[0];

            if (!vrmManager) {
                console.error("[VrmFace] No VRM Manager found. Ensure the model was loaded via VRM loader.");
                return;
            }

            this._faceDriver = new ARKitFaceDriver(vrmManager, scene);

            if (this.a2fJsonUrl) {
                console.log(`[VrmFace] Loading A2F: ${this.a2fJsonUrl}`);
                const resp = await fetch(this.a2fJsonUrl);
                this._a2fData = await resp.json();
            }

            if (this.playOnStart) {
                this.play();
            }

        } catch (err) {
            console.error("[VrmFace] Start failed:", err);
        }
    }

    public play(): void {
        this._startTime = performance.now();
        this._isPlaying = true;
    }

    public stop(): void {
        this._isPlaying = false;
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
    }
}
