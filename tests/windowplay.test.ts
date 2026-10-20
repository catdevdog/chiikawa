import { describe, expect, it } from 'vitest';
import { Pet, mulberry32, type PetOptions, type Platform, type Side } from '../src/engine';
import { defaultHang, HANG_SHOWN } from '../src/engine/peek';
import { sidesFrom, type WindowBox } from '../src/shell/perch';

const W = 1280;
const H = 800;

const win = (id: string, x0: number, x1: number, y: number, ax = x0): Platform => ({ id, x0, x1, y, ax });
const box = (id: string, x: number, y: number, w: number, h: number): WindowBox => ({ id, x, y, w, h });

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

/**
 * Takes the pet in hand, puts its feet at (x, y) and lets go: standing still for a moment first (not a throw), or, with
 * `fling`, moving fast to the last step (a throw).
 */
function dropAt(pet: Pet, x: number, y: number, fling = false): void {
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
  if (fling) {
    // a fast last stretch: well over the speed that still counts as putting it down
    const beyond = { x: to.x + 120, y: to.y };
    pet.pointerMove({ x: to.x + 60, y: to.y });
    pet.update(16);
    pet.pointerMove(beyond);
    pet.update(16);
    pet.pointerUp(beyond);
  } else {
    for (let i = 0; i < 12; i++) pet.update(16);
    pet.pointerUp(to);
  }
  pet.pointerLeave();
}

