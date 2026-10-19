import { describe, expect, it } from 'vitest';
import { parseLines } from '../src/engine/speech';
import { inEllipse, mulberry32, Pet, type Mode, type PetOptions, type PetState, type Rect, type Vec2 } from '../src/engine';

const W = 1280;
const H = 720;
const SPRITE_H = 128;

const make = (opts: Partial<PetOptions> = {}) =>
  new Pet({ world: { width: W, height: H }, rng: mulberry32(7), ...opts });

function run(pet: Pet, ms: number, each?: (pet: Pet) => void): void {
  for (let t = 0; t < ms; t += 16) {
    pet.update(16);
    each?.(pet);
  }
}

const bodyCenter = (pet: Pet): Vec2 => {
  const r = pet.view.hitbox;
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
};

/** The point the engine measures follow distance from. */
const followCenter = (pet: Pet): Vec2 => ({ x: pet.view.x, y: pet.view.y - SPRITE_H * 0.45 * pet.view.scale });

const gap = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

function click(pet: Pet, p: Vec2): void {
  pet.pointerDown(p);
  pet.pointerUp(p);
}

describe('geometry', () => {
  it('inEllipse rejects the corners of the rect and accepts the middle', () => {
    const r = { x: 0, y: 0, w: 100, h: 100 };
    expect(inEllipse({ x: 50, y: 50 }, r)).toBe(true);
    expect(inEllipse({ x: 2, y: 2 }, r)).toBe(false);
    expect(inEllipse({ x: 50, y: 1 }, r)).toBe(true);
  });

  it('starts at the bottom centre with the body on screen', () => {
    const pet = make();
    pet.update(16);
    expect(pet.view.x).toBeCloseTo(W / 2);
    expect(pet.view.y).toBe(H);
    const hb = pet.view.hitbox;
    expect(hb.x).toBeGreaterThanOrEqual(0);
    expect(hb.x + hb.w).toBeLessThanOrEqual(W);
    expect(hb.y + hb.h).toBeLessThanOrEqual(H + 1e-6);
  });

  it('clamps the pet into a smaller world', () => {
    const pet = make();
    pet.setWorld(400, 300);
    pet.update(16);
    const hb = pet.view.hitbox;
    expect(hb.x).toBeGreaterThanOrEqual(-1e-6);
    expect(hb.x + hb.w).toBeLessThanOrEqual(400 + 1e-6);
    expect(hb.y).toBeGreaterThanOrEqual(-1e-6);
    expect(hb.y + hb.h).toBeLessThanOrEqual(300 + 1e-6);
  });
});

describe('wander', () => {
  it('walks around inside the world and hops while walking', () => {
    const pet = make({ mode: 'wander' });
    const seen = new Set<PetState>();
    let maxLift = 0;
    let travelled = 0;
    let last = pet.view.x;
    run(pet, 90_000, (p) => {
      seen.add(p.view.state);
      maxLift = Math.max(maxLift, p.view.lift);
      travelled += Math.abs(p.view.x - last);
      last = p.view.x;
      const hb = p.view.hitbox;
      expect(hb.x).toBeGreaterThanOrEqual(-1e-6);
      expect(hb.x + hb.w).toBeLessThanOrEqual(W + 1e-6);
      expect(hb.y).toBeGreaterThanOrEqual(-1e-6);
      expect(hb.y + hb.h).toBeLessThanOrEqual(H + 1e-6);
    });
    expect(seen.has('walk')).toBe(true);
    expect(seen.has('sit')).toBe(true);
    expect(travelled).toBeGreaterThan(300);
    expect(maxLift).toBeGreaterThan(2);
  });

  it('starts every walk at the beginning of its step, so a skin\'s own walk cycle stays in step with the hop', () => {
    const pet = make({ mode: 'wander' });
    const starts: number[] = [];
    let before: PetState = pet.view.state;
    for (let i = 0; i < 20_000 && starts.length < 4; i++) {
      pet.update(16);
      const v = pet.view;
      if ((v.state === 'walk' || v.state === 'run') && before !== v.state) starts.push(v.lift);
      before = v.state;
    }
    expect(starts.length).toBeGreaterThanOrEqual(3);
    // a hop is at most 8px high and a single 16ms frame into it is barely off the ground
    for (const lift of starts) expect(lift).toBeLessThan(1.2);
  });

  it('stays on the floor in floor roam mode', () => {
    const pet = make({ mode: 'wander', config: { roam: 'floor' } });
    run(pet, 60_000, (p) => {
      expect(p.view.y).toBe(H);
    });
  });

  it('drops back to the floor when roam switches to floor', () => {
    const pet = make({ mode: 'wander' });
    pet.setCursor({ x: 10, y: 10 });
    // lift the pet by dragging it
    const c = bodyCenter(pet);
    pet.pointerDown(c);
    pet.pointerMove({ x: c.x, y: c.y - 300 });
    pet.update(16);
    pet.pointerUp({ x: c.x, y: c.y - 300 });
    pet.setRoam('floor');
    run(pet, 4000);
    expect(pet.view.y).toBe(H);
  });
});

describe('follow', () => {
  it('walks to a distant cursor and stops at followStop without overlapping it', () => {
    const pet = make({ mode: 'follow' });
    const cursor = { x: 200, y: 300 };
    pet.setCursor(cursor);
    let minGap = Infinity;
    run(pet, 14_000, (p) => {
      minGap = Math.min(minGap, gap(followCenter(p), cursor));
    });
    const final = gap(followCenter(pet), cursor);
    expect(final).toBeGreaterThan(80);
    expect(final).toBeLessThan(100);
    expect(minGap).toBeGreaterThan(85);
    expect(['idle', 'sit']).toContain(pet.view.state);
  });

  it('sits when the cursor stays still and gets up when it moves', () => {
    const pet = make({ mode: 'follow' });
    pet.setCursor({ x: 640, y: 400 });
    run(pet, 12_000);
    expect(pet.view.state).toBe('sit');
    pet.setCursor({ x: 700, y: 400 });
    run(pet, 200);
    expect(pet.view.state).not.toBe('sit');
  });

  it('only moves horizontally in floor roam mode', () => {
    const pet = make({ mode: 'follow', config: { roam: 'floor' } });
    pet.setCursor({ x: 100, y: 100 });
    run(pet, 12_000, (p) => expect(p.view.y).toBe(H));
    expect(Math.abs(pet.view.x - 100)).toBeLessThan(120);
  });
});

