import { describe, expect, it } from 'vitest';
import { Pet, mulberry32, planHop, type Platform, type PetOptions } from '../src/engine';
import { parseLines } from '../src/engine/speech';

const W = 1280;
const H = 800;

const win = (id: string, x0: number, x1: number, y: number, ax = x0): Platform => ({ id, x0, x1, y, ax });

function make(seed = 1, opts: Partial<PetOptions> = {}, config: NonNullable<PetOptions['config']> = {}): Pet {
  const pet = new Pet({ world: { width: W, height: H }, rng: mulberry32(seed), mode: 'wander', config: { roam: 'floor', sleepAfterMs: 1e9, ...config }, ...opts });
  pet.update(16);
  return pet;
}

const run = (pet: Pet, ms: number, each?: () => void): void => {
  for (let t = 0; t < ms; t += 16) {
    pet.update(16);
    each?.();
  }
};

/** Takes the pet in hand, puts its feet at (x, y) and lets go without a throw: it drops from there. */
function dropAt(pet: Pet, x: number, y: number): void {
  const v = pet.view;
  const from = { x: v.hitbox.x + v.hitbox.w / 2, y: v.hitbox.y + v.hitbox.h / 2 };
  pet.pointerMove(from);
  pet.pointerDown(from);
  const to = { x: from.x + (x - v.x), y: from.y + (y - v.y) };
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    pet.pointerMove({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
    pet.update(16);
  }
  // stand still for a moment, so that the letting go is not a throw
  for (let i = 0; i < 12; i++) pet.update(16);
  pet.pointerUp(to);
  pet.pointerLeave();
}

describe('planHop', () => {
  it('lands the feet where it aims, coming down onto the place from above', () => {
    for (const [from, to] of [
      [{ x: 100, y: 800 }, { x: 300, y: 600 }],
      [{ x: 900, y: 800 }, { x: 700, y: 560 }],
      [{ x: 400, y: 500 }, { x: 400, y: 380 }],
    ]) {
      const hop = planHop(from!, to!, 2600, 46);
      expect(hop.vy).toBeLessThan(0);
      // fly it with small steps and see where it comes down
      let x = from!.x;
      let y = from!.y;
      let vy = hop.vy;
      let t = 0;
      let peak = y;
      let came = false;
      for (; t < 5; t += 0.0005) {
        const prev = y;
        vy += 2600 * 0.0005;
        x += hop.vx * 0.0005;
        y += vy * 0.0005;
        peak = Math.min(peak, y);
        if (vy > 0 && prev <= to!.y && y >= to!.y) {
          came = true;
          break;
        }
      }
      expect(came).toBe(true);
      expect(Math.abs(x - to!.x)).toBeLessThan(2);
      expect(Math.abs(t - hop.time)).toBeLessThan(0.01);
      // it rises a little above the place it is going to
      expect(peak).toBeLessThan(Math.min(from!.y, to!.y) - 40);
    }
  });
});

describe('standing on a window', () => {
  it('comes down on the top of a window and stays there', () => {
    const pet = make();
    pet.setPlatforms([win('w', 400, 900, 500)]);
    dropAt(pet, 650, 300);
    pet.update(16);
    expect(pet.view.state).toBe('fall');
    run(pet, 1200);
    expect(pet.view.y).toBe(500);
    expect(pet.perched).toBe('w');
    // time goes by and it does not sink through
    for (let i = 0; i < 6; i++) {
      run(pet, 1000);
      if (pet.perched === 'w') expect(pet.view.y).toBeCloseTo(500, 1);
    }
  });

  it('walks along the window and never stands past its ends while it is on it', () => {
    let onIt = 0;
    let total = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const pet = make(seed);
      pet.setPlatforms([win('w', 200, 1100, 500)]);
      dropAt(pet, 650, 300);
      run(pet, 1200);
      const xs: number[] = [];
      run(pet, 20_000, () => {
        total++;
        if (pet.perched === 'w') {
          onIt++;
          xs.push(pet.view.x);
          expect(pet.view.y).toBeCloseTo(500, 1);
        }
      });
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(200 - 6);
      expect(Math.max(...xs)).toBeLessThanOrEqual(1100 + 6);
      // it does walk about on it
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(40);
    }
    // and mostly stays up there (the walks that leave it are the minority)
    expect(onIt / total).toBeGreaterThan(0.4);
  });

  it('falls to the floor when the window goes away', () => {
    const pet = make();
    pet.setPlatforms([win('w', 400, 900, 500)]);
    dropAt(pet, 650, 300);
    run(pet, 1200);
    expect(pet.perched).toBe('w');
    pet.setPlatforms([]);
    run(pet, 48);
    expect(pet.view.state).toBe('fall');
    run(pet, 1500);
    expect(pet.view.y).toBe(H);
    expect(pet.perched).toBeNull();
  });

  it('goes along when the window is moved, smoothly, without losing its footing', () => {
    // asleep, so that the only thing that moves it is the window
    const pet = make(1, {}, { sleepAfterMs: 1 });
    pet.setPlatforms([win('w', 400, 900, 500)]);
    dropAt(pet, 650, 300);
    run(pet, 2500);
    expect(pet.view.state).toBe('sleep');
    const at = { x: pet.view.x, y: pet.view.y };
    pet.setPlatforms([win('w', 600, 1100, 460)]);
    pet.update(16);
    expect(pet.perched).toBe('w');
    expect(pet.view.x - at.x).toBeGreaterThan(0);
    expect(pet.view.x - at.x).toBeLessThan(200);
    run(pet, 900);
    expect(pet.perched).toBe('w');
    expect(pet.view.x).toBeCloseTo(at.x + 200, 0);
    expect(pet.view.y).toBeCloseTo(460, 0);
    expect(pet.view.state).toBe('sleep');
  });

  it('is not carried by a window that only got narrower from the left: the carry follows the window, not its visible part', () => {
    const pet = make(1, {}, { sleepAfterMs: 1 });
    pet.setPlatforms([win('w', 400, 900, 500, 400)]);
    dropAt(pet, 700, 300);
    run(pet, 2500);
    const x = pet.view.x;
    // another window now covers the left part: the visible stretch starts further right, the window itself did not move
    pet.setPlatforms([win('w', 550, 900, 500, 400)]);
    run(pet, 600);
    expect(pet.view.x).toBeCloseTo(x, 1);
    expect(pet.perched).toBe('w');
  });

  it('falls when the window shrinks away from under it', () => {
    const pet = make(1, {}, { sleepAfterMs: 1 });
    pet.setPlatforms([win('w', 400, 900, 500)]);
    dropAt(pet, 800, 300);
    run(pet, 2500);
    expect(pet.perched).toBe('w');
    pet.setPlatforms([win('w', 400, 600, 500)]);
    run(pet, 64);
    expect(pet.view.state).toBe('fall');
    run(pet, 1500);
    expect(pet.view.y).toBe(H);
  });

  it('steps off the end of a window it walks to, and goes on along the floor', () => {
    const pet = make(1, { mode: 'follow' });
    pet.setPlatforms([win('w', 400, 700, 500)]);
    dropAt(pet, 650, 300);
    run(pet, 1200);
    expect(pet.perched).toBe('w');
    // the mouse is far to the right
    pet.setCursor({ x: 1200, y: 700 });
    const seen = new Set<string>();
    run(pet, 6000, () => seen.add(pet.view.state));
    expect(seen.has('walk') || seen.has('run')).toBe(true);
    expect(seen.has('fall')).toBe(true);
    expect(pet.perched).toBeNull();
    expect(pet.view.y).toBe(H);
    expect(pet.view.x).toBeGreaterThan(900);
  });

  it('lets go of the window when it is picked up, and comes down on the next one it is dropped on', () => {
    const pet = make();
    pet.setPlatforms([win('a', 100, 500, 600), win('b', 700, 1100, 450)]);
    dropAt(pet, 300, 400);
    run(pet, 1200);
    expect(pet.perched).toBe('a');
    const v = pet.view;
    const grab = { x: v.hitbox.x + v.hitbox.w / 2, y: v.hitbox.y + v.hitbox.h / 2 };
    pet.pointerMove(grab);
    pet.pointerDown(grab);
    pet.pointerMove({ x: grab.x + 30, y: grab.y - 30 });
    pet.update(16);
    expect(pet.view.state).toBe('held');
    expect(pet.perched).toBeNull();
    dropAt(pet, 900, 300);
    run(pet, 1500);
    expect(pet.perched).toBe('b');
    expect(pet.view.y).toBe(450);
  });

  it('comes down on the highest window under it, and goes past a window that is narrower than the pet needs', () => {
    const pet = make();
    pet.setPlatforms([win('low', 300, 1000, 650), win('high', 300, 1000, 450), win('thin', 640, 660, 300)]);
    dropAt(pet, 650, 200);
    run(pet, 1500);
    expect(pet.perched).toBe('high');
  });

  it('goes on standing on the window when it is told to walk along floors only', () => {
    const pet = make(1, {}, { roam: 'free', sleepAfterMs: 1 });
    pet.setPlatforms([win('w', 400, 900, 500)]);
    dropAt(pet, 650, 300);
    run(pet, 2500);
    expect(pet.perched).toBe('w');
    pet.setRoam('floor');
    run(pet, 1500);
    expect(pet.perched).toBe('w');
    expect(pet.view.y).toBe(500);
    // and falls from it when it goes away, as any pet that walks along floors
    pet.setPlatforms([]);
    run(pet, 1500);
    expect(pet.view.y).toBe(H);
  });
});