describe('looking over the top edge of a window', () => {
  const TOP = win('w', 300, 1000, 500);

  /** a pet standing on the window, that does it often (the chatty ones do everything often) */
  function onWindow(seed = 1, config: NonNullable<PetOptions['config']> = {}): Pet {
    const pet = make(seed, { chatty: true }, config);
    pet.setPlatforms([TOP]);
    dropAt(pet, 650, 300);
    run(pet, 1500);
    expect(pet.perched).toBe('w');
    return pet;
  }

  /** runs until it looks over the edge (or the time is up) */
  function untilHanging(pet: Pet, ms = 60_000): boolean {
    for (let t = 0; t < ms; t += 16) {
      pet.update(16);
      if (pet.hanging) return true;
    }
    return false;
  }

  it('does it now and then on a window, standing on the edge with only its upper part in view', () => {
    let seen = 0;
    for (const seed of [1, 2, 3, 4]) {
      const pet = onWindow(seed);
      expect(untilHanging(pet)).toBe(true);
      seen++;
      expect(pet.view.state).toBe('hang');
      // on the feet line, which is the edge; nothing of it is below
      expect(pet.view.y).toBeCloseTo(500, 1);
      const r = pet.view.hitbox;
      expect(r.y + r.h).toBeCloseTo(500, 5);
      expect(r.x + r.w / 2).toBeCloseTo(pet.view.x, 5);
      // the picture is its own pose: nothing of the engine's squash
      expect(pet.view.sx).toBe(1);
      expect(pet.view.sy).toBe(1);
      expect(pet.perched).toBe('w');
    }
    expect(seen).toBe(4);
  });

  it('is over when its time is up, and it goes on as before', () => {
    const pet = onWindow(2);
    expect(untilHanging(pet)).toBe(true);
    let ms = 0;
    while (pet.hanging && ms < 20_000) {
      pet.update(16);
      ms += 16;
    }
    expect(pet.hanging).toBe(false);
    expect(ms).toBeGreaterThan(1000);
    // still on the window
    expect(pet.perched).toBe('w');
    expect(['idle', 'sit', 'walk']).toContain(pet.view.state);
  });

  it('never does it on the floor, or in the air', () => {
    const pet = make(3, { chatty: true });
    let hung = false;
    run(pet, 90_000, () => {
      if (pet.hanging) hung = true;
    });
    expect(hung).toBe(false);
    // no window: the random numbers are the same as before this was there
    const a = make(4);
    const b = make(4);
    b.setPlatforms([]);
    run(a, 30_000);
    run(b, 30_000);
    expect(b.view.x).toBe(a.view.x);
  });

  it('is only in view as far as its picture goes: the hit area is the rectangle over the edge, nothing below it', () => {
    const pet = onWindow(1, { hang: { half: 40, top: 60 } });
    expect(untilHanging(pet)).toBe(true);
    const x = pet.view.x;
    const r = pet.view.hitbox;
    expect(r.x).toBeCloseTo(x - 40, 5);
    expect(r.w).toBeCloseTo(80, 5);
    expect(r.h).toBeCloseTo(60, 5);
    expect(pet.isOver({ x, y: 500 - 30 })).toBe(true);
    expect(pet.isOver({ x: x + 39, y: 500 - 59 })).toBe(true);
    // under the edge, and beside the picture, there is nothing to click
    expect(pet.isOver({ x, y: 500 + 5 })).toBe(false);
    expect(pet.isOver({ x: x + 60, y: 500 - 30 })).toBe(false);
  });

  it('comes up pleased when it is clicked, and says it was found', () => {
    const pet = onWindow(1, { hang: { half: 40, top: 60 } });
    pet.setLines({ found: [{ text: 'Found me!', style: 'float' }] });
    expect(untilHanging(pet)).toBe(true);
    const on = { x: pet.view.x, y: 500 - 30 };
    pet.pointerMove(on);
    pet.pointerDown(on);
    pet.pointerUp(on);
    pet.update(16);
    expect(pet.hanging).toBe(false);
    expect(pet.view.state).toBe('happy');
    expect(pet.view.particles.some((p) => p.kind === 'text' && p.text === 'Found me!')).toBe(true);
    // it is no click towards three of them
    expect(pet.takeTriple()).toBe(false);
  });

  it('is picked up from the edge when it is dragged', () => {
    const pet = onWindow(1, { hang: { half: 40, top: 60 } });
    expect(untilHanging(pet)).toBe(true);
    const on = { x: pet.view.x, y: 500 - 30 };
    pet.pointerDown(on);
    pet.pointerMove({ x: on.x + 60, y: on.y - 60 });
    pet.update(16);
    expect(pet.view.state).toBe('held');
    expect(pet.hanging).toBe(false);
  });

  it('goes along with the window while it looks over the edge', () => {
    const pet = onWindow(1);
    expect(untilHanging(pet)).toBe(true);
    const x0 = pet.view.x;
    pet.setPlatforms([win('w', 400, 1100, 560, 400)]);
    run(pet, 700);
    expect(pet.hanging || pet.perched === 'w').toBe(true);
    expect(pet.view.y).toBeCloseTo(560, 1);
    expect(pet.view.x).toBeGreaterThan(x0 + 90);
  });

  it('lets go when the window goes away: a pet that walks along a floor falls', () => {
    const pet = onWindow(1);
    expect(untilHanging(pet)).toBe(true);
    pet.setPlatforms([]);
    pet.update(16);
    pet.update(16);
    expect(pet.hanging).toBe(false);
    expect(pet.view.state).toBe('fall');
    run(pet, 2000);
    expect(pet.view.y).toBe(H);
  });

  it('stops when the pet is called, and when the others hide', () => {
    const called = onWindow(1);
    expect(untilHanging(called)).toBe(true);
    called.setCursor({ x: 200, y: 700 });
    called.call();
    called.update(16);
    expect(called.hanging).toBe(false);

    const hid = onWindow(2);
    expect(untilHanging(hid)).toBe(true);
    hid.hideAt({ x: W, side: 1, floorY: H, y: H });
    hid.update(16);
    expect(hid.hanging).toBe(false);
    expect(hid.peeking).toBe(true);
  });

  it('talks to itself while it looks over the edge, with the words for hiding', () => {
    const pet = onWindow(5);
    pet.setLines({ peek: [{ text: 'hmm', style: 'float' }] });
    expect(untilHanging(pet)).toBe(true);
    let said = false;
    run(pet, 4000, () => {
      if (pet.view.particles.some((p) => p.kind === 'text' && p.text === 'hmm')) said = true;
    });
    expect(said).toBe(true);
  });

  it('shows the top of its ordinary picture when the skin has none for it: the layout comes from the hitbox', () => {
    const sprite = { w: 100, h: 200, anchorX: 0.5, anchorY: 0.9 };
    const hitbox = { x: 0.2, y: 0.1, w: 0.6, h: 0.8 };
    const l = defaultHang(sprite, hitbox);
    expect(l.half).toBeCloseTo(30, 5);
    expect(l.top).toBeCloseTo(HANG_SHOWN * 0.8 * 200, 5);
  });
});