describe('auto', () => {
  it('follows an active cursor and wanders off once it goes idle', () => {
    const pet = make({ mode: 'auto' });
    let t = 0;
    run(pet, 10_000, () => {
      t += 16;
      pet.setCursor({ x: 300 + 150 * Math.sin(t / 700), y: 350 });
    });
    const rest = { x: 300 + 150 * Math.sin(t / 700), y: 350 };
    pet.setCursor(rest);
    expect(gap(followCenter(pet), rest)).toBeLessThan(260);
    let farthest = 0;
    run(pet, 90_000, (p) => {
      farthest = Math.max(farthest, gap(followCenter(p), rest));
    });
    expect(farthest).toBeGreaterThan(300);
  });
});

describe('attach', () => {
  it('hangs below-right of the cursor and does not capture clicks', () => {
    const pet = make({ mode: 'attach' });
    pet.setCursor({ x: 500, y: 300 });
    run(pet, 3000);
    expect(pet.view.state).toBe('held');
    expect(pet.view.interactive).toBe(false);
    expect(pet.view.x).toBeCloseTo(518, 0);
    expect(pet.view.y).toBeCloseTo(300 + 14 + 0.94 * SPRITE_H, 0);
    pet.pointerDown(bodyCenter(pet));
    pet.pointerMove({ x: 0, y: 0 });
    expect(pet.view.state).toBe('held');
  });

  it('swings when the cursor moves sideways', () => {
    const pet = make({ mode: 'attach' });
    pet.setCursor({ x: 300, y: 300 });
    run(pet, 2000);
    let maxRot = 0;
    for (let i = 0; i < 12; i++) {
      pet.setCursor({ x: 300 + i * 40, y: 300 });
      pet.update(16);
      maxRot = Math.max(maxRot, pet.view.rot);
    }
    expect(maxRot).toBeGreaterThan(0.05);
    expect(pet.view.pivot).toBe('top');
  });

  it('drops to the floor when attach is switched off', () => {
    const pet = make({ mode: 'attach' });
    pet.setCursor({ x: 500, y: 200 });
    run(pet, 2000);
    pet.setMode('wander');
    const seen = new Set<PetState>();
    run(pet, 3000, (p) => seen.add(p.view.state));
    expect(seen.has('fall')).toBe(true);
    expect(seen.has('land')).toBe(true);
  });

  it('follows the cursor to the screen edge without leaving the world', () => {
    const pet = make({ mode: 'attach' });
    pet.setCursor({ x: W + 500, y: H + 500 });
    run(pet, 3000);
    const hb = pet.view.hitbox;
    expect(hb.x + hb.w).toBeLessThanOrEqual(W + 1e-6);
    expect(hb.y + hb.h).toBeLessThanOrEqual(H + 1e-6);
  });
});

describe('pointer interaction', () => {
  it('a click surprises the pet, then it settles', () => {
    const pet = make({ mode: 'wander' });
    pet.update(16);
    click(pet, bodyCenter(pet));
    pet.update(16);
    expect(pet.view.state).toBe('surprised');
    expect(pet.view.lift).toBeGreaterThan(0);
    run(pet, 600);
    expect(pet.view.state).not.toBe('surprised');
  });

  it('stops walking when the pointer comes to rest on it, and carries on once the pointer is gone', () => {
    const pet = make({ mode: 'wander' });
    for (let i = 0; i < 5000 && pet.view.state !== 'walk'; i++) pet.update(16);
    expect(pet.view.state).toBe('walk');
    const c = bodyCenter(pet);
    pet.pointerMove(c);
    pet.update(16);
    expect(pet.view.state).toBe('idle');
    const x0 = pet.view.x;
    for (let i = 0; i < 150; i++) {
      pet.pointerMove(c);
      pet.update(16);
    }
    expect(Math.abs(pet.view.x - x0)).toBeLessThan(1);
    // pointer events stop arriving: the pet must not stay frozen
    let moved = false;
    run(pet, 20_000, (p) => (moved ||= Math.abs(p.view.x - x0) > 20));
    expect(moved).toBe(true);
  });

  it('ignores clicks outside the body', () => {
    const pet = make({ mode: 'wander' });
    pet.update(16);
    const hb = pet.view.hitbox;
    click(pet, { x: hb.x - 40, y: hb.y - 40 });
    pet.update(16);
    expect(pet.view.state).not.toBe('surprised');
  });

  it('three quick clicks make the pet happy and spawn hearts', () => {
    const pet = make({ mode: 'wander' });
    pet.update(16);
    for (let i = 0; i < 3; i++) {
      click(pet, bodyCenter(pet));
      run(pet, 100);
    }
    expect(pet.view.state).toBe('happy');
    expect(pet.view.particles.some((p) => p.kind === 'heart')).toBe(true);
    run(pet, 4000);
    expect(pet.view.state).not.toBe('happy');
    expect(pet.view.particles.length).toBe(0);
  });

  it('rubbing back and forth makes the pet happy', () => {
    const pet = make({ mode: 'wander' });
    pet.update(16);
    const c = bodyCenter(pet);
    let x = c.x - 30;
    let dir = 1;
    let happy = false;
    for (let i = 0; i < 60 && !happy; i++) {
      x += dir * 12;
      if (x > c.x + 30 || x < c.x - 30) dir = -dir;
      pet.pointerMove({ x, y: c.y });
      pet.update(16);
      happy = pet.view.state === 'happy';
    }
    expect(happy).toBe(true);
  });

  it('dragging holds the pet; releasing drops it and it lands on the floor', () => {
    const pet = make({ mode: 'wander', config: { roam: 'floor' } });
    pet.update(16);
    const c = bodyCenter(pet);
    pet.pointerDown(c);
    pet.pointerMove({ x: c.x + 3, y: c.y });
    expect(pet.view.state).not.toBe('held');
    pet.pointerMove({ x: c.x + 100, y: c.y - 300 });
    pet.update(16);
    expect(pet.view.state).toBe('held');
    // the pet keeps its offset from the grabbed point instead of jumping to the pointer
    expect(pet.view.y).toBeCloseTo(H - 300, 0);
    expect(pet.view.x).toBeCloseTo(W / 2 + 100, 0);
    pet.pointerUp({ x: c.x + 100, y: c.y - 300 });
    const seen: PetState[] = [];
    let landedAt = NaN;
    run(pet, 4000, (p) => {
      if (seen[seen.length - 1] !== p.view.state) seen.push(p.view.state);
      if (p.view.state === 'land' && Number.isNaN(landedAt)) landedAt = p.view.y;
    });
    expect(seen).toContain('fall');
    expect(seen).toContain('land');
    expect(landedAt).toBe(H);
  });

  it('a flick throws the pet sideways', () => {
    const pet = make({ mode: 'wander', config: { roam: 'floor' } });
    pet.update(16);
    const c = bodyCenter(pet);
    pet.pointerDown(c);
    let p = { ...c };
    for (let i = 0; i < 6; i++) {
      p = { x: p.x + 40, y: p.y - 6 };
      pet.pointerMove(p);
      pet.update(16);
    }
    const startX = pet.view.x;
    pet.pointerUp(p);
    let maxX = startX;
    run(pet, 2000, (q) => (maxX = Math.max(maxX, q.view.x)));
    expect(maxX - startX).toBeGreaterThan(60);
  });

  it('setInteractive(false) ignores pointers and cancels a drag', () => {
    const pet = make({ mode: 'wander' });
    pet.update(16);
    const c = bodyCenter(pet);
    pet.pointerDown(c);
    pet.pointerMove({ x: c.x, y: c.y - 200 });
    pet.update(16);
    expect(pet.view.state).toBe('held');
    pet.setInteractive(false);
    pet.update(16);
    expect(pet.view.state).toBe('fall');
    expect(pet.view.interactive).toBe(false);
    run(pet, 3000);
    click(pet, bodyCenter(pet));
    pet.update(16);
    expect(pet.view.state).not.toBe('surprised');
  });
});

