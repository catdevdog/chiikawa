import { describe, expect, it } from 'vitest';
import { mulberry32, type Rect } from '../src/engine';
import { Region, type Reach } from '../src/engine/region';

/** A body 40 wide and 100 tall, standing on its feet point. */
const reach: Reach = { left: 20, right: 20, top: 100 };

const SIDE_BY_SIDE: Rect[] = [{ x: 0, y: 0, w: 1000, h: 600 }, { x: 1000, y: 0, w: 1000, h: 600 }];
/** The second monitor is taller: its floor is lower. */
const TALLER: Rect[] = [{ x: 0, y: 0, w: 1000, h: 600 }, { x: 1000, y: 0, w: 1000, h: 800 }];
/** The second monitor sits lower and is shorter: its floor is higher. */
const SHIFTED: Rect[] = [{ x: 0, y: 0, w: 1000, h: 800 }, { x: 1000, y: 100, w: 1000, h: 600 }];
const STACKED: Rect[] = [{ x: 0, y: 0, w: 1000, h: 600 }, { x: 0, y: 600, w: 1000, h: 500 }];

describe('Region with one screen', () => {
  const r = new Region([{ x: 0, y: 0, w: 1000, h: 600 }]);

  it('keeps the whole body on the screen', () => {
    expect(r.fits({ x: 500, y: 300 }, reach)).toBe(true);
    expect(r.fits({ x: 20, y: 100 }, reach)).toBe(true);
    expect(r.fits({ x: 19, y: 300 }, reach)).toBe(false);
    expect(r.fits({ x: 981, y: 300 }, reach)).toBe(false);
    expect(r.fits({ x: 500, y: 99 }, reach)).toBe(false);
    expect(r.fits({ x: 500, y: 601 }, reach)).toBe(false);
  });

  it('clamps like a plain rectangle', () => {
    expect(r.clamp({ x: -50, y: 900 }, reach)).toEqual({ x: 20, y: 600 });
    expect(r.clamp({ x: 5000, y: -5 }, reach)).toEqual({ x: 980, y: 100 });
    expect(r.clamp({ x: 400, y: 300 }, reach)).toEqual({ x: 400, y: 300 });
  });

  it('has its bottom edge as the floor and its top as the ceiling', () => {
    expect(r.floor({ x: 500, y: 300 }, reach)).toBe(600);
    expect(r.ceiling({ x: 500, y: 300 }, reach)).toBe(100);
  });

  it('collapses sideways when the screen is narrower than the body', () => {
    const tiny = new Region([{ x: 0, y: 0, w: 30, h: 600 }]);
    expect(tiny.clamp({ x: 0, y: 300 }, reach).x).toBe(15);
  });

  it('picks a spot exactly the way the engine always did', () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    const spot = r.pick(a, reach, true);
    const x = 20 + b() * (980 - 20);
    const y = b() < 0.6 ? 600 - b() ** 1.5 * (600 - 100) : 600;
    expect(spot).toEqual({ x, y });
    expect(a()).toBe(b());
  });
});