describe('hiding at the side of a window', () => {
  // a window with its left edge at 400 and its right edge at 900, from 300 to 700
  const WINDOW = box('w', 400, 300, 500, 400);
  const sides = (...boxes: WindowBox[]): Side[] => sidesFrom(boxes);

  function setup(boxes: WindowBox[] = [WINDOW], opts: Partial<PetOptions> = {}, config: NonNullable<PetOptions['config']> = {}): Pet {
    const pet = make(1, opts, config);
    pet.setSides(sidesFrom(boxes));
    return pet;
  }

  const settle = (pet: Pet, ms = 4000): void => {
    for (let t = 0; t < ms; t += 16) {
      pet.update(16);
      if (pet.view.state === 'peek' && pet.view.animating === false) return;
    }
  };

  it('holds on and hides when it is let go beside the left edge of a window, outside it', () => {
    const pet = setup();
    dropAt(pet, 380, 500);
    expect(pet.peeking).toBe(true);
    expect(pet.attached).toBe(true);
    expect(pet.windowId).toBe('w');
    settle(pet);
    expect(pet.view.state).toBe('peek');
    // to the left of the edge, looking away from the window; its picture meets the edge
    expect(pet.view.facing).toBe(-1);
    const r = pet.view.hitbox;
    expect(r.x + r.w).toBeCloseTo(400, 5);
    expect(pet.view.y).toBeCloseTo(500, 1);
  });

  it('hides at the right edge the other way round', () => {
    const pet = setup();
    dropAt(pet, 920, 520);
    expect(pet.attached).toBe(true);
    settle(pet);
    expect(pet.view.facing).toBe(1);
    const r = pet.view.hitbox;
    expect(r.x).toBeCloseTo(900, 5);
    expect(pet.view.y).toBeCloseTo(520, 1);
  });

  it('does not hide in the middle of a window, up at its corner, or when thrown', () => {
    const middle = setup();
    dropAt(middle, 650, 500);
    middle.update(16);
    expect(middle.attached).toBe(false);
    expect(middle.view.state).toBe('fall');

    const corner = setup();
    dropAt(corner, 380, 310);
    expect(corner.attached).toBe(false);

    const thrown = setup();
    dropAt(thrown, 380, 500, true);
    thrown.update(16);
    expect(thrown.attached).toBe(false);
    expect(thrown.view.state).toBe('fall');
  });

  it('does not hide where the window is too short for its picture, or the picture would be off the screens', () => {
    const short = setup([box('w', 400, 300, 500, 60)]);
    dropAt(short, 380, 330);
    expect(short.attached).toBe(false);

    // the left edge of a window at the left of the screen: the picture would be outside the screens
    const docked = setup([box('w', 10, 300, 500, 400)]);
    dropAt(docked, 20, 500);
    expect(docked.attached).toBe(false);
    // its right edge has room
    const other = setup([box('w', 10, 300, 500, 400)]);
    dropAt(other, 530, 500);
    expect(other.attached).toBe(true);
  });

  it('does not hide where another window covers the edge', () => {
    // a window in front covers the lower part of the left edge
    const front = box('f', 300, 450, 300, 250);
    const covered = setup([front, WINDOW]);
    dropAt(covered, 380, 600);
    expect(covered.attached).toBe(false);
    // above it the edge is free
    const free = setup([front, WINDOW]);
    dropAt(free, 380, 400);
    expect(free.attached).toBe(true);
  });

  it('stays hidden, goes where the window goes, and keeps its place along the edge', () => {
    const pet = setup();
    dropAt(pet, 380, 500);
    settle(pet);
    const before = pet.view.hitbox;
    expect(pet.view.y).toBeCloseTo(500, 1);
    // the window moves right and down: the picture goes with it, at the same place along the edge
    pet.setSides(sidesFrom([box('w', 600, 340, 500, 400)]));
    pet.update(16);
    expect(pet.view.state).toBe('peek');
    const after = pet.view.hitbox;
    expect(after.x + after.w).toBeCloseTo(600, 5);
    expect(pet.view.y).toBeCloseTo(540, 1);
    expect(after.w).toBeCloseTo(before.w, 5);
  });

  it('goes to the other edge of a resized window, and is kept clear of its ends when it gets short', () => {
    const pet = setup();
    dropAt(pet, 920, 520);
    settle(pet);
    // the window gets wider: the right edge moves out, and the pet with it
    pet.setSides(sidesFrom([box('w', 400, 300, 700, 400)]));
    pet.update(16);
    const r = pet.view.hitbox;
    expect(r.x).toBeCloseTo(1100, 5);
    // it gets shorter: the pet stays within the window's height
    pet.setSides(sidesFrom([box('w', 400, 300, 700, 230)]));
    pet.update(16);
    const l = pet.peekLayout;
    expect(pet.view.y).toBeLessThanOrEqual(530 - l.bottom * pet.view.scale);
    expect(pet.view.y).toBeGreaterThanOrEqual(300 + l.top * pet.view.scale);
  });

  it('lets go and falls when the window goes away (after a moment, so that a flicker does not drop it)', () => {
    const pet = setup();
    dropAt(pet, 380, 500);
    settle(pet);
    pet.setSides([]);
    run(pet, 300);
    expect(pet.attached).toBe(true);
    // the window is back: it never let go
    pet.setSides(sidesFrom([WINDOW]));
    run(pet, 800);
    expect(pet.attached).toBe(true);
    pet.setSides([]);
    run(pet, 700);
    expect(pet.attached).toBe(false);
    expect(pet.view.state).toBe('fall');
    run(pet, 2500);
    expect(pet.view.y).toBe(H);
  });

  it('lets go when the picture no longer has room on the screens (the window is pushed off to the side)', () => {
    const pet = setup();
    dropAt(pet, 380, 500);
    settle(pet);
    // its left edge is at the border of the screens now: the picture would be outside them
    pet.setSides(sidesFrom([box('w', 0, 300, 500, 400)]));
    run(pet, 700);
    expect(pet.attached).toBe(false);
  });

  it('comes out when it is clicked, alone, without finding anyone else', () => {
    const pet = setup();
    dropAt(pet, 380, 500);
    settle(pet);
    const r = pet.view.hitbox;
    const on = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    pet.pointerMove(on);
    pet.pointerDown(on);
    pet.pointerUp(on);
    expect(pet.takeFound()).toBe(false);
    expect(pet.attached).toBe(false);
    expect(pet.peeking).toBe(false);
    run(pet, 2500);
    expect(pet.view.y).toBe(H);
  });

  it('can be dragged off, which is not finding anyone else either, and then put down anywhere', () => {
    const pet = setup();
    dropAt(pet, 380, 500);
    settle(pet);
    const r = pet.view.hitbox;
    const on = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    pet.pointerDown(on);
    pet.pointerMove({ x: on.x - 120, y: on.y - 50 });
    pet.update(16);
    expect(pet.view.state).toBe('held');
    expect(pet.attached).toBe(false);
    expect(pet.takeFound()).toBe(false);
    // put down beside the other edge of the window it hides there
    dropAt(pet, 920, 450);
    expect(pet.attached).toBe(true);
    settle(pet);
    expect(pet.view.hitbox.x).toBeCloseTo(900, 5);
  });

  it('is not freed by the others coming out of hiding, only by being clicked', () => {
    const pet = setup();
    dropAt(pet, 380, 500);
    settle(pet);
    pet.unhide(false);
    expect(pet.attached).toBe(true);
    pet.unhide(true);
    expect(pet.attached).toBe(false);
  });

  it('is called out from the window, as a pet is from a wall', () => {
    const pet = setup();
    dropAt(pet, 380, 500);
    settle(pet);
    pet.setCursor({ x: 200, y: 700 });
    pet.call();
    run(pet, 100);
    expect(pet.attached).toBe(false);
  });

  it('finds no side when it has none, and the drop is a drop as it always was', () => {
    const pet = make(1);
    dropAt(pet, 380, 500);
    pet.update(16);
    expect(pet.attached).toBe(false);
    expect(pet.view.state).toBe('fall');
  });
});