describe('sleep and startle', () => {
  it('falls asleep when nothing happens and wakes when the cursor moves', () => {
    const pet = make({ mode: 'wander', config: { sleepAfterMs: 2000 } });
    pet.setCursor({ x: 100, y: 100 });
    const seen = new Set<PetState>();
    run(pet, 30_000, (p) => seen.add(p.view.state));
    expect(seen.has('sleep')).toBe(true);
    expect(pet.view.state).toBe('sleep');
    expect(pet.view.particles.some((p) => p.kind === 'z')).toBe(true);
    pet.setCursor({ x: 300, y: 100 });
    run(pet, 100);
    expect(pet.view.state).not.toBe('sleep');
  });

  it('a pointer touching a sleeping pet startles it awake', () => {
    const pet = make({ mode: 'wander', config: { sleepAfterMs: 1000 } });
    pet.setCursor({ x: 100, y: 100 });
    run(pet, 20_000);
    expect(pet.view.state).toBe('sleep');
    pet.pointerMove(bodyCenter(pet));
    pet.update(16);
    expect(pet.view.state).toBe('surprised');
  });

  it('flees from a cursor racing toward it while wandering', () => {
    const pet = make({ mode: 'wander', config: { roam: 'floor' } });
    const start = pet.view.x;
    let x = start - 400 - 80;
    const y = H - 60;
    const seen = new Set<PetState>();
    for (let i = 0; i < 6; i++) {
      x += 48;
      pet.setCursor({ x, y });
      pet.update(16);
      seen.add(pet.view.state);
    }
    expect(pet.view.state).toBe('surprised');
    pet.setCursor({ x: 10, y });
    run(pet, 2500, (p) => seen.add(p.view.state));
    expect(seen.has('run')).toBe(true);
    expect(pet.view.x - start).toBeGreaterThan(150);
  });

  it('does not flee in follow mode', () => {
    const pet = make({ mode: 'follow' });
    let x = 100;
    for (let i = 0; i < 40; i++) {
      x += 60;
      pet.setCursor({ x, y: H - 60 });
      pet.update(16);
      expect(pet.view.state).not.toBe('surprised');
    }
  });
});

describe('robustness', () => {
  it('survives random input without NaN and stays on screen', () => {
    const rnd = mulberry32(42);
    const pet = make({ rng: mulberry32(3) });
    const modes: Mode[] = ['auto', 'follow', 'attach', 'wander'];
    let ww = W;
    let wh = H;
    for (let i = 0; i < 30_000; i++) {
      const r = rnd();
      if (r < 0.01) pet.setMode(modes[Math.floor(rnd() * 4)]!);
      else if (r < 0.02) pet.setScale(0.5 + rnd() * 2);
      else if (r < 0.03) pet.setRoam(rnd() < 0.5 ? 'free' : 'floor');
      else if (r < 0.035) {
        ww = 400 + rnd() * 1500;
        wh = 300 + rnd() * 800;
        pet.setWorld(ww, wh);
      } else if (r < 0.04) pet.setInteractive(rnd() < 0.7);
      else if (r < 0.4) pet.setCursor({ x: rnd() * ww, y: rnd() * wh });
      else if (r < 0.5) pet.pointerDown(bodyCenter(pet));
      else if (r < 0.6) pet.pointerMove({ x: rnd() * ww, y: rnd() * wh });
      else if (r < 0.7) pet.pointerUp({ x: rnd() * ww, y: rnd() * wh });
      else if (r < 0.72) pet.pointerLeave();
      pet.update(rnd() < 0.05 ? 200 : 16);

      const v = pet.view;
      for (const n of [v.x, v.y, v.sx, v.sy, v.rot, v.lift, v.hitbox.x, v.hitbox.y, v.hitbox.w, v.hitbox.h]) {
        if (!Number.isFinite(n)) throw new Error(`non-finite value at step ${i}: ${JSON.stringify(v)}`);
      }
      if (v.x < -1e-6 || v.x > ww + 1e-6 || v.y < -1e-6 || v.y > wh + 1e-6) {
        throw new Error(`left the world at step ${i}: ${v.x},${v.y} in ${ww}x${wh}`);
      }
    }
  });
});

