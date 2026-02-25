/**
 * PlayController.ts — loads a scene JSON script, spawns VRM actors,
 * and fires timeline events at their scheduled times.
 *
 * This is the runtime engine for the play system. It has no knowledge
 * of the Babylon.js Editor — it runs identically in:
 *   - babplay.html (standalone demo)
 *   - A BJSE project (attached as a startup script)
 *   - The Vite dev app (src/app.ts)
 *
 * BJSE integration: create a TransformNode called "PlayController" in the
 * BJSE scene, attach src/bjse-startup.ts to it, point it at your scene JSON.
 */
import { Actor, ActorDef } from './Actor';
export interface TimelineEvent {
    start: number;
    actor: string;
    action: 'animate' | 'move' | 'stop';
    clip?: string;
    loop?: boolean;
    to?: {
        x: number;
        y: number;
        z: number;
    };
    duration?: number;
}
export interface SceneScript {
    metadata?: {
        title?: string;
        description?: string;
    };
    actors: ActorDef[];
    timeline: TimelineEvent[];
}
export declare class PlayController {
    readonly actors: Map<string, Actor>;
    private scene;
    private script;
    private _timers;
    constructor(scene: any);
    loadScript(url: string): Promise<void>;
    /** Load all VRM models. Call before play(). */
    preload(): Promise<void>;
    /** Start playback. All t=0 events fire immediately; future events are scheduled. */
    play(): Promise<void>;
    stop(): void;
    dispose(): void;
    private _fire;
}
