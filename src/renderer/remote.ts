import type { PetView } from '../engine/types';
import type { ViewFrame } from '../shared/types';

/** How far past its frame the pet's position is carried on its speed when the next frame is late (ms). */
export const MAX_AHEAD_MS = 34;
/** How far past its frame the pose clock keeps running (ms). */
export const MAX_CLOCK_MS = 250;

/**
 * The pet as the main process last described it. Frames come in steps, a little early or late, so what is drawn
 * is the last frame moved along the pet's speed for the time since it arrived: the motion stays smooth whatever
 * the timing of the messages.
 */
export class RemoteView {
  private frame: ViewFrame | null = null;
  private arrived = 0;
  private out: PetView | null = null;

  /** null means the pet is not in this window (any more). */
  push(frame: ViewFrame | null, now: number): void {
    this.frame = frame;
    this.arrived = now;
  }

  /**
   * The pet to draw at `now`, or null. Positions are in the shared screen coordinates. The object is reused by
   * the next call: draw it, do not keep it.
   */
  at(now: number): PetView | null {
    const f = this.frame;
    if (!f) return null;
    const since = Math.max(0, now - this.arrived);
    const ahead = Math.min(since, MAX_AHEAD_MS) / 1000;
    const out = (this.out ??= { ...f.view });
    Object.assign(out, f.view);
    out.x = f.view.x + f.vx * ahead;
    out.y = f.view.y + f.vy * ahead;
    out.t = f.view.t + Math.min(since, MAX_CLOCK_MS) / 1000;
    out.hitbox = { x: f.view.hitbox.x + f.vx * ahead, y: f.view.hitbox.y + f.vy * ahead, w: f.view.hitbox.w, h: f.view.hitbox.h };
    return out;
  }
}