describe('a pet that may roam the whole screen', () => {
  it('comes down on a window it is dropped on', () => {
    const pet = make(1, {}, { roam: 'free', sleepAfterMs: 1 });
    pet.setPlatforms([win('w', 400, 900, 500)]);
    dropAt(pet, 650, 300);
    run(pet, 2500);
    expect(pet.view.y).toBe(500);
    expect(pet.perched).toBe('w');
  });

  it('goes along with the window when it is moved', () => {
    const pet = make(1, {}, { roam: 'free', sleepAfterMs: 1 });
    pet.setPlatforms([win('w', 400, 900, 500)]);
    dropAt(pet, 650, 300);
    run(pet, 2500);
    const x = pet.view.x;
    pet.setPlatforms([win('w', 500, 1000, 420)]);
    run(pet, 900);
    expect(pet.perched).toBe('w');
    expect(pet.view.x).toBeCloseTo(x + 100, 0);
    expect(pet.view.y).toBeCloseTo(420, 0);
  });

  it('stays where it is in the air when the window goes away, as it may', () => {
    const pet = make(1, {}, { roam: 'free', sleepAfterMs: 1 });
    pet.setPlatforms([win('w', 400, 900, 500)]);
    dropAt(pet, 650, 300);
    run(pet, 2500);
    pet.setPlatforms([]);
    run(pet, 2500);
    expect(pet.perched).toBeNull();
    expect(pet.view.y).toBe(500);
    expect(pet.view.state).toBe('sleep');
  });

  it('now and then goes and stands on the top of a window by itself', () => {
    const pet = make(2, {}, { roam: 'free' });
    pet.setPlatforms([win('w', 400, 900, 500)]);
    let standing = 0;
    let first = -1;
    let t = 0;
    run(pet, 240_000, () => {
      t += 16;
      if (pet.perched === 'w') {
        standing++;
        if (first < 0) first = t;
        expect(Math.abs(pet.view.y - 500)).toBeLessThan(2);
      }
    });
    expect(first).toBeGreaterThan(0);
    // and not only once
    expect(standing).toBeGreaterThan(500);
  });

  it('uses the same random numbers as before when there are no windows', () => {
    const a = make(4, {}, { roam: 'free' });
    const b = make(4, {}, { roam: 'free' });
    b.setPlatforms([]);
    for (let i = 0; i < 4000; i++) {
      a.update(16);
      b.update(16);
      expect(b.view.x).toBe(a.view.x);
      expect(b.view.y).toBe(a.view.y);
    }
  });
});

