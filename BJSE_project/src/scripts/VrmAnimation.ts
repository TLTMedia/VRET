import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { IScript, visibleAsString, visibleAsBoolean } from "babylonjs-editor-tools";

import { VrmaPlayer } from "../VrmaPlayer";
import { loadVrmLoader } from "../VrmLoader";

/**
 * VrmAnimation.ts — Skeletal animation script for VRM 1.0 models.
 * 
 * Handles VRMA loading and retargeting onto the TransformNode it is attached to.
 * This node should be the root of a loaded VRM model.
 */
export default class VrmAnimation implements IScript {
    @visibleAsString("VRMA Clip", "vrma/02_01.vrma")
    public vrmaUrl: string = "vrma/02_01.vrma";

    @visibleAsBoolean("Loop", true)
    public loop: boolean = true;

    @visibleAsBoolean("Play on Start", true)
    public playOnStart: boolean = true;

    private _player: VrmaPlayer | null = null;

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
            
            // Find the vrmManager in metadata
            const vrmManagers = scene.metadata?.vrmManagers ?? [];
            // Try to find the manager that corresponds to this node hierarchy
            const vrmManager = vrmManagers.find((m: any) => {
                const root = m.rootMesh || m.rootNode;
                return root === this.node || this.node.isDescendantOf(root) || root.isDescendantOf(this.node);
            }) || vrmManagers[0];

            if (!vrmManager) {
                console.error("[VrmAnimation] No VRM Manager found in scene metadata. Ensure the model was loaded via VRM loader.");
                return;
            }

            // Wrap in our VrmModel interface for the player
            const vrmModel = {
                manager: vrmManager,
                humanoidBone: vrmManager.humanoidBone ?? {},
                meshes: [], // not strictly needed for player
                rootNode: vrmManager.rootMesh || vrmManager.rootNode
            };

            this._player = new VrmaPlayer(scene, vrmModel as any);

            if (this.playOnStart && this.vrmaUrl) {
                this.play();
            }

        } catch (err) {
            console.error("[VrmAnimation] Start failed:", err);
        }
    }

    public play(): void {
        if (this._player && this.vrmaUrl) {
            this._player.play(this.vrmaUrl, this.loop);
        }
    }

    public stop(): void {
        this._player?.stop();
    }

    /**
     * Called when the scene stops.
     */
    public onStop(): void {
        this._player?.dispose();
    }
}