describe('several screens', () => {
  const SIDE_BY_SIDE: Rect[] = [{ x: 0, y: 0, w: 1000, h: 600 }, { x: 1000, y: 0, w: 1000, h: 600 }];
  const TALLER: Rect[] = [{ x: 0, y: 0, w: 1000, h: 600 }, { x: 1000, y: 0, w: 1000, h: 800 }];
  const SHIFTED: Rect[] = [{ x: 0, y: 0, w: 1000, h: 800 }, { x: 1000, y: 100, w: 1000, h: 600 }];
  const STACKED: Rect[] = [{ x: 0, y: 0, w: 1000, h: 600 }, { x: 0, y: 600, w: 1000, h: 500 }];
  const multi = (region: Rect[], opts: Partial<PetOptions> = {}) =>
    new Pet({ world: { width: 1, height: 1 }, region, rng: mulberry32(7), ...opts });

  /** the body is on the screens: inside their union, whatever the layout */
  const onScreens = (pet: Pet, rects: Rect[]): boolean => {
    const hb = pet.view.hitbox;
    const covered = (x: number, y: number) => rects.some((r) => x >= r.x - 1e-6 && x <= r.x + r.w + 1e-6 && y >= r.y - 1e-6 && y <= r.y + r.h + 1e-6);
    return [0, 0.5, 1].every((fx) => [0, 0.5, 1].every((fy) => covered(hb.x + hb.w * fx, hb.y + hb.h * fy)));
  };

  function drag(pet: Pet, to: Vec2): void {
    const from = bodyCenter(pet);
    pet.pointerMove(from);
    pet.pointerDown(from);
    for (let i = 1; i <= 30; i++) {
      pet.pointerMove({ x: from.x + ((to.x - from.x) * i) / 30, y: from.y + ((to.y - from.y) * i) / 30 });
      pet.update(16);
    }
    // let it come to rest in the hand before letting go, so it is dropped rather than thrown
    for (let i = 0; i < 20; i++) pet.update(16);
    pet.pointerUp(to);
  }

  it('starts at the bottom centre of the first screen', () => {
    const pet = multi(SHIFTED);
    pet.update(16);
    expect(pet.view.x).toBeCloseTo(500);
    expect(pet.view.y).toBe(800);
  });

  it('follows a cursor onto the other screen, standing across the edge on the way', () => {
    const pet = multi(SIDE_BY_SIDE, { mode: 'follow' });
    const cursor = { x: 1700, y: 450 };
    pet.setCursor(cursor);
    let straddled = false;
    run(pet, 30_000, (p) => {
      const hb = p.view.hitbox;
      if (hb.x < 1000 && hb.x + hb.w > 1000) straddled = true;
      expect(onScreens(p, SIDE_BY_SIDE)).toBe(true);
    });
    expect(straddled).toBe(true);
    expect(gap(followCenter(pet), cursor)).toBeLessThan(150);
  });

  it('is dropped onto the floor of the screen it was dragged to', () => {
    const pet = multi(TALLER, { config: { roam: 'floor' } });
    pet.update(16);
    drag(pet, { x: 1500, y: 300 });
    run(pet, 5000);
    expect(pet.view.state).not.toBe('held');
    expect(pet.view.x).toBeGreaterThan(1400);
    expect(pet.view.x).toBeLessThan(1600);
    expect(pet.view.y).toBe(800);
    // dropped on the first screen it stays on that floor
    drag(pet, { x: 400, y: 300 });
    run(pet, 5000);
    expect(pet.view.y).toBe(600);
  });

  it('walks off the edge onto a lower floor and falls', () => {
    const pet = multi(TALLER, { mode: 'follow', config: { roam: 'floor' } });
    pet.setCursor({ x: 1700, y: 790 });
    const seen = new Set<PetState>();
    run(pet, 30_000, (p) => {
      seen.add(p.view.state);
      expect(onScreens(p, TALLER)).toBe(true);
    });
    expect(seen.has('fall')).toBe(true);
    expect(pet.view.y).toBe(800);
    expect(gap(followCenter(pet), { x: 1700, y: 790 })).toBeLessThan(160);
  });

  it('gets up onto a higher floor and is not stuck at the step', () => {
    const pet = multi(SHIFTED, { mode: 'follow', config: { roam: 'floor' } });
    pet.setCursor({ x: 1700, y: 690 });
    run(pet, 30_000, (p) => expect(onScreens(p, SHIFTED)).toBe(true));
    expect(pet.view.y).toBe(700);
    expect(gap(followCenter(pet), { x: 1700, y: 690 })).toBeLessThan(160);
  });

  it('wanders over every screen and never leaves them', () => {
    for (const layout of [SIDE_BY_SIDE, TALLER, SHIFTED]) {
      const pet = multi(layout, { mode: 'wander' });
      let left = false;
      let right = false;
      let walking = 0;
      let longestWalk = 0;
      run(pet, 240_000, (p) => {
        expect(onScreens(p, layout)).toBe(true);
        if (p.view.x < 900) left = true;
        if (p.view.x > 1100) right = true;
        walking = p.view.state === 'walk' || p.view.state === 'run' ? walking + 16 : 0;
        longestWalk = Math.max(longestWalk, walking);
      });
      expect(left && right).toBe(true);
      // a walk always ends: nothing keeps it pushing against an edge of the layout
      expect(longestWalk).toBeLessThan(40_000);
    }
  });

  it('lands on the lowest floor when the screens are stacked', () => {
    const pet = multi(STACKED, { config: { roam: 'floor' } });
    pet.update(16);
    drag(pet, { x: 500, y: 250 });
    run(pet, 6000);
    expect(pet.view.y).toBe(1100);
  });

  it('is moved onto the screens that are left when one is taken away', () => {
    const pet = multi(SIDE_BY_SIDE);
    pet.update(16);
    drag(pet, { x: 1500, y: 300 });
    run(pet, 4000);
    expect(pet.view.x).toBeGreaterThan(1400);
    pet.setRegion([SIDE_BY_SIDE[0]!]);
    pet.update(16);
    expect(onScreens(pet, [SIDE_BY_SIDE[0]!])).toBe(true);
    expect(pet.view.x).toBeLessThan(1000);
  });

  it('can be thrown from one screen to the other and bounces off the outer edge', () => {
    const pet = multi(SIDE_BY_SIDE);
    pet.update(16);
    const from = bodyCenter(pet);
    pet.pointerMove(from);
    pet.pointerDown(from);
    // a fast flick to the right
    for (let i = 1; i <= 12; i++) {
      pet.pointerMove({ x: from.x + i * 40, y: from.y - i * 6 });
      pet.update(16);
    }
    pet.pointerUp({ x: from.x + 12 * 40, y: from.y - 72 });
    let crossed = false;
    run(pet, 6000, (p) => {
      expect(onScreens(p, SIDE_BY_SIDE)).toBe(true);
      if (p.view.x > 1100) crossed = true;
    });
    expect(crossed).toBe(true);
  });
});

