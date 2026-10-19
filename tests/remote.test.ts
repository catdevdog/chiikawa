import { describe, expect, it } from 'vitest';
import type { PetView } from '../src/engine/types';
import type { ViewFrame } from '../src/shared/types';
import { MAX_AHEAD_MS, MAX_CLOCK_MS, RemoteView } from '../src/renderer/remote';

const view = (over: Partial<PetView> = {}): PetView => ({
  x: 100,
  y: 500,
  facing: 1,
  state: 'walk',
  t: 2,
  sx: 1,
  sy: 1,
  rot: 0,
  lift: 0,
  pivot: 'feet',
  scale: 1,
  particles: [],
  hitbox: { x: 60, y: 400, w: 80, h: 100 },
  interactive: true,
  animating: true,
  action: null,
  ...over,
});
const frame = (over: Partial<ViewFrame> = {}): ViewFrame => ({ id: 'usagi', view: view(), vx: 100, vy: -50, ...over });
/** the first (or only) pet of a window */
const only = (r: RemoteView, now: number) => r.at(now)[0]?.view;

describe('RemoteView', () => {
  it('shows nothing until a frame arrives, and nothing again when the pet leaves the window', () => {
    const r = new RemoteView();
    expect(r.at(0)).toEqual([]);
    r.push([frame()], 0);
    expect(r.at(0)).toHaveLength(1);
    r.push([], 10);
    expect(r.at(10)).toEqual([]);
  });

  it('shows the frame as it is at the moment it arrives', () => {
    const r = new RemoteView();
    r.push([frame()], 1000);
    const v = only(r, 1000)!;
    expect([v.x, v.y, v.t]).toEqual([100, 500, 2]);
  });

  it('moves the pet along its speed for the time since the frame arrived', () => {
    const r = new RemoteView();
    r.push([frame()], 1000);
    const v = only(r, 1016)!;
    expect(v.x).toBeCloseTo(100 + 100 * 0.016);
    expect(v.y).toBeCloseTo(500 - 50 * 0.016);
    expect(v.hitbox.x).toBeCloseTo(60 + 100 * 0.016);
    expect(v.hitbox.w).toBe(80);
    expect(v.t).toBeCloseTo(2.016);
  });

  it('does not carry the position past a frame or two when the next one is late, but lets the pose clock run on', () => {
    const r = new RemoteView();
    r.push([frame()], 0);
    const late = { ...only(r, 200)! };
    expect(late.x).toBeCloseTo(100 + 100 * (MAX_AHEAD_MS / 1000));
    expect(late.t).toBeCloseTo(2 + 0.2);
    const stalled = only(r, 5000)!;
    expect(stalled.x).toBeCloseTo(late.x);
    expect(stalled.t).toBeCloseTo(2 + MAX_CLOCK_MS / 1000);
  });

  it('never goes back in time if the clock reads earlier than the arrival', () => {
    const r = new RemoteView();
    r.push([frame()], 1000);
    const v = only(r, 990)!;
    expect(v.x).toBe(100);
    expect(v.t).toBe(2);
  });

  it('a new frame replaces the old one and restarts the clock', () => {
    const r = new RemoteView();
    r.push([frame()], 0);
    r.push([frame({ view: view({ x: 130, state: 'idle', t: 0.01 }), vx: 0, vy: 0 })], 16);
    const v = only(r, 32)!;
    expect(v.x).toBe(130);
    expect(v.state).toBe('idle');
    expect(v.t).toBeCloseTo(0.026);
  });

  it('keeps the particles and the other fields of the frame', () => {
    const r = new RemoteView();
    const particles = [{ kind: 'heart' as const, x: 1, y: 2, vx: 0, vy: 0, age: 10, life: 1000 }];
    r.push([frame({ view: view({ particles, state: 'happy', rot: 0.3, lift: 4 }) })], 0);
    const v = only(r, 5)!;
    expect(v.particles).toEqual(particles);
    expect([v.state, v.rot, v.lift, v.facing, v.scale]).toEqual(['happy', 0.3, 4, 1, 1]);
  });
});

describe('RemoteView with several pets', () => {
  const trio = (): ViewFrame[] => [
    frame({ id: 'chiikawa', view: view({ x: 100 }), vx: 50, vy: 0 }),
    frame({ id: 'hachiware', view: view({ x: 400 }), vx: -50, vy: 0 }),
    frame({ id: 'usagi', view: view({ x: 700 }), vx: 0, vy: 0 }),
  ];

  it('moves each of them along its own speed, in the order they were sent', () => {
    const r = new RemoteView();
    r.push(trio(), 0);
    const pets = r.at(20);
    expect(pets.map((p) => p.id)).toEqual(['chiikawa', 'hachiware', 'usagi']);
    expect(pets.map((p) => Math.round(p.view.x * 100) / 100)).toEqual([101, 399, 700]);
  });

  it('keeps a pet that is still here and drops one that has left', () => {
    const r = new RemoteView();
    r.push(trio(), 0);
    r.push([trio()[0]!, trio()[2]!], 16);
    expect(r.at(16).map((p) => p.id)).toEqual(['chiikawa', 'usagi']);
    r.push([], 32);
    expect(r.at(32)).toEqual([]);
  });

  it('keeps each pet apart from the others: one moving does not move the rest', () => {
    const r = new RemoteView();
    r.push(trio(), 0);
    const first = r.at(0).map((p) => p.view.x);
    r.push([{ ...trio()[0]!, view: view({ x: 120 }) }, trio()[1]!, trio()[2]!], 16);
    const next = r.at(16).map((p) => p.view.x);
    expect(next[0]).toBe(120);
    expect(next.slice(1)).toEqual(first.slice(1));
  });

  it('does not make anything new for a pet that stays, so drawing every frame does not allocate', () => {
    const r = new RemoteView();
    r.push(trio(), 0);
    const before = r.at(0).map((p) => p);
    r.push(trio(), 16);
    const after = r.at(16);
    expect(after.map((p) => p === before[after.indexOf(p)])).toEqual([true, true, true]);
  });
});
