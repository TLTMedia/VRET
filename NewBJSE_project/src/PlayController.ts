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
  to?: { x: number; y: number; z: number };
  duration?: number;
}

export interface SceneScript {
  metadata?: { title?: string; description?: string };
  actors: ActorDef[];
  timeline: TimelineEvent[];
}

export class PlayController {
  readonly actors = new Map<string, Actor>();
  private scene: any;
  private script: SceneScript | null = null;
  private _timers: ReturnType<typeof setTimeout>[] = [];

  constructor(scene: any) {
    this.scene = scene;
  }

  async loadScript(url: string): Promise<void> {
    this.script = await fetch(url).then(r => r.json()) as SceneScript;
    console.log(
      `[PlayController] "${this.script.metadata?.title}" — ` +
      `${this.script.actors.length} actors, ${this.script.timeline.length} events`
    );
  }

  /** Load all VRM models. Call before play(). */
  async preload(): Promise<void> {
    if (!this.script) throw new Error('Call loadScript() first');
    for (const def of this.script.actors) {
      const actor = new Actor(def.id, this.scene);
      await actor.load(
        def.vrm,
        def.startPosition ?? { x: 0, y: 0, z: 0 },
        def.startRotation?.y ?? 0
      );
      this.actors.set(def.id, actor);
    }
    console.log(`[PlayController] preload complete — ${this.actors.size} actors ready`);
  }

  /** Start playback. All t=0 events fire immediately; future events are scheduled. */
  async play(): Promise<void> {
    if (!this.script) throw new Error('Call loadScript() first');
    this.stop(); // cancel any previous timers

    const sorted = [...this.script.timeline].sort((a, b) => a.start - b.start);

    for (const event of sorted) {
      if (event.start === 0) {
        await this._fire(event);
      } else {
        const t = setTimeout(() => this._fire(event), event.start * 1000);
        this._timers.push(t);
      }
    }

    console.log('[PlayController] playing');
  }

  stop(): void {
    this._timers.forEach(t => clearTimeout(t));
    this._timers = [];
    this.actors.forEach(a => a.stop());
  }

  dispose(): void {
    this.stop();
    this.actors.forEach(a => a.dispose());
    this.actors.clear();
  }

  private async _fire(event: TimelineEvent): Promise<void> {
    const actor = this.actors.get(event.actor);
    if (!actor) {
      console.warn(`[PlayController] unknown actor: ${event.actor}`);
      return;
    }
    console.log(`[PlayController] t=${event.start} ${event.actor} → ${event.action} ${event.clip ?? ''}`);

    if (event.action === 'animate' && event.clip) {
      await actor.animate(event.clip, event.loop ?? true);
    } else if (event.action === 'stop') {
      actor.stop();
    }
    // 'move' — Phase 2
  }
}