describe('speech', () => {
  const lines = parseLines({
    hover: ['HOVER'],
    click: ['CLICK-A', 'CLICK-B'],
    rub: ['RUB'],
    triple: ['TRIPLE'],
    pickup: ['PICKUP'],
    throw: ['THROW'],
    land: ['LAND'],
    sleep: ['SLEEP'],
    wake: ['WAKE'],
    idle: ['IDLE'],
    cross: ['CROSS'],
  });
  const texts = (pet: Pet) => pet.view.particles.filter((p) => p.kind === 'text');
  /** the words said last (older ones may still be fading out) */
  const latest = (pet: Pet) => texts(pet).at(-1)!;
  /** every kind of words seen while `body` runs */
  const seenWhile = (pet: Pet, body: (each: () => void) => void): Set<string> => {
    const seen = new Set<string>();
    body(() => {
      for (const t of texts(pet)) seen.add(t.text!);
    });
    return seen;
  };
  const talker = (opts: Partial<PetOptions> = {}, spoken = lines) => {
    const pet = make({ mode: 'wander', chatty: true, ...opts });
    pet.setLines(spoken);
    return pet;
  };
  const SENTENCE = parseLines({ click: ['세 번이나… 놀자는 거야!?'] });

  it('says nothing when the skin has no lines', () => {
    const pet = make({ mode: 'wander', chatty: true });
    pet.update(16);
    click(pet, bodyCenter(pet));
    run(pet, 2000);
    expect(texts(pet)).toHaveLength(0);
  });

  it('answers a click with one of the click lines', () => {
    const pet = talker();
    run(pet, 1200);
    click(pet, bodyCenter(pet));
    pet.update(16);
    const t = latest(pet);
    expect(['CLICK-A', 'CLICK-B']).toContain(t.text);
    expect(t.style).toBe('float');
  });

  it('sounds rise from above the head and are gone after a moment', () => {
    const pet = talker();
    pet.update(16);
    pet.say('click');
    const t = latest(pet);
    const head = pet.view.hitbox.y;
    expect(t.y).toBeLessThan(head);
    const y0 = t.y;
    run(pet, 600);
    expect(t.y).toBeLessThan(y0 - 12);
    run(pet, 1500);
    expect(texts(pet)).toHaveLength(0);
  });

  it('a sentence stays above the head for a while, then fades away', () => {
    const pet = talker({}, SENTENCE);
    pet.update(16);
    pet.say('click');
    const t = latest(pet);
    expect(t.style).toBe('hold');
    const y0 = t.y;
    run(pet, 1000);
    expect(texts(pet)).toHaveLength(1);
    expect(Math.abs(t.y - y0)).toBeLessThan(4);
    expect(t.age).toBeLessThan(t.life);
    run(pet, 5000);
    expect(texts(pet)).toHaveLength(0);
  });

  it('a sentence follows the pet when it walks', () => {
    const pet = talker({ config: { roam: 'floor' } }, SENTENCE);
    pet.setMode('follow');
    pet.setCursor({ x: W - 40, y: H - 40 });
    pet.update(16);
    pet.say('click');
    const t = latest(pet);
    const x0 = pet.view.x;
    run(pet, 900);
    expect(pet.view.x - x0).toBeGreaterThan(30);
    expect(latest(pet)).toBe(t);
    // it trails a little behind a pet that is running
    expect(Math.abs(t.x - pet.view.x)).toBeLessThan(25);
    expect(t.y).toBeLessThan(pet.view.hitbox.y);
  });

  it('keeps sentences inside the screen the pet is on', () => {
    const pet = talker({ world: { width: 420, height: 300 }, config: { roam: 'floor' } }, SENTENCE);
    pet.setMode('follow');
    pet.setCursor({ x: 410, y: 290 });
    run(pet, 6000);
    pet.say('click');
    const t = latest(pet);
    expect(t.x + t.w! / 2).toBeLessThanOrEqual(420);
    expect(t.x - t.w! / 2).toBeGreaterThanOrEqual(0);
  });

  it('words are scaled with the pet', () => {
    const small = talker();
    const big = talker({ config: { scale: 2 } });
    small.update(16);
    big.update(16);
    small.say('click');
    big.say('click');
    expect(latest(big).size!).toBeCloseTo(latest(small).size! * 2);
  });

  it('only one set of words is up at a time: a new answer cuts the old words off', () => {
    const pet = talker();
    pet.update(16);
    pet.say('click');
    run(pet, 200);
    pet.say('pickup');
    run(pet, 300);
    expect(texts(pet).map((t) => t.text)).toEqual(['PICKUP']);
  });

  it('greets shortly after the lines arrive, and again when another skin takes over', () => {
    const pet = make({ mode: 'wander' });
    pet.setLines(parseLines({ start: ['HELLO'] }));
    run(pet, 700);
    expect(texts(pet)).toHaveLength(0);
    run(pet, 300);
    expect(texts(pet).map((t) => t.text)).toEqual(['HELLO']);
    run(pet, 3000);
    pet.setLines(parseLines({ start: ['HI AGAIN'] }));
    run(pet, 1000);
    expect(texts(pet).map((t) => t.text)).toEqual(['HI AGAIN']);
  });

  it('does not greet when there is nothing to say', () => {
    const pet = make({ mode: 'wander' });
    pet.setLines(parseLines({}));
    expect(seenWhile(pet, (each) => run(pet, 3000, each)).size).toBe(0);
  });

  it('is silent when speech is off, and only answers when it is set to reactions', () => {
    const quiet = talker();
    quiet.setSpeech('off');
    quiet.update(16);
    click(quiet, bodyCenter(quiet));
    expect(seenWhile(quiet, (each) => run(quiet, 3000, each)).size).toBe(0);

    const reactive = talker({ config: { sleepAfterMs: 1e9 } });
    reactive.setSpeech('reactions');
    const seen = seenWhile(reactive, (each) => {
      run(reactive, 40_000, each);
      click(reactive, bodyCenter(reactive));
      run(reactive, 100, each);
    });
    expect(seen.has('IDLE')).toBe(false);
    expect([...seen].some((t) => t.startsWith('CLICK'))).toBe(true);
  });

  it('a rub is answered, and so are three quick clicks (with hearts)', () => {
    const rubbed = talker();
    rubbed.update(16);
    const c = bodyCenter(rubbed);
    let x = c.x - 30;
    let dir = 1;
    const seen = seenWhile(rubbed, (each) => {
      for (let i = 0; i < 60; i++) {
        x += dir * 12;
        if (x > c.x + 30 || x < c.x - 30) dir = -dir;
        rubbed.pointerMove({ x, y: c.y });
        rubbed.update(16);
        each();
      }
    });
    expect(seen.has('RUB')).toBe(true);

    const pet = talker();
    pet.update(16);
    const said = seenWhile(pet, (each) => {
      for (let i = 0; i < 3; i++) {
        click(pet, bodyCenter(pet));
        run(pet, 100, each);
      }
    });
    expect(said.has('TRIPLE')).toBe(true);
    expect(pet.view.particles.some((p) => p.kind === 'heart')).toBe(true);
  });

  it('says something when it is picked up, thrown and when it lands from high up', () => {
    const pet = talker({ config: { roam: 'floor' } });
    pet.update(16);
    const from = bodyCenter(pet);
    const seen = seenWhile(pet, (each) => {
      pet.pointerMove(from);
      pet.pointerDown(from);
      for (let i = 1; i <= 30; i++) {
        pet.pointerMove({ x: from.x, y: from.y - (i * 400) / 30 });
        pet.update(16);
        each();
      }
      run(pet, 400, each);
      pet.pointerUp({ x: from.x, y: from.y - 400 });
      run(pet, 3000, each);
    });
    expect(seen.has('PICKUP')).toBe(true);
    expect(seen.has('THROW')).toBe(true);
    expect(seen.has('LAND')).toBe(true);
  });

  it('a gentle release just above the floor is not a throw', () => {
    const pet = talker({ config: { roam: 'floor' } });
    pet.update(16);
    const from = bodyCenter(pet);
    const seen = seenWhile(pet, (each) => {
      pet.pointerMove(from);
      pet.pointerDown(from);
      for (let i = 1; i <= 20; i++) {
        pet.pointerMove({ x: from.x, y: from.y - 8 });
        pet.update(16);
        each();
      }
      run(pet, 400, each);
      pet.pointerUp({ x: from.x, y: from.y - 8 });
      run(pet, 2000, each);
    });
    expect(seen.has('THROW')).toBe(false);
    expect(seen.has('LAND')).toBe(false);
  });

  it('talks as it falls asleep and as it wakes up', () => {
    const pet = talker({ config: { sleepAfterMs: 1000 } });
    pet.setCursor({ x: 10, y: 10 });
    const seen = seenWhile(pet, (each) => {
      for (let i = 0; i < 600 && pet.view.state !== 'sleep'; i++) {
        pet.update(16);
        each();
      }
      expect(pet.view.state).toBe('sleep');
      run(pet, 1200, each);
      pet.setCursor({ x: 600, y: 400 });
      run(pet, 200, each);
    });
    expect(seen.has('SLEEP')).toBe(true);
    expect(seen.has('WAKE')).toBe(true);
  });

  it('talks to itself now and then when left alone', () => {
    const pet = talker({ config: { sleepAfterMs: 1e9 } });
    const seen = seenWhile(pet, (each) => run(pet, 90_000, each));
    expect(seen.has('IDLE')).toBe(true);
  });

  it('does not talk to itself while the pointer rests on it', () => {
    const pet = talker({ config: { sleepAfterMs: 1e9 } });
    pet.update(16);
    const c = bodyCenter(pet);
    const seen = seenWhile(pet, (each) => {
      for (let i = 0; i < 2500; i++) {
        pet.pointerMove(c);
        pet.update(16);
        each();
      }
    });
    expect(seen.has('IDLE')).toBe(false);
  });

  it('says something when it goes over to another screen', () => {
    const screens: Rect[] = [{ x: 0, y: 0, w: 1000, h: 600 }, { x: 1000, y: 0, w: 1000, h: 600 }];
    const pet = new Pet({ world: { width: 1, height: 1 }, region: screens, rng: mulberry32(7), mode: 'wander', chatty: true });
    pet.setLines(lines);
    run(pet, 1500);
    const from = bodyCenter(pet);
    const to = { x: 1500, y: 300 };
    const seen = seenWhile(pet, (each) => {
      pet.pointerMove(from);
      pet.pointerDown(from);
      for (let i = 1; i <= 40; i++) {
        pet.pointerMove({ x: from.x + ((to.x - from.x) * i) / 40, y: from.y + ((to.y - from.y) * i) / 40 });
        pet.update(16);
        each();
      }
      pet.pointerUp(to);
      run(pet, 500, each);
    });
    expect(pet.view.x).toBeGreaterThan(1000);
    expect(seen.has('CROSS')).toBe(true);
  });

  it('a change of screens is not a trip', () => {
    const pet = new Pet({ world: { width: 1, height: 1 }, region: [{ x: 0, y: 0, w: 1000, h: 600 }, { x: 1000, y: 0, w: 1000, h: 600 }], rng: mulberry32(7), mode: 'wander', chatty: true });
    pet.setLines(parseLines({ cross: ['CROSS'] }));
    run(pet, 500);
    const seen = seenWhile(pet, (each) => {
      pet.setRegion([{ x: 0, y: 0, w: 1000, h: 600 }]);
      run(pet, 500, each);
      pet.setRegion([{ x: 0, y: 0, w: 1000, h: 600 }, { x: 1000, y: 0, w: 1000, h: 600 }]);
      run(pet, 500, each);
    });
    expect(seen.size).toBe(0);
  });

  it('a skin\'s words never change how the pet behaves', () => {
    const quiet = make({ mode: 'wander' });
    const loud = make({ mode: 'wander' });
    loud.setLines(parseLines({}));
    const trail = (pet: Pet) => {
      const out: number[] = [];
      run(pet, 20_000, (p) => out.push(Math.round(p.view.x)));
      return out;
    };
    expect(trail(loud)).toEqual(trail(quiet));
  });
});

