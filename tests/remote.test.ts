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
  ...over,
});
const frame = (over: Partial<ViewFrame> = {}): ViewFrame => ({ view: view(), vx: 100, vy: -50, ...over });

describe('RemoteView', () => {
  it('shows nothing until a frame arrives, and nothing again when the pet leaves the window', () => {
    const r = new RemoteView();
    expect(r.at(0)).toBeNull();
    r.push(frame(), 0);
    expect(r.at(0)).not.toBeNull();
    r.push(null, 10);
    expect(r.at(10)).toBeNull();
  });

  it('shows the frame as it is at the moment it arrives', () => {
    const r = new RemoteView();
    r.push(frame(), 1000);
    const v = r.at(1000)!;
    expect([v.x, v.y, v.t]).toEqual([100, 500, 2]);
  });

  it('moves the pet along its speed for the time since the frame arrived', () => {
    const r = new RemoteView();
    r.push(frame(), 1000);
    const v = r.at(1016)!;
    expect(v.x).toBeCloseTo(100 + 100 * 0.016);
    expect(v.y).toBeCloseTo(500 - 50 * 0.016);
    expect(v.hitbox.x).toBeCloseTo(60 + 100 * 0.016);
    expect(v.hitbox.w).toBe(80);
    expect(v.t).toBeCloseTo(2.016);
  });

  it('does not carry the position past a frame or two when the next one is late, but lets the pose clock run on', () => {
    const r = new RemoteView();
    r.push(frame(), 0);
    const late = r.at(200)!;
    expect(late.x).toBeCloseTo(100 + 100 * (MAX_AHEAD_MS / 1000));
    expect(late.t).toBeCloseTo(2 + 0.2);
    const stalled = r.at(5000)!;
    expect(stalled.x).toBeCloseTo(late.x);
    expect(stalled.t).toBeCloseTo(2 + MAX_CLOCK_MS / 1000);
  });

  it('never goes back in time if the clock reads earlier than the arrival', () => {
    const r = new RemoteView();
    r.push(frame(), 1000);
    const v = r.at(990)!;
    expect(v.x).toBe(100);
    expect(v.t).toBe(2);
  });

  it('a new frame replaces the old one and restarts the clock', () => {
    const r = new RemoteView();
    r.push(frame(), 0);
    r.push(frame({ view: view({ x: 130, state: 'idle', t: 0.01 }), vx: 0, vy: 0 }), 16);
    const v = r.at(32)!;
    expect(v.x).toBe(130);
    expect(v.state).toBe('idle');
    expect(v.t).toBeCloseTo(0.026);
  });

  it('keeps the particles and the other fields of the frame', () => {
    const r = new RemoteView();
    const particles = [{ kind: 'heart' as const, x: 1, y: 2, vx: 0, vy: 0, age: 10, life: 1000 }];
    r.push(frame({ view: view({ particles, state: 'happy', rot: 0.3, lift: 4 }) }), 0);
    const v = r.at(5)!;
    expect(v.particles).toEqual(particles);
    expect([v.state, v.rot, v.lift, v.facing, v.scale]).toEqual(['happy', 0.3, 4, 1, 1]);
  });
});
