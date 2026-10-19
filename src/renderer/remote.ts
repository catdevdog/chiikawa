import type { PetView } from '../engine/types';
import type { ViewFrame } from '../shared/types';

/** How far past its frame the pet's position is carried on its speed when the next frame is late (ms). */
export const MAX_AHEAD_MS = 34;
/** How far past its frame the pose clock keeps running (ms). */
export const MAX_CLOCK_MS = 250;

/** A pet to draw: whose it is (the id of its skin) and how it looks. */
export interface RemotePet {
  id: string;
  view: PetView;
}

interface Entry {
  frame: ViewFrame;
  arrived: number;
  pet: RemotePet;
}

/**
 * The pets as the main process last described them. Frames come in steps, a little early or late, so what is drawn
 * is each last frame moved along the pet's speed for the time since it arrived: the motion stays smooth whatever
 * the timing of the messages.
 */
export class RemoteView {
  private entries = new Map<string, Entry>();
  private list: RemotePet[] = [];

  /** The pets that are in this window now; none means the window has nothing to draw. */
  push(frames: readonly ViewFrame[], now: number): void {
    const next = new Map<string, Entry>();
    for (const frame of frames) {
      const before = this.entries.get(frame.id);
      next.set(frame.id, { frame, arrived: now, pet: before?.pet ?? { id: frame.id, view: { ...frame.view } } });
    }
    this.entries = next;
  }

  /**
   * The pets to draw at `now`, in the order they were sent. Positions are in the shared screen coordinates. The array
   * and what is in it are reused by the next call: draw them, do not keep them.
   */
  at(now: number): readonly RemotePet[] {
    this.list.length = 0;
    for (const e of this.entries.values()) {
      const f = e.frame;
      const since = Math.max(0, now - e.arrived);
      const ahead = Math.min(since, MAX_AHEAD_MS) / 1000;
      const out = e.pet.view;
      Object.assign(out, f.view);
      out.x = f.view.x + f.vx * ahead;
      out.y = f.view.y + f.vy * ahead;
      out.t = f.view.t + Math.min(since, MAX_CLOCK_MS) / 1000;
      out.hitbox = { x: f.view.hitbox.x + f.vx * ahead, y: f.view.hitbox.y + f.vy * ahead, w: f.view.hitbox.w, h: f.view.hitbox.h };
      this.list.push(e.pet);
    }
    return this.list;
  }
}