describe('being called', () => {
  const HERE = parseLines({ call: ['HERE'] });
  const words = (pet: Pet): string[] => pet.view.particles.filter((p) => p.kind === 'text').map((p) => p.text!);
  /** how far the pet is from the cursor the moment it first looks happy */
  function arrival(pet: Pet, cursor: Vec2, ms: number): { seen: Set<PetState>; gap: number } {
    const seen = new Set<PetState>();
    let at = Infinity;
    run(pet, ms, (p) => {
      seen.add(p.view.state);
      if (p.view.state === 'happy' && at === Infinity) at = gap(followCenter(p), cursor);
    });
    return { seen, gap: at };
  }

  it('comes running to the cursor, even while wandering, and is happy to be there', () => {
    const pet = make({ mode: 'wander' });
    pet.update(16);
    const cursor = { x: 1150, y: 500 };
    pet.setCursor(cursor);
    pet.call();
    const { seen, gap: at } = arrival(pet, cursor, 6000);
    expect(seen.has('run')).toBe(true);
    expect(at).toBeLessThan(110);
  });

  it('wakes a sleeping pet and sends it over', () => {
    const pet = make({ mode: 'wander', config: { sleepAfterMs: 1000 } });
    pet.setCursor({ x: 100, y: 100 });
    run(pet, 20_000);
    expect(pet.view.state).toBe('sleep');
    pet.call();
    pet.update(16);
    expect(pet.view.state).toBe('run');
  });

  it('answers only when it gets there', () => {
    const pet = make({ mode: 'wander' });
    pet.setLines(HERE);
    pet.update(16);
    pet.setCursor({ x: 1150, y: 500 });
    pet.call();
    let firstSeenIn: PetState | null = null;
    run(pet, 6000, (p) => {
      if (firstSeenIn === null && words(p).includes('HERE')) firstSeenIn = p.view.state;
    });
    expect(firstSeenIn).toBe('happy');
  });

  it('stops beside the cursor, on the side it came from, looking at it', () => {
    const pet = make({ mode: 'wander' });
    pet.update(16);
    const facingWhenHappy = (cursor: Vec2): number | null => {
      pet.setCursor(cursor);
      pet.call();
      let facing: number | null = null;
      run(pet, 6000, (p) => {
        if (p.view.state === 'happy' && facing === null) facing = p.view.facing;
      });
      return facing;
    };
    // the pet starts in the middle: a cursor to its left is looked at over its left shoulder, and the other way round
    expect(facingWhenHappy({ x: 100, y: 600 })).toBe(-1);
    expect(facingWhenHappy({ x: 900, y: 600 })).toBe(1);
  });

  it('only walks along the floor in floor roam mode', () => {
    const pet = make({ mode: 'wander', config: { roam: 'floor' } });
    pet.update(16);
    const cursor = { x: 1150, y: 300 };
    pet.setCursor(cursor);
    pet.call();
    let reached = false;
    run(pet, 6000, (p) => {
      expect(p.view.y).toBe(H);
      if (p.view.state === 'happy') reached = Math.abs(followCenter(p).x - cursor.x) < 110;
    });
    expect(reached).toBe(true);
  });

  it('drops in from above when the cursor is far away', () => {
    const pet = new Pet({ world: { width: 3000, height: 700 }, rng: mulberry32(7), mode: 'wander' });
    pet.update(16);
    const cursor = { x: 200, y: 400 };
    pet.setCursor(cursor);
    pet.call();
    pet.update(16);
    expect(pet.view.state).toBe('fall');
    expect(pet.view.x).toBeCloseTo(200, -1);
    expect(pet.view.y).toBeLessThan(200);
    const { seen, gap: at } = arrival(pet, cursor, 6000);
    expect(seen.has('land')).toBe(true);
    expect(at).toBeLessThan(110);
  });

  it('drops in at the cursor when it is on another screen, however close', () => {
    const screens: Rect[] = [{ x: 0, y: 0, w: 1000, h: 600 }, { x: 1000, y: 0, w: 1000, h: 600 }];
    const pet = new Pet({ world: { width: 1, height: 1 }, region: screens, rng: mulberry32(7), mode: 'wander' });
    pet.update(16);
    pet.setCursor({ x: 1100, y: 500 });
    pet.call();
    pet.update(16);
    expect(pet.view.state).toBe('fall');
    expect(pet.view.x).toBeGreaterThan(1000);
    run(pet, 4000);
    expect(pet.view.x).toBeGreaterThan(1000);
  });

  it('gives up on a cursor it cannot get beside instead of trying for ever', () => {
    // the cursor is in a gap between two screens: the nearest the pet can get to it is the edge of one of them
    const screens: Rect[] = [{ x: 0, y: 0, w: 1000, h: 600 }, { x: 1500, y: 0, w: 1000, h: 600 }];
    const pet = new Pet({ world: { width: 1, height: 1 }, region: screens, rng: mulberry32(7), mode: 'wander' });
    pet.setLines(HERE);
    pet.update(16);
    pet.setCursor({ x: 1250, y: 300 });
    pet.call();
    let t = 0;
    let happy = -1;
    let said = -1;
    run(pet, 20_000, (p) => {
      t += 16;
      if (p.view.state === 'happy' && happy < 0) happy = t;
      if (words(p).includes('HERE') && said < 0) said = t;
    });
    expect(happy).toBeGreaterThan(5000);
    expect(happy).toBeLessThan(10_000);
    expect(said).toBeGreaterThanOrEqual(happy);
  });

  it('just answers when the pet hangs off the cursor', () => {
    const pet = make({ mode: 'attach' });
    pet.setLines(HERE);
    pet.setCursor({ x: 400, y: 300 });
    run(pet, 1500);
    pet.call();
    pet.update(16);
    expect(words(pet)).toContain('HERE');
    expect(pet.view.state).toBe('held');
  });

  it('leaves a pet alone while it is being dragged', () => {
    const pet = make({ mode: 'wander' });
    pet.setLines(HERE);
    pet.update(16);
    const c = bodyCenter(pet);
    pet.pointerMove(c);
    pet.pointerDown(c);
    pet.pointerMove({ x: c.x + 40, y: c.y - 40 });
    pet.update(16);
    expect(pet.view.state).toBe('held');
    pet.setCursor({ x: 1100, y: 100 });
    pet.call();
    pet.update(16);
    expect(pet.view.state).toBe('held');
    pet.pointerUp({ x: c.x + 40, y: c.y - 40 });
    const said: string[] = [];
    run(pet, 8000, (p) => said.push(...words(p)));
    expect(said).not.toContain('HERE');
  });

  it('stops going when it is picked up on the way', () => {
    const pet = make({ mode: 'wander' });
    pet.setLines(HERE);
    pet.update(16);
    pet.setCursor({ x: 1200, y: 600 });
    pet.call();
    run(pet, 600);
    expect(pet.view.state).toBe('run');
    const c = bodyCenter(pet);
    pet.pointerMove(c);
    pet.pointerDown(c);
    pet.pointerMove({ x: c.x - 60, y: c.y - 60 });
    pet.pointerUp({ x: c.x - 60, y: c.y - 60 });
    const said: string[] = [];
    run(pet, 8000, (p) => said.push(...words(p)));
    expect(said).not.toContain('HERE');
  });

  it('keeps the pet on the screen however it is called', () => {
    const pet = new Pet({ world: { width: 1500, height: 800 }, rng: mulberry32(11), mode: 'auto' });
    const rnd = mulberry32(5);
    for (let i = 0; i < 400; i++) {
      pet.setCursor({ x: rnd() * 1700 - 100, y: rnd() * 900 - 50 });
      if (rnd() < 0.15) pet.call();
      run(pet, 200 + rnd() * 400);
      const v = pet.view;
      expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
      expect(v.hitbox.x).toBeGreaterThanOrEqual(-1e-6);
      expect(v.hitbox.x + v.hitbox.w).toBeLessThanOrEqual(1500 + 1e-6);
      expect(v.hitbox.y).toBeGreaterThanOrEqual(-1e-6);
      expect(v.hitbox.y + v.hitbox.h).toBeLessThanOrEqual(800 + 1e-6);
    }
  });
});