describe('hopping up onto a window', () => {
  it('jumps up onto a window a little above it now and then, rising first and coming down on top', () => {
    const pet = make(2);
    pet.setPlatforms([win('w', 400, 900, 650)]);
    const seen = new Set<string>();
    let highest = H;
    let landedAt = -1;
    let t = 0;
    run(pet, 90_000, () => {
      t += 16;
      seen.add(pet.view.state);
      highest = Math.min(highest, pet.view.y);
      if (landedAt < 0 && pet.perched === 'w') landedAt = t;
    });
    expect(landedAt).toBeGreaterThan(0);
    expect(seen.has('fall')).toBe(true);
    // it went above the top of the window on the way
    expect(highest).toBeLessThan(650);
  });

  it('flies the arc it planned: up from the floor, over the edge, down on the window', () => {
    const pet = make(3);
    pet.setPlatforms([win('w', 600, 1000, 640)]);
    const path: { x: number; y: number; state: string }[] = [];
    let took = false;
    run(pet, 120_000, () => {
      const v = pet.view;
      if (!took && v.state === 'fall') took = true;
      if (took && path.length < 400) path.push({ x: v.x, y: v.y, state: v.state });
      if (took && pet.perched === 'w' && path.length > 5) took = false;
    });
    expect(path.length).toBeGreaterThan(10);
    const first = path[0]!;
    expect(first.y).toBeLessThanOrEqual(H);
    // the feet go up first
    expect(path[3]!.y).toBeLessThan(first.y);
    const top = Math.min(...path.map((p) => p.y));
    expect(top).toBeLessThan(640 - 20);
    const last = path.filter((p) => p.state === 'fall').at(-1)!;
    expect(last.y).toBeGreaterThan(top);
  });

  it('does not try for a window that is too high above it', () => {
    const pet = make(4);
    pet.setPlatforms([win('w', 400, 900, 400)]);
    run(pet, 120_000, () => expect(pet.perched).toBeNull());
  });

  it('comes down on the floor when the window goes away in the middle of the jump', () => {
    const pet = make(2);
    pet.setPlatforms([win('w', 400, 900, 650)]);
    let jumped = false;
    run(pet, 120_000, () => {
      if (!jumped && pet.view.state === 'fall' && pet.view.y < H - 10) {
        jumped = true;
        pet.setPlatforms([]);
      }
    });
    expect(jumped).toBe(true);
    run(pet, 2000);
    expect(pet.perched).toBeNull();
    expect(pet.view.y).toBe(H);
  });

  it('can climb on, and then hop up to a higher window from there', () => {
    const pet = make(5);
    pet.setPlatforms([win('low', 100, 700, 650), win('high', 300, 900, 520)]);
    const stood = new Set<string>();
    run(pet, 240_000, () => {
      const on = pet.perched;
      if (on) stood.add(on);
    });
    expect(stood.has('low')).toBe(true);
    expect(stood.has('high')).toBe(true);
  });
});

