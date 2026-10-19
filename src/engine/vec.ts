import type { Rect, Vec2 } from './types';

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Point inside the ellipse inscribed in `r`. Used for hit tests so the pet's corners stay click-through. */
export function inEllipse(p: Vec2, r: Rect): boolean {
  if (r.w <= 0 || r.h <= 0) return false;
  const nx = (p.x - (r.x + r.w / 2)) / (r.w / 2);
  const ny = (p.y - (r.y + r.h / 2)) / (r.h / 2);
  return nx * nx + ny * ny <= 1;
}

/** Small deterministic PRNG so behaviour can be replayed in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
