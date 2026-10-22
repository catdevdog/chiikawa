import type { Vec2 } from './types';

/**
 * A pet that has been left alone for a long time may look for attention: it runs up to the mouse, waits beside it until
 * the mouse is still, and then pulls the cursor away with it. The pieces that do not need the pet are here.
 */

/** How long nobody has touched or called the pet (ms) before it may set out. */
export const ATTENTION_AFTER_MS = 10 * 60_000;
/** Each time a pet that is free has decided what to do next: how likely it is that it sets out. */
export const ATTENTION_CHANCE = 0.15;
/** After an outing, how long until the next may start (ms, from and to), and after giving up. */
export const ATTENTION_COOLDOWN_MS = [20 * 60_000, 40 * 60_000] as const;
export const ATTENTION_RETRY_MS = 4 * 60_000;
/** Running up to the mouse: it gives up after this long (ms). */
export const GO_MS = 15_000;
/** Waiting beside the mouse for it to be still: it gives up after this long, and the mouse is still when it has not moved for this long (ms). */
export const BEG_MS = 12_000;
export const STILL_MS = 1_500;
/** Pulling: for how long at most (ms), how fast the pet walks compared with an ordinary walk, how fast the cursor is reeled in (px/s), and how far the pull goes at least (px). */
export const PULL_MS = 10_000;
export const PULL_SPEED = 0.75;
export const REEL_SPEED = 900;
export const PULL_MIN = 380;
/** How far (px, with a fading memory) the cursor has to be from where it was put before somebody is taken to have moved the mouse. */
export const BREAK_PX = 10;
/** Less than this (px) from where it was put is the rounding of a screen that is scaled, not somebody's hand. */
const DEAD_PX = 1;
/** The memory of `Deviation` halves in this long (ms). */
const HALF_LIFE_MS = 150;

/** `from` moved `step` px towards `to` (all the way if that is not more than `step`). */
export function approach(from: Vec2, to: Vec2, step: number): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d <= step || d === 0) return { x: to.x, y: to.y };
  return { x: from.x + (dx / d) * step, y: from.y + (dy / d) * step };
}

/**
 * Tells whether somebody has moved the mouse that the pet is holding: the cursor is put somewhere every step, and the
 * hand that moves the mouse makes it differ from where it was put. A slow hand is found as well as a quick one, because
 * what is seen is the sum of the differences, which fades, and not each difference alone.
 */
export class Deviation {
  private x = 0;
  private y = 0;

  reset(): void {
    this.x = 0;
    this.y = 0;
  }

  /** Takes in one step (`dt` ms) in which the cursor was at `actual` where it had been put at `put`; how far it has been taken away, in px. */
  add(actual: Vec2, put: Vec2, dt: number): number {
    let dx = actual.x - put.x;
    let dy = actual.y - put.y;
    const m = Math.hypot(dx, dy);
    if (m <= DEAD_PX) {
      dx = 0;
      dy = 0;
    } else {
      dx *= (m - DEAD_PX) / m;
      dy *= (m - DEAD_PX) / m;
    }
    const keep = 0.5 ** (dt / HALF_LIFE_MS);
    this.x = this.x * keep + dx;
    this.y = this.y * keep + dy;
    return Math.hypot(this.x, this.y);
  }
}
