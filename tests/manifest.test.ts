import { describe, expect, it } from 'vitest';
import { parseManifest, poseFiles } from '../src/shared/manifest';

describe('parseManifest', () => {
  it('needs poses.idle', () => {
    expect(() => parseManifest(null, 's')).toThrow();
    expect(() => parseManifest({}, 's')).toThrow(/poses/);
    expect(() => parseManifest({ poses: { happy: 'h.png' } }, 's')).toThrow(/idle/);
    expect(() => parseManifest({ poses: { idle: '' } }, 's')).toThrow(/idle/);
  });

  it('fills defaults and clamps numbers', () => {
    const m = parseManifest({ poses: { idle: 'i.png' }, size: { w: 5000, h: -3 }, anchor: { x: 2, y: 0.5 } }, 's');
    expect(m.size).toEqual({ w: 1024, h: 16 });
    expect(m.anchor).toEqual({ x: 1, y: 0.5 });
    expect(m.hitbox!.w).toBeGreaterThan(0);
    expect(m.facing).toBe('right');
    expect(parseManifest({ poses: { idle: 'i.png' }, facing: 'left' }, 's').facing).toBe('left');
  });

  it('accepts sprite sheet poses and normalises them', () => {
    const m = parseManifest(
      {
        poses: {
          idle: 'idle.png',
          happy: { sheet: 'happy.png', frameWidth: 200.4, frameHeight: 180, count: 3, durations: [50, 5, 99999, 7] },
          sleep: { sheet: 'sleep.png', frameWidth: 64, frameHeight: 64, count: 2, durations: 80 },
        },
      },
      's',
    );
    expect(m.poses.happy).toEqual({ sheet: 'happy.png', frameWidth: 200, frameHeight: 180, count: 3, durations: [50, 10, 10000] });
    expect(m.poses.sleep).toEqual({ sheet: 'sleep.png', frameWidth: 64, frameHeight: 64, count: 2, durations: 80 });
  });

  it('drops malformed poses instead of failing', () => {
    const m = parseManifest(
      {
        poses: {
          idle: 'i.png',
          a: 42,
          b: { sheet: 'b.png' },
          c: { sheet: 'c.png', frameWidth: 0, frameHeight: 10, count: 1 },
          d: { frameWidth: 10, frameHeight: 10, count: 1 },
        },
      },
      's',
    );
    expect(Object.keys(m.poses)).toEqual(['idle']);
  });

  it('keeps only known states in states and motion', () => {
    const m = parseManifest(
      { poses: { idle: 'i.png' }, states: { sit: 'idle', jump: 'idle', walk: 3 }, motion: { happy: 'off', walk: 'auto', run: 'nope', fly: 'off' } },
      's',
    );
    expect(m.states).toEqual({ sit: 'idle' });
    expect(m.motion).toEqual({ happy: 'off', walk: 'auto' });
  });
});

describe('poseFiles', () => {
  it('lists each referenced file once', () => {
    const m = parseManifest(
      { poses: { idle: 'a.png', walk: 'a.png', happy: { sheet: 'h.png', frameWidth: 8, frameHeight: 8, count: 2 } } },
      's',
    );
    expect(poseFiles(m).sort()).toEqual(['a.png', 'h.png']);
  });
});
