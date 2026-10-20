import type { Vec2 } from './types';

/**
 * A launch that carries the feet from `from` to `to` and lands them there, going up and then coming down onto it:
 * the feet rise `clearance` above the higher of the two places first (so a hop onto a ledge goes over its edge).
 * `gravity` is in px/s² and the speeds in px/s.
 */
export interface Hop {
  vx: number;
  vy: number;
  /** seconds in the air */
  time: number;
}

export function planHop(from: Vec2, to: Vec2, gravity: number, clearance: number): Hop {
  const top = Math.min(from.y, to.y) - clearance;
  const vy = -Math.sqrt(2 * gravity * (from.y - top));
  const up = -vy / gravity;
  const down = Math.sqrt((2 * (to.y - top)) / gravity);
  const time = up + down;
  return { vx: (to.x - from.x) / time, vy, time };
}

/** The window a place to stand or a wall belongs to: ids of the pieces of a top edge (`7#1`) and of the sides (`7:L`) start with the window's. */
export function windowOf(id: string): string {
  return id.replace(/[#:].*$/, '');
}