describe('noticing the computer', () => {
  const lines = parseLines({ welcome: ['BACK'], plug: ['PLUG'], unplug: ['UNPLUG'], lowBattery: ['LOW'] });
  const words = (pet: Pet): string[] => pet.view.particles.filter((p) => p.kind === 'text').map((p) => p.text!);
  const sleeper = (): Pet => {
    const pet = make({ mode: 'wander', config: { sleepAfterMs: 1000 } });
    pet.setLines(lines);
    pet.setCursor({ x: 100, y: 100 });
    run(pet, 20_000);
    expect(pet.view.state).toBe('sleep');
    return pet;
  };

  it('a user coming back wakes a sleeping pet, which is glad and says so', () => {
    const pet = sleeper();
    pet.notice('welcome');
    pet.update(16);
    expect(pet.view.state).toBe('happy');
    expect(words(pet)).toContain('BACK');
  });

  it('a charger going in cheers the pet up, and coming out startles it', () => {
    const pet = make({ mode: 'wander' });
    pet.setLines(lines);
    pet.update(16);
    pet.notice('plug');
    pet.update(16);
    expect(pet.view.state).toBe('happy');
    expect(words(pet)).toContain('PLUG');
    run(pet, 3000);
    pet.notice('unplug');
    pet.update(16);
    expect(pet.view.state).toBe('surprised');
    expect(words(pet)).toContain('UNPLUG');
  });

  it('a low battery startles it too', () => {
    const pet = make({ mode: 'wander' });
    pet.setLines(lines);
    pet.update(16);
    pet.notice('lowBattery');
    pet.update(16);
    expect(pet.view.state).toBe('surprised');
    expect(words(pet)).toContain('LOW');
  });

  it('a pet in someone\'s hand only says it', () => {
    const pet = make({ mode: 'wander' });
    pet.setLines(lines);
    pet.update(16);
    const c = bodyCenter(pet);
    pet.pointerMove(c);
    pet.pointerDown(c);
    pet.pointerMove({ x: c.x + 40, y: c.y - 40 });
    pet.update(16);
    pet.notice('unplug');
    pet.update(16);
    expect(pet.view.state).toBe('held');
    expect(words(pet)).toContain('UNPLUG');
  });

  it('still reacts when the skin has nothing to say', () => {
    const pet = make({ mode: 'wander' });
    pet.update(16);
    pet.notice('welcome');
    pet.update(16);
    expect(pet.view.state).toBe('happy');
    expect(words(pet)).toHaveLength(0);
  });

  it('is silent when speech is off, and answers when it is set to reactions', () => {
    const quiet = make({ mode: 'wander' });
    quiet.setLines(lines);
    quiet.setSpeech('off');
    quiet.update(16);
    quiet.notice('welcome');
    quiet.update(16);
    expect(words(quiet)).toHaveLength(0);

    const reactive = make({ mode: 'wander' });
    reactive.setLines(lines);
    reactive.setSpeech('reactions');
    reactive.update(16);
    reactive.notice('welcome');
    reactive.update(16);
    expect(words(reactive)).toContain('BACK');
  });

  it('does not say the same thing again when the news comes twice in a row', () => {
    const pet = make({ mode: 'wander' });
    pet.setLines(lines);
    pet.update(16);
    pet.notice('welcome');
    run(pet, 3000);
    expect(words(pet)).toHaveLength(0);
    pet.notice('welcome');
    pet.update(16);
    expect(words(pet)).toHaveLength(0);
    expect(pet.view.state).toBe('happy');
  });
});
