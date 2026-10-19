import { describe, expect, it } from 'vitest';
import { MAX_ACTIONS, parseActions } from '../src/engine/actions';
import { parseManifest } from '../src/shared/manifest';
import { parseSkinReport } from '../src/shared/validate';

const poses = new Map<string, boolean>([
  ['camera', false],
  ['bounce', true],
  ['idle', false],
]);

describe('parseActions', () => {
  it('reads what an action is and does', () => {
    const a = parseActions(
      { camera: { pose: 'camera', ms: 3600, weight: 2, motion: 'still', on: ['welcome', 'call'], say: ['찰칵!', { text: '자, 치즈~', style: 'hold' }] } },
      poses,
    );
    expect(a.camera).toEqual({
      pose: 'camera',
      ms: 3600,
      weight: 2,
      motion: 'still',
      on: ['welcome', 'call'],
      lines: [
        { text: '찰칵!', style: 'float' },
        { text: '자, 치즈~', style: 'hold' },
      ],
    });
  });

  it('fills in what is left out: the pose is the name, and a picture that moves by itself is left alone', () => {
    const a = parseActions({ camera: {}, bounce: {} }, poses);
    expect(a.camera).toEqual({ pose: 'camera', ms: 2600, weight: 1, motion: 'bounce', on: [], lines: [] });
    expect(a.bounce!.motion).toBe('off');
    expect(parseActions({ bounce: { motion: 'sway' } }, poses).bounce!.motion).toBe('sway');
  });

  it('may name another pose than its own name', () => {
    expect(parseActions({ snap: { pose: 'camera' } }, poses).snap!.pose).toBe('camera');
  });

  it('drops an action whose pose the skin does not have, when it knows the poses', () => {
    expect(Object.keys(parseActions({ camera: {}, dance: {}, x: { pose: 'nowhere' } }, poses))).toEqual(['camera']);
    expect(Object.keys(parseActions({ camera: {}, dance: {} }))).toEqual(['camera', 'dance']);
  });

  it('keeps the numbers in range', () => {
    const a = parseActions({ a: { ms: 5, weight: 0 }, b: { ms: 999_999, weight: 99 }, c: { ms: 'long', weight: NaN } });
    expect([a.a!.ms, a.a!.weight]).toEqual([800, 0.1]);
    expect([a.b!.ms, a.b!.weight]).toEqual([20_000, 10]);
    expect([a.c!.ms, a.c!.weight]).toEqual([2600, 1]);
  });

  it('keeps only the situations an action can be made for, once each', () => {
    const a = parseActions({ a: { on: ['plug', 'plug', 'click', 'lowBattery', 7, 'call'] } });
    expect(a.a!.on).toEqual(['plug', 'lowBattery', 'call']);
    expect(parseActions({ a: { on: 'plug' } }).a!.on).toEqual([]);
  });

  it('refuses names that are not plain words and entries that are not objects', () => {
    const a = parseActions({ ok: {}, 'has space': {}, '9lives': {}, ['x'.repeat(30)]: {}, str: 'camera', nul: null, arr: [] });
    expect(Object.keys(a)).toEqual(['ok']);
  });

  it('takes at most as many actions as it is made to', () => {
    const many = Object.fromEntries(Array.from({ length: MAX_ACTIONS + 5 }, (_, i) => [`a${i}`, {}]));
    expect(Object.keys(parseActions(many))).toHaveLength(MAX_ACTIONS);
  });

  it('is empty for anything that is not an object', () => {
    for (const bad of [undefined, null, 'camera', 5, [], [{ pose: 'camera' }]]) expect(parseActions(bad, poses)).toEqual({});
  });

  it('accepts what it produced (a skin report carries the parsed actions)', () => {
    const once = parseActions({ camera: { ms: 3000, on: ['call'], say: ['찰칵!'] } }, poses);
    expect(parseActions(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});

describe('actions in a manifest', () => {
  const base = {
    poses: {
      idle: 'idle.png',
      camera: 'camera.png',
      cheer: { sheet: 'cheer.png', frameWidth: 10, frameHeight: 10, count: 4 },
      wave: 'wave.gif',
      still1: { sheet: 'still.png', frameWidth: 10, frameHeight: 10, count: 1 },
    },
  };

  it('reads them next to the poses', () => {
    const m = parseManifest({ ...base, actions: { camera: { ms: 3000, say: ['찰칵!'] } } }, 'x');
    expect(m.actions!.camera!.ms).toBe(3000);
    expect(m.actions!.camera!.lines[0]!.text).toBe('찰칵!');
  });

  it('knows an animated pose from a still one for the default motion', () => {
    const a = parseManifest({ ...base, actions: { camera: {}, cheer: {}, wave: {}, still1: {} } }, 'x').actions!;
    expect([a.camera!.motion, a.cheer!.motion, a.wave!.motion, a.still1!.motion]).toEqual(['bounce', 'off', 'off', 'bounce']);
  });

  it('is empty without actions, and drops one whose pose is missing', () => {
    expect(parseManifest(base, 'x').actions).toEqual({});
    expect(Object.keys(parseManifest({ ...base, actions: { camera: {}, lost: {} } }, 'x').actions!)).toEqual(['camera']);
  });
});

describe('actions in a skin report', () => {
  const report = { box: { w: 128, h: 140, anchorX: 0.5, anchorY: 0.94 }, hitbox: { x: 0.18, y: 0.22, w: 0.64, h: 0.72 } };

  it('come along with the skin', () => {
    const actions = parseActions({ camera: { ms: 3000 } });
    expect(parseSkinReport({ ...report, lines: {}, actions })!.actions).toEqual(actions);
  });

  it('are empty when they are missing or bad', () => {
    for (const actions of [undefined, 'camera', 5, null, []]) expect(parseSkinReport({ ...report, lines: {}, actions })!.actions).toEqual({});
  });
});