describe('the edges of windows', () => {
  it('has a left and a right edge for each window, front to back, named after the window', () => {
    const list = sidesFrom([box('a', 100, 100, 400, 300), box('b', 600, 200, 300, 300)]);
    expect(list.map((s) => s.id)).toEqual(['a:L', 'a:R', 'b:L', 'b:R']);
    expect(list.map((s) => s.side)).toEqual([1, -1, 1, -1]);
    expect(list.map((s) => s.x)).toEqual([100, 500, 600, 900]);
    expect(list[0]!.y0).toBe(100);
    expect(list[0]!.y1).toBe(400);
    expect(list[0]!.free).toEqual([[100, 400]]);
  });

  it('takes out of an edge what a window in front covers', () => {
    // b is in front and reaches over the left edge of a, from y 250 down
    const list = sidesFrom([box('b', 50, 250, 300, 300), box('a', 100, 100, 400, 400)]);
    const left = list.find((s) => s.id === 'a:L')!;
    expect(left.free).toEqual([[100, 250]]);
    // the right edge of a is beyond b: free all the way
    expect(list.find((s) => s.id === 'a:R')!.free).toEqual([[100, 500]]);
    // the edges of the window in front are never covered
    expect(list.find((s) => s.id === 'b:L')!.free).toEqual([[250, 550]]);
  });

  it('drops the stretches that are too short for a pet to stand at', () => {
    const list = sidesFrom([box('b', 0, 130, 300, 370), box('a', 100, 100, 400, 400)]);
    // b covers a's left edge from 130 down: only 30 px are left at the top
    expect(list.find((s) => s.id === 'a:L')!.free).toEqual([]);
  });

  it('counts a window once', () => {
    const list = sidesFrom([box('a', 100, 100, 400, 300), box('a', 100, 100, 400, 300)]);
    expect(list).toHaveLength(2);
  });
});
