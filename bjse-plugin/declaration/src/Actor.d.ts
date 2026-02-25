/**
 * Actor.ts — a VRM character in the scene with its own world-space root node.
 *
 * Uses loadVrm() (VrmLoader.ts) for VRM loading and VrmaPlayer for animation.
 * The Actor is positioned by setting rootNode.position/rotation after load —
 * the loadVrm() call creates the root node at the specified pos/rotY.
 */
import { VrmModel } from './VrmModel';
import { VrmaPlayer } from './VrmaPlayer';
export interface ActorDef {
    id: string;
    vrm: string;
    startPosition?: {
        x: number;
        y: number;
        z: number;
    };
    startRotation?: {
        y: number;
    };
}
export declare class Actor {
    readonly id: string;
    private scene;
    vrm: VrmModel | null;
    player: VrmaPlayer | null;
    constructor(id: string, scene: any);
    load(vrmUrl: string, pos?: {
        x: number;
        y: number;
        z: number;
    }, rotY?: number): Promise<void>;
    animate(vrmaUrl: string, loop?: boolean): Promise<any>;
    stop(): void;
    dispose(): void;
}
