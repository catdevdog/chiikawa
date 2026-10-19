import type { Rect, Vec2 } from './types';
import { clamp, dist } from './vec';

/**
 * The screens the pet can live on: one rectangle per monitor (its work area), all in one shared coordinate
 * space. The body has to stay on the screens, but it may straddle two of them, so every question below is
 * about the whole body (the hitbox) and not just the feet point.
 */

/** How far the body reaches from the feet point: to either side, and up. It never reaches below the feet. */
export interface Reach {
  left: number;
  right: number;
  top: number;
}

const EPS = 1e-9;

interface Span {
  a: number;
  b: number;
}

interface Column {
  spans: Span[];
}

/** The feet range that keeps the body inside one rectangle (a rectangle too small for the body collapses). */
function boxOf(r: Rect, reach: Reach): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = r.x + reach.left;
  let maxX = r.x + r.w - reach.right;
  let minY = r.y + reach.top;
  const maxY = r.y + r.h;
  if (maxX < minX) minX = maxX = r.x + r.w / 2;
  if (maxY < minY) minY = maxY;
  return { minX, maxX, minY, maxY };
}

export class Region {
  readonly rects: readonly Rect[];
  private cache: { key: string; cells: Rect[] } | null = null;

  constructor(rects: readonly Rect[]) {
    const usable = rects.filter((r) => r.w > 0 && r.h > 0).map((r) => ({ ...r }));
    this.rects = usable.length ? usable : [{ x: 0, y: 0, w: 1, h: 1 }];
  }

