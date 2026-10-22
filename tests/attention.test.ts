import { describe, expect, it } from 'vitest';
import { mulberry32, Pet, type PetOptions, type Vec2 } from '../src/engine';
import { approach, ATTENTION_AFTER_MS, ATTENTION_COOLDOWN_MS, BEG_MS, BREAK_PX, Deviation, PULL_MIN, STILL_MS } from '../src/engine/attention';
import { parseLines } from '../src/engine/speech';

const W = 1280;
const H = 800;
const STEP = 16;

describe('approach', () => {
  it('moves a step towards the goal, and stops at it', () => {
    expect(approach({ x: 0, y: 0 }, { x: 10, y: 0 }, 4)).toEqual({ x: 4, y: 0 });
    expect(approach({ x: 0, y: 0 }, { x: 3, y: 4 }, 2.5)).toEqual({ x: 1.5, y: 2 });
    expect(approach({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toEqual({ x: 3, y: 4 });
    expect(approach({ x: 7, y: 7 }, { x: 7, y: 7 }, 5)).toEqual({ x: 7, y: 7 });
  });
});

describe('Deviation', () => {
  const put = { x: 500, y: 400 };

  it('does not take the rounding of a scaled screen for a hand', () => {
    const d = new Deviation();
    let size = 0;
    for (let i = 0; i < 200; i++) size = d.add({ x: put.x + 0.4, y: put.y - 0.4 }, put, STEP);
    expect(size).toBe(0);
  });

  it('finds a hand that shoves the mouse at once', () => {
    const d = new Deviation();
    expect(d.add({ x: put.x + 40, y: put.y }, put, STEP)).toBeGreaterThan(BREAK_PX);
  });

  it('finds a hand that moves it slowly, which a difference of a few pixels at a time would miss', () => {
    const d = new Deviation();
    let size = 0;
    // 2 px a step is 125 px/s: a slow hand
    for (let i = 0; i < 20 && size <= BREAK_PX; i++) size = d.add({ x: put.x + 2, y: put.y }, put, STEP);
    expect(size).toBeGreaterThan(BREAK_PX);
  });

  it('forgets: a hand that is gone no longer counts', () => {
    const d = new Deviation();
    d.add({ x: put.x + 40, y: put.y }, put, STEP);
    let size = 99;
    for (let i = 0; i < 60; i++) size = d.add(put, put, STEP);
    expect(size).toBeLessThan(1);
  });

  it('can be started anew', () => {
    const d = new Deviation();
    d.add({ x: put.x + 40, y: put.y }, put, STEP);
    d.reset();
    expect(d.add(put, put, STEP)).toBe(0);
  });
});

const LINES = parseLines({ attention: ['나 여기 있어~'], tug: ['영차~'], caught: ['히히!'] });

function make(opts: Partial<PetOptions> = {}, config: NonNullable<PetOptions['config']> = {}): Pet {
  const pet = new Pet({ world: { width: W, height: H }, rng: mulberry32(7), mode: 'wander', ...opts, config: { sleepAfterMs: 1e9, ...config } });
  pet.setLines(LINES);
  pet.setAttention(true);
  pet.update(STEP);
  return pet;
}

/** The mouse as the shell has it: one cursor, which the pet may be told to move. */
class Mouse {
  constructor(
    public at: Vec2,
    public moves: Vec2[] = [],
  ) {}

  /** one step of the stage: the pet sees the cursor, lives a step, and the cursor is moved where it asks */
  tick(pet: Pet): void {
    pet.setCursor(this.at);
    pet.update(STEP);
    const goal = pet.takeCursorGoal();
    if (goal) {
      this.at = { ...goal };
      this.moves.push(goal);
    }
  }

  run(pet: Pet, ms: number, each?: () => void): void {
    for (let t = 0; t < ms; t += STEP) {
      this.tick(pet);
      each?.();
    }
  }
}

const said = (pet: Pet): string[] => pet.view.particles.filter((p) => p.kind === 'text').map((p) => p.text ?? '');
/** everything the pet says as the steps go by (what it says fades after a moment) */
function listener(pet: Pet): { heard: Set<string>; listen: () => void } {
  const heard = new Set<string>();
  return { heard, listen: () => said(pet).forEach((t) => heard.add(t)) };
}
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('a pet that looks for attention', () => {
  it('does nothing unless the user has chosen it', () => {
    const pet = make();
    pet.setAttention(false);
    pet.setCursor({ x: 900, y: 300 });
    expect(pet.seekAttention()).toBe(false);
    expect(pet.seekingAttention).toBe(false);
  });

  it('needs a mouse to go to, one that is not in use', () => {
    const pet = make();
    expect(pet.seekAttention()).toBe(false);
    pet.setCursor({ x: 900, y: 300 });
    pet.setCursorBusy(true);
    expect(pet.seekAttention()).toBe(false);
    pet.setCursorBusy(false);
    expect(pet.seekAttention()).toBe(true);
  });

  it('runs up to the mouse, calling out, and waits beside it while the mouse is in use', () => {
    const pet = make();
    const mouse = new Mouse({ x: 900, y: 300 });
    pet.setCursor(mouse.at);
    expect(pet.seekAttention()).toBe(true);
    expect(said(pet)).toContain('나 여기 있어~');
    const from = pet.view.x;
    // the mouse moves about a little all the time, so it is never still
    let t = 0;
    mouse.run(pet, 4000, () => {
      t += STEP;
      mouse.at = { x: 900 + Math.sin(t / 200) * 30, y: 300 + Math.cos(t / 200) * 30 };
    });
    expect(pet.view.x).toBeGreaterThan(from);
    expect(pet.seekingAttention).toBe(true);
    expect(pet.view.state).toBe('idle');
    // beside the mouse, facing it
    expect(dist({ x: pet.view.x, y: pet.view.y }, mouse.at)).toBeLessThan(200);
    // the mouse has not been taken
    expect(mouse.moves).toHaveLength(0);
  });

  it('gives up when the mouse is never still, and tries again only after a while', () => {
    const pet = make();
    const mouse = new Mouse({ x: 900, y: 300 });
    pet.setCursor(mouse.at);
    pet.seekAttention();
    let t = 0;
    mouse.run(pet, 6000 + BEG_MS + 2000, () => {
      t += STEP;
      mouse.at = { x: 900 + Math.sin(t / 200) * 30, y: 300 + Math.cos(t / 200) * 30 };
    });
    expect(pet.seekingAttention).toBe(false);
    expect(mouse.moves).toHaveLength(0);
    // it sat down, and a minute later it is not out again
    mouse.run(pet, 60_000, () => {
      t += STEP;
      mouse.at = { x: 900 + Math.sin(t / 200) * 30, y: 300 + Math.cos(t / 200) * 30 };
    });
    expect(pet.seekingAttention).toBe(false);
  });

  it('takes hold of the mouse when it is still, and pulls it away with it', () => {
    const pet = make();
    const mouse = new Mouse({ x: 900, y: 300 });
    pet.setCursor(mouse.at);
    pet.seekAttention();
    const start = { ...mouse.at };
    const { heard, listen } = listener(pet);
    // the mouse stays where it is (it is still): after the run it is taken
    mouse.run(pet, 8000, listen);
    expect(mouse.moves.length).toBeGreaterThan(0);
    expect(heard.has('영차~')).toBe(true);
    // by the end the mouse has been taken a long way
    mouse.run(pet, 12_000, listen);
    expect(dist(mouse.at, start)).toBeGreaterThan(PULL_MIN * 0.8);
    expect(pet.seekingAttention).toBe(false);
    expect(heard.has('히히!')).toBe(true);
    // and the cursor stays inside the screens
    for (const p of mouse.moves) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(W);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(H);
    }
  });

  it('holds the cursor at its back, outside its body, so that clicks still go to what is under it', () => {
    const pet = make();
    const mouse = new Mouse({ x: 900, y: 300 });
    pet.setCursor(mouse.at);
    pet.seekAttention();
    mouse.run(pet, 8000);
    let outside = 0;
    let checked = 0;
    mouse.run(pet, 6000, () => {
      if (!pet.seekingAttention || dist(mouse.at, { x: pet.view.hitbox.x + pet.view.hitbox.w / 2, y: pet.view.hitbox.y + pet.view.hitbox.h / 2 }) > 400) return;
      const r = pet.view.hitbox;
      // only the steps in which the cursor has been brought up to the pet
      if (Math.abs(mouse.at.x - (r.x + r.w / 2)) < r.w) {
        checked++;
        if (mouse.at.x < r.x || mouse.at.x > r.x + r.w) outside++;
      }
    });
    expect(checked).toBeGreaterThan(10);
    expect(outside / checked).toBeGreaterThan(0.9);
  });

  it('lets go at once when somebody moves the mouse, and is startled', () => {
    const pet = make();
    const mouse = new Mouse({ x: 900, y: 300 });
    pet.setCursor(mouse.at);
    pet.seekAttention();
    // until it has taken hold
    for (let i = 0; i < 700 && mouse.moves.length === 0; i++) mouse.tick(pet);
    expect(mouse.moves.length).toBeGreaterThan(0);
    // somebody shoves the mouse 40 px
    mouse.at = { x: mouse.at.x + 40, y: mouse.at.y };
    mouse.tick(pet);
    expect(pet.seekingAttention).toBe(false);
    expect(pet.view.state).toBe('surprised');
    expect(said(pet)).toContain('히히!');
    const moves = mouse.moves.length;
    mouse.run(pet, 3000);
    expect(mouse.moves.length).toBe(moves);
  });

  it('lets go when somebody moves it slowly, too', () => {
    const pet = make();
    const mouse = new Mouse({ x: 900, y: 300 });
    pet.setCursor(mouse.at);
    pet.seekAttention();
    for (let i = 0; i < 700 && mouse.moves.length === 0; i++) mouse.tick(pet);
    let steps = 0;
    while (pet.seekingAttention && steps++ < 60) {
      mouse.at = { x: mouse.at.x + 2, y: mouse.at.y };
      mouse.tick(pet);
    }
    expect(pet.seekingAttention).toBe(false);
    expect(steps).toBeLessThan(40);
  });

  it('lets go the moment a button is down, or the program in front takes the whole screen', () => {
    const pet = make();
    const mouse = new Mouse({ x: 900, y: 300 });
    pet.setCursor(mouse.at);
    pet.seekAttention();
    for (let i = 0; i < 700 && mouse.moves.length === 0; i++) mouse.tick(pet);
    pet.setCursorBusy(true);
    mouse.tick(pet);
    expect(pet.seekingAttention).toBe(false);
    const moves = mouse.moves.length;
    mouse.tick(pet);
    expect(mouse.moves.length).toBe(moves);
  });

  it('lets go when it is turned off, and does not go on', () => {
    const pet = make();
    const mouse = new Mouse({ x: 900, y: 300 });
    pet.setCursor(mouse.at);
    pet.seekAttention();
    for (let i = 0; i < 700 && mouse.moves.length === 0; i++) mouse.tick(pet);
    pet.setAttention(false);
    expect(pet.seekingAttention).toBe(false);
    expect(pet.takeCursorGoal()).toBeNull();
  });

  it('stops when somebody comes to it: the pet is touched while it waits, and goes about its business', () => {
    const pet = make();
    const mouse = new Mouse({ x: 900, y: 300 });
    pet.setCursor(mouse.at);
    pet.seekAttention();
    mouse.run(pet, 1500);
    expect(pet.seekingAttention).toBe(true);
    // the mouse comes up to the pet (while it is still moving): that is what it wanted
    const r = pet.view.hitbox;
    mouse.at = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    pet.setCursor(mouse.at);
    pet.pointerMove(mouse.at);
    mouse.tick(pet);
    mouse.tick(pet);
    expect(pet.seekingAttention).toBe(false);
    expect(mouse.moves).toHaveLength(0);
  });

  it('stops when it is picked up, and when it is called', () => {
    for (const how of ['pickup', 'call'] as const) {
      const pet = make();
      const mouse = new Mouse({ x: 900, y: 300 });
      pet.setCursor(mouse.at);
      pet.seekAttention();
      mouse.run(pet, 1000);
      if (how === 'call') pet.call();
      else {
        const r = pet.view.hitbox;
        const at = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
        pet.pointerMove(at);
        pet.pointerDown(at);
        pet.pointerMove({ x: at.x + 30, y: at.y - 30 });
      }
      mouse.run(pet, 100);
      expect(pet.seekingAttention, how).toBe(false);
    }
  });

  it('goes under the mouse on a floor, and the cursor is brought down to it', () => {
    const pet = make({}, { roam: 'floor' });
    const mouse = new Mouse({ x: 900, y: 200 });
    pet.setCursor(mouse.at);
    expect(pet.seekAttention()).toBe(true);
    mouse.run(pet, 12_000);
    // the cursor was drawn down from far above the floor
    expect(mouse.moves.length).toBeGreaterThan(0);
    expect(Math.max(...mouse.moves.map((p) => p.y))).toBeGreaterThan(400);
    expect(pet.view.y).toBeCloseTo(H, 0);
  });

  it('does not set out on its own before it has been left alone for long, however often it decides', () => {
    const pet = make();
    const mouse = new Mouse({ x: 900, y: 300 });
    let t = 0;
    let out = false;
    mouse.run(pet, ATTENTION_AFTER_MS - 5000, () => {
      t += STEP;
      // the mouse keeps moving about (the user is at work), far from the pet
      mouse.at = { x: 100 + ((t / 7) % 1000), y: 500 + Math.sin(t / 900) * 100 };
      if (pet.seekingAttention) out = true;
    });
    expect(out).toBe(false);
  });

  it('sets out by itself once it has been left alone for long, and then not again for a good while', () => {
    const pet = make();
    const mouse = new Mouse({ x: 900, y: 300 });
    let t = 0;
    let first = -1;
    let outings = 0;
    let was = false;
    const wander = (): void => {
      t += STEP;
      // the mouse keeps moving about (the user is at work), so it is never still and nothing is taken
      mouse.at = { x: 100 + ((t / 7) % 1000), y: 500 + Math.sin(t / 900) * 100 };
      if (pet.seekingAttention && !was) {
        outings++;
        if (first < 0) first = t;
      }
      was = pet.seekingAttention;
    };
    mouse.run(pet, ATTENTION_AFTER_MS + 12 * 60_000, wander);
    expect(first).toBeGreaterThanOrEqual(ATTENTION_AFTER_MS);
    expect(first).toBeLessThan(ATTENTION_AFTER_MS + 4 * 60_000);
    // an outing is over after a quarter of a minute at most, and the next may not start for twenty minutes (or four, when nobody came)
    expect(outings).toBeGreaterThanOrEqual(1);
    expect(outings).toBeLessThanOrEqual(4);
    expect(ATTENTION_COOLDOWN_MS[0]).toBeGreaterThan(10 * 60_000);
  });

  it('is left alone for ten more minutes after somebody has touched it', () => {
    const pet = make();
    const mouse = new Mouse({ x: 900, y: 300 });
    let t = 0;
    let out = false;
    const wander = (): void => {
      t += STEP;
      mouse.at = { x: 100 + ((t / 7) % 1000), y: 500 + Math.sin(t / 900) * 100 };
      if (pet.seekingAttention) out = true;
    };
    mouse.run(pet, ATTENTION_AFTER_MS - 30_000, wander);
    // the mouse comes over the pet: it is touched
    const r = pet.view.hitbox;
    const on = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    mouse.at = on;
    pet.setCursor(on);
    pet.pointerMove({ x: on.x - 20, y: on.y });
    pet.pointerMove(on);
    mouse.tick(pet);
    expect(out).toBe(false);
    mouse.run(pet, ATTENTION_AFTER_MS - 60_000, wander);
    expect(out).toBe(false);
  });

  it('never goes out to get attention when it is hiding, asleep or stuck to the mouse', () => {
    const pet = make({ mode: 'attach' });
    pet.setCursor({ x: 900, y: 300 });
    expect(pet.seekAttention()).toBe(false);
  });

  it('leaves the random numbers alone while the choice is off', () => {
    const a = new Pet({ world: { width: W, height: H }, rng: mulberry32(11), mode: 'wander', config: { sleepAfterMs: 1e9 } });
    const b = new Pet({ world: { width: W, height: H }, rng: mulberry32(11), mode: 'wander', config: { sleepAfterMs: 1e9 } });
    b.setAttention(false);
    for (let t = 0; t < 120_000; t += STEP) {
      a.setCursor({ x: 300 + (t % 400), y: 300 });
      b.setCursor({ x: 300 + (t % 400), y: 300 });
      a.update(STEP);
      b.update(STEP);
    }
    expect(a.view.x).toBe(b.view.x);
    expect(a.view.state).toBe(b.view.state);
    expect(STILL_MS).toBeGreaterThan(0);
  });
});