describe('Region with several screens', () => {
  it('lets the body stand across the edge between two screens', () => {
    const r = new Region(SIDE_BY_SIDE);
    expect(r.fits({ x: 1000, y: 300 }, reach)).toBe(true);
    expect(r.fits({ x: 1500, y: 300 }, reach)).toBe(true);
    expect(r.fits({ x: 1981, y: 300 }, reach)).toBe(false);
    expect(r.clamp({ x: 2500, y: 300 }, reach)).toEqual({ x: 1980, y: 300 });
    expect(r.clamp({ x: -100, y: 300 }, reach).x).toBe(20);
  });

  it('knows which screen a point is on and the box around all of them', () => {
    const r = new Region(TALLER);
    expect(r.indexAt({ x: 500, y: 500 })).toBe(0);
    expect(r.indexAt({ x: 1500, y: 700 })).toBe(1);
    expect(r.indexAt({ x: 500, y: 700 })).toBe(-1);
    expect(r.bounds).toEqual({ x: 0, y: 0, w: 2000, h: 800 });
  });

  it('has a floor per screen, and the higher one while the body is across both', () => {
    const r = new Region(TALLER);
    expect(r.floor({ x: 500, y: 300 }, reach)).toBe(600);
    expect(r.floor({ x: 1500, y: 300 }, reach)).toBe(800);
    expect(r.floor({ x: 1000, y: 300 }, reach)).toBe(600);
    expect(r.floor({ x: 1021, y: 300 }, reach)).toBe(800);
  });

  it('keeps a body that is across an edge between screens of different heights on both of them', () => {
    const r = new Region(SHIFTED);
    // feet on the first screen's floor cannot go onto the second (which ends higher): the body would hang off it
    expect(r.fits({ x: 1000, y: 800 }, reach)).toBe(false);
    expect(r.fits({ x: 1000, y: 700 }, reach)).toBe(true);
    // the nearest place for such a position is back on the first screen
    const q = r.clamp({ x: 1000, y: 750 }, reach);
    expect(q.x).toBeCloseTo(980, 6);
    expect(q.y).toBe(750);
    // and a body wholly on the second screen cannot stand above its top
    expect(r.ceiling({ x: 1500, y: 300 }, reach)).toBe(200);
  });

  it('slides along an edge instead of snapping back to the nearest screen box', () => {
    // pushing right and down at once against the first screen's floor, next to a taller screen
    const r = new Region(TALLER);
    const q = r.clamp({ x: 970, y: 650 }, reach);
    expect(q.x).toBe(970);
    expect(q.y).toBe(600);
    // the very nearest legal spot may be across the edge: step right until the body is wholly on the taller screen
    const across = r.clamp({ x: 1010, y: 650 }, reach);
    expect(across).toEqual({ x: 1020, y: 650 });
    expect(r.fits(across, reach)).toBe(true);
  });

  it('finds the exact nearest legal spot in a staircase of screens', () => {
    const r = new Region(SHIFTED);
    for (const p of [{ x: 1000, y: 750 }, { x: 1100, y: 790 }, { x: 990, y: 50 }, { x: 3000, y: 3000 }, { x: -9, y: -9 }]) {
      const q = r.clamp(p, reach);
      expect(r.fits(q, reach)).toBe(true);
      // nothing legal is closer: try a fine grid of positions
      let nearer = 0;
      for (let x = -50; x <= 2050; x += 10) {
        for (let y = -50; y <= 900; y += 10) {
          if (r.fits({ x, y }, reach) && Math.hypot(x - p.x, y - p.y) < Math.hypot(q.x - p.x, q.y - p.y) - 1e-6) nearer++;
        }
      }
      expect(nearer).toBe(0);
    }
  });

  it('finds the height to stand at when stepping from one floor to another', () => {
    const r = new Region(SHIFTED);
    // walking right along the first floor into the shorter screen: up to its floor
    expect(r.nearestY({ x: 1000, y: 800 }, reach)).toEqual({ x: 1000, y: 700 });
    // wholly on the first screen nothing changes
    expect(r.nearestY({ x: 500, y: 800 }, reach)).toEqual({ x: 500, y: 800 });
    // no height works where there is no screen at all
    expect(new Region(SIDE_BY_SIDE).nearestY({ x: 2500, y: 300 }, reach)).toBeNull();
    // a screen too short for the body has no height at all
    expect(new Region([{ x: 0, y: 0, w: 1000, h: 50 }]).nearestY({ x: 500, y: 40 }, reach)).toBeNull();
  });

  it('treats stacked screens as one tall stretch', () => {
    const r = new Region(STACKED);
    expect(r.fits({ x: 500, y: 600 }, reach)).toBe(true);
    expect(r.floor({ x: 500, y: 300 }, reach)).toBe(1100);
    expect(r.ceiling({ x: 500, y: 300 }, reach)).toBe(100);
  });

  it('finds how far sideways the body can go', () => {
    const r = new Region(SIDE_BY_SIDE);
    expect(r.reachX({ x: 900, y: 300 }, 3000, reach)).toBeCloseTo(1980, 6);
    expect(r.reachX({ x: 900, y: 300 }, -500, reach)).toBeCloseTo(20, 6);
    expect(r.reachX({ x: 900, y: 300 }, 1200, reach)).toBe(1200);
    const gap = new Region([{ x: 0, y: 0, w: 1000, h: 600 }, { x: 1200, y: 0, w: 1000, h: 600 }]);
    expect(gap.reachX({ x: 900, y: 300 }, 1500, reach)).toBeCloseTo(980, 6);
  });

  it('picks spots on every screen, more often on a bigger one, and always where the body fits', () => {
    const r = new Region([{ x: 0, y: 0, w: 1000, h: 600 }, { x: 1000, y: 0, w: 3000, h: 600 }]);
    const rng = mulberry32(11);
    let second = 0;
    for (let i = 0; i < 2000; i++) {
      const p = r.pick(rng, reach, true);
      expect(r.fits(p, reach)).toBe(true);
      if (p.x > 1000) second++;
    }
    expect(second / 2000).toBeGreaterThan(0.68);
    expect(second / 2000).toBeLessThan(0.82);
  });

  it('survives an empty list', () => {
    expect(new Region([]).rects).toHaveLength(1);
  });
});