  /** The smallest rectangle around all screens. */
  get bounds(): Rect {
    const x0 = Math.min(...this.rects.map((r) => r.x));
    const y0 = Math.min(...this.rects.map((r) => r.y));
    const x1 = Math.max(...this.rects.map((r) => r.x + r.w));
    const y1 = Math.max(...this.rects.map((r) => r.y + r.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** The screen a point is on (the first one that has it), or -1. */
  indexAt(p: Vec2): number {
    return this.rects.findIndex((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
  }

  /**
   * The vertical stretches of screen over the x-range [x0, x1], one entry per piece of that range in which the
   * set of screens does not change. Touching stretches are merged (two stacked monitors are one stretch).
   */
  private columns(x0: number, x1: number): Column[] {
    const cuts = new Set<number>([x0, x1]);
    for (const r of this.rects) {
      if (r.x > x0 && r.x < x1) cuts.add(r.x);
      if (r.x + r.w > x0 && r.x + r.w < x1) cuts.add(r.x + r.w);
    }
    const xs = [...cuts].sort((p, q) => p - q);
    const pieces: [number, number][] = xs.length === 1 ? [[x0, x0]] : xs.slice(1).map((x, i) => [xs[i]!, x]);
    return pieces.map(([a, b]) => {
      const mid = (a + b) / 2;
      const spans = this.rects
        .filter((r) => (a === b ? mid >= r.x && mid <= r.x + r.w : mid > r.x && mid < r.x + r.w))
        .map((r) => ({ a: r.y, b: r.y + r.h }))
        .sort((p, q) => p.a - q.a);
      const merged: Span[] = [];
      for (const s of spans) {
        const last = merged[merged.length - 1];
        if (last && s.a <= last.b + EPS) last.b = Math.max(last.b, s.b);
        else merged.push({ ...s });
      }
      return { spans: merged };
    });
  }

  private spanAt(col: Column, top: number, bottom: number): Span | undefined {
    return col.spans.find((s) => s.a <= top + EPS && bottom <= s.b + EPS);
  }

  /** Is the whole body, with its feet at `p`, on the screens? */
  fits(p: Vec2, reach: Reach): boolean {
    return this.columns(p.x - reach.left, p.x + reach.right).every((c) => !!this.spanAt(c, p.y - reach.top, p.y));
  }

  /**
   * The places the feet may be, as rectangles. Whether the body fits can only change where one of its sides
   * crosses the edge of a screen, so the grid made by those lines has the same answer all over each cell.
   */
  private freeCells(reach: Reach): Rect[] {
    const key = `${reach.left}|${reach.right}|${reach.top}`;
    if (this.cache?.key === key) return this.cache.cells;
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (const r of this.rects) {
      for (const e of [r.x, r.x + r.w]) {
        xs.add(e + reach.left);
        xs.add(e - reach.right);
      }
      for (const e of [r.y, r.y + r.h]) {
        ys.add(e + reach.top);
        ys.add(e);
      }
    }
    const gx = [...xs].sort((a, b) => a - b);
    const gy = [...ys].sort((a, b) => a - b);
    const cells: Rect[] = [];
    for (let i = 0; i + 1 < gx.length; i++) {
      for (let j = 0; j + 1 < gy.length; j++) {
        const x0 = gx[i]!;
        const x1 = gx[i + 1]!;
        const y0 = gy[j]!;
        const y1 = gy[j + 1]!;
        if (x1 - x0 < 1e-7 || y1 - y0 < 1e-7) continue;
        if (this.fits({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, reach)) cells.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
    }
    this.cache = { key, cells };
    return cells;
  }

  /** The feet position nearest to `p` at which the body fits. */
  clamp(p: Vec2, reach: Reach): Vec2 {
    if (this.fits(p, reach)) return { x: p.x, y: p.y };
    const nearestBox = (): Vec2 => {
      let best: Vec2 | null = null;
      for (const r of this.rects) {
        const b = boxOf(r, reach);
        const c = { x: clamp(p.x, b.minX, b.maxX), y: clamp(p.y, b.minY, b.maxY) };
        if (!best || dist(c, p) < dist(best, p)) best = c;
      }
      return best!;
    };
    if (this.rects.length === 1) return nearestBox();
    // the closest point of the closest free cell (a screen too small for the body has none)
    let best: Vec2 | null = null;
    for (const c of this.freeCells(reach)) {
      const q = { x: clamp(p.x, c.x, c.x + c.w), y: clamp(p.y, c.y, c.y + c.h) };
      if (!best || dist(q, p) < dist(best, p)) best = q;
    }
    return best ?? nearestBox();
  }

  /** The legal feet position at the same x whose height is closest to `p.y`, or null if the body fits nowhere there. */
  nearestY(p: Vec2, reach: Reach): Vec2 | null {
    let allowed: Span[] | null = null;
    for (const col of this.columns(p.x - reach.left, p.x + reach.right)) {
      // feet heights that keep the body inside one of this column's stretches of screen
      const mine = col.spans.filter((s) => s.b - s.a >= reach.top - EPS).map((s) => ({ a: s.a + reach.top, b: s.b }));
      if (allowed === null) {
        allowed = mine;
        continue;
      }
      const both: Span[] = [];
      for (const u of allowed) {
        for (const v of mine) {
          const a = Math.max(u.a, v.a);
          const b = Math.min(u.b, v.b);
          if (a <= b + EPS) both.push({ a, b: Math.max(a, b) });
        }
      }
      allowed = both;
    }
    if (!allowed || allowed.length === 0) return null;
    let best = p.y;
    let bestD = Infinity;
    for (const s of allowed) {
      const y = clamp(p.y, s.a, s.b);
      if (Math.abs(y - p.y) < bestD) {
        bestD = Math.abs(y - p.y);
        best = y;
      }
    }
    return { x: p.x, y: best };
  }

  /** The farthest x from `from.x` toward `toX`, at the same height, that the body can walk to without leaving the screens. */
  reachX(from: Vec2, toX: number, reach: Reach): number {
    if (toX === from.x || !this.fits(from, reach)) return from.x;
    const at = (t: number): Vec2 => ({ x: from.x + (toX - from.x) * t, y: from.y });
    const steps = 16;
    let good = 0;
    let bad = -1;
    for (let i = 1; i <= steps; i++) {
      if (this.fits(at(i / steps), reach)) good = i / steps;
      else {
        bad = i / steps;
        break;
      }
    }
    if (bad < 0) return toX;
    let lo = good;
    let hi = bad;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (this.fits(at(mid), reach)) lo = mid;
      else hi = mid;
    }
    return at(lo).x;
  }

  /** The lowest feet y the body can reach by going straight down from `p` (the floor under it). */
  floor(p: Vec2, reach: Reach): number {
    const q = this.clamp(p, reach);
    let floor = Infinity;
    for (const c of this.columns(q.x - reach.left, q.x + reach.right)) {
      const s = this.spanAt(c, q.y - reach.top, q.y);
      floor = Math.min(floor, s ? s.b : q.y);
    }
    return floor;
  }

  /** The highest feet y the body can reach by going straight up from `p`. */
  ceiling(p: Vec2, reach: Reach): number {
    const q = this.clamp(p, reach);
    let ceiling = -Infinity;
    for (const c of this.columns(q.x - reach.left, q.x + reach.right)) {
      const s = this.spanAt(c, q.y - reach.top, q.y);
      ceiling = Math.max(ceiling, (s ? s.a : q.y - reach.top) + reach.top);
    }
    return ceiling;
  }

  /**
   * A random feet position on one screen (bigger screens are more likely). With `free` the pet may also pick
   * a spot above the floor. A single screen consumes the random numbers exactly as the engine always has.
   */
  pick(rng: () => number, reach: Reach, free: boolean): Vec2 {
    let rect = this.rects[0]!;
    if (this.rects.length > 1) {
      const total = this.rects.reduce((s, r) => s + r.w * r.h, 0);
      let at = rng() * total;
      for (const r of this.rects) {
        rect = r;
        at -= r.w * r.h;
        if (at <= 0) break;
      }
    }
    const b = boxOf(rect, reach);
    const x = b.minX + rng() * (b.maxX - b.minX);
    const y = free && rng() < 0.6 ? b.maxY - rng() ** 1.5 * (b.maxY - b.minY) : b.maxY;
    return { x, y };
  }
}