describe('without any windows', () => {
  it('behaves exactly as before, and uses the same random numbers', () => {
    const a = make(9);
    const b = make(9);
    b.setPlatforms([]);
    const c = make(9);
    c.setPlatforms([win('far-above', 100, 200, -500)]);
    for (let i = 0; i < 4000; i++) {
      a.update(16);
      b.update(16);
      c.update(16);
      expect(b.view.x).toBe(a.view.x);
      expect(b.view.state).toBe(a.view.state);
      expect(c.view.x).toBe(a.view.x);
      expect(c.view.state).toBe(a.view.state);
    }
  });
});

describe('what it says', () => {
  const LINES = parseLines({ land: ['THUD'] });
  const said = (pet: Pet): string[] => pet.view.particles.filter((p) => p.kind === 'text').map((p) => p.text!);

  it('says something when it drops a long way onto a window, but not when it jumps there on purpose', () => {
    const fell = make(1, { chatty: true });
    fell.setLines(LINES);
    fell.setPlatforms([win('w', 400, 900, 600)]);
    dropAt(fell, 650, 100);
    const heard = new Set<string>();
    run(fell, 1500, () => said(fell).forEach((w) => heard.add(w)));
    expect(heard.has('THUD')).toBe(true);

    const hopper = make(2, { chatty: true });
    hopper.setLines(LINES);
    hopper.setPlatforms([win('w', 400, 900, 650)]);
    // what it says in the moments after it has jumped up onto the window
    const words = new Set<string>();
    let since = -1;
    run(hopper, 90_000, () => {
      if (since < 0 && hopper.perched === 'w') since = 0;
      if (since >= 0 && since < 400) {
        since += 16;
        said(hopper).forEach((w) => words.add(w));
      }
    });
    expect(since).toBeGreaterThanOrEqual(400);
    expect(words.has('THUD')).toBe(false);
  });
});
