import { describe, expect, it } from 'vitest';
import { parseRange } from '../src/shared/range';
import { sanitizeSettings } from '../src/shared/sanitize';
import {
  isSceneFile,
  onScene,
  parseSceneManifest,
  placeScene,
  SCENE_DEFAULTS,
  sceneFiles,
  SYNC_SEEK_MS,
  SYNC_TOLERANCE_MS,
  syncCorrection,
} from '../src/shared/scene';
import { parseSceneState } from '../src/shared/validate';

describe('parseSceneManifest', () => {
  it('needs a picture: a video, or pictures like the poses of a skin', () => {
    expect(() => parseSceneManifest(null, 's')).toThrow(/object/);
    expect(() => parseSceneManifest({}, 's')).toThrow(/video/);
    expect(() => parseSceneManifest({ audio: 'a.mp3' }, 's')).toThrow(/video/);
    expect(parseSceneManifest({ video: 'a.webm' }, 's').video).toBe('a.webm');
    expect(parseSceneManifest({ picture: 'a.apng' }, 's').picture).toBe('a.apng');
    const sheet = { sheet: 'a.png', frameWidth: 100, frameHeight: 80, count: 4, durations: 50 };
    expect(parseSceneManifest({ picture: sheet }, 's').picture).toEqual(sheet);
  });

  it('prefers the video when both are named', () => {
    const m = parseSceneManifest({ video: 'a.webm', picture: 'a.png' }, 's');
    expect(m.video).toBe('a.webm');
    expect(m.picture).toBeUndefined();
  });

  it('keeps every file inside the scene folder', () => {
    for (const bad of ['../a.webm', '/etc/passwd', 'a\\b.webm', 'c:evil.webm', 'a//b.webm', '', 'x/../../y.webm']) {
      expect(isSceneFile(bad), bad).toBe(false);
      expect(() => parseSceneManifest({ video: bad }, 's'), bad).toThrow(/video/);
    }
    expect(isSceneFile('clips/a.webm')).toBe(true);
    // a sound that is not a proper file name is dropped, and the scene is silent
    expect(parseSceneManifest({ video: 'a.webm', audio: '../a.mp3' }, 's').audio).toBeUndefined();
    expect(() => parseSceneManifest({ picture: { sheet: '../a.png', frameWidth: 10, frameHeight: 10, count: 2 } }, 's')).toThrow(/folder/);
  });

  it('fills in the defaults and pulls numbers into range', () => {
    const m = parseSceneManifest({ video: 'a.webm' }, 's');
    expect(m.size).toEqual(SCENE_DEFAULTS.size);
    expect(m.anchor).toEqual(SCENE_DEFAULTS.anchor);
    expect(m.hitbox).toEqual(SCENE_DEFAULTS.hitbox);
    expect(m.cast).toEqual([]);
    expect(m.offsetMs).toBe(0);
    expect(m.volume).toBe(1);
    expect(m.maxMs).toBe(SCENE_DEFAULTS.maxMs);
    const w = parseSceneManifest({ video: 'a.webm', size: { w: 99999, h: -1 }, anchor: { x: 3, y: -3 }, offsetMs: 1e9, volume: 7, maxMs: 5 }, 's');
    expect(w.size).toEqual({ w: 4096, h: 16 });
    expect(w.anchor).toEqual({ x: 1, y: 0 });
    expect(w.offsetMs).toBe(10_000);
    expect(w.volume).toBe(1);
    expect(w.maxMs).toBe(1000);
  });

  it('takes the cast as skin ids, each once, no more than a scene can have', () => {
    expect(parseSceneManifest({ video: 'a.webm', cast: ['hachiware', 'chiikawa', 'hachiware', '../x', 3, null] }, 's').cast).toEqual(['hachiware', 'chiikawa']);
    const many = Array.from({ length: 20 }, (_, i) => `skin${i}`);
    expect(parseSceneManifest({ video: 'a.webm', cast: many }, 's').cast).toHaveLength(8);
    expect(parseSceneManifest({ video: 'a.webm', cast: 'usagi' }, 's').cast).toEqual([]);
  });

  it('keeps the names for the menu', () => {
    const m = parseSceneManifest({ video: 'a.webm', name: 'Concert', names: { ko: '공연', fr: 'x' } }, 's');
    expect(m.name).toBe('Concert');
    expect(m.names).toEqual({ ko: '공연' });
  });

  it('lists the files it needs', () => {
    expect(sceneFiles(parseSceneManifest({ video: 'a.webm', audio: 'b.mp3' }, 's')).sort()).toEqual(['a.webm', 'b.mp3']);
    expect(sceneFiles(parseSceneManifest({ picture: { sheet: 's.png', frameWidth: 8, frameHeight: 8, count: 2 } }, 's'))).toEqual(['s.png']);
  });
});

describe('placeScene', () => {
  const area = { x: 1000, y: 0, width: 1000, height: 600 };
  const size = { w: 400, h: 200 };
  const anchor = { x: 0.5, y: 0.9 };

  it('puts the feet of the picture on the feet of the pet', () => {
    const r = placeScene({ x: 1500, y: 400 }, size, anchor, 1, area);
    expect(r).toEqual({ x: 1300, y: 220, width: 400, height: 200 });
    expect(r.x + anchor.x * r.width).toBe(1500);
    expect(r.y + anchor.y * r.height).toBe(400);
  });

  it('makes it as big as the pets are', () => {
    const r = placeScene({ x: 1500, y: 400 }, size, anchor, 1.5, area);
    expect(r.width).toBe(600);
    expect(r.height).toBe(300);
  });

  it('keeps it inside the window, even for a pet at the floor or at the edge', () => {
    const floor = placeScene({ x: 1500, y: 600 }, size, anchor, 1, area);
    expect(floor.y + floor.height).toBe(600);
    const left = placeScene({ x: 1010, y: 400 }, size, anchor, 1, area);
    expect(left.x).toBe(1000);
    const right = placeScene({ x: 1990, y: 400 }, size, anchor, 1, area);
    expect(right.x + right.width).toBe(2000);
  });

  it('makes one that is too big for the window smaller, in proportion', () => {
    const r = placeScene({ x: 1500, y: 600 }, { w: 2000, h: 1000 }, anchor, 1, area);
    expect(r.width / r.height).toBeCloseTo(2);
    expect(r.height).toBeLessThanOrEqual(600);
    expect(r.width).toBeLessThanOrEqual(1000);
    expect(r.x).toBeGreaterThanOrEqual(1000);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });
});

describe('onScene', () => {
  const rect = { x: 100, y: 100, width: 400, height: 200 };
  const hitbox = { x: 0.25, y: 0.5, w: 0.5, h: 0.5 };
  it('is the part of the picture that the hitbox says', () => {
    expect(onScene(rect, hitbox, { x: 300, y: 250 })).toBe(true);
    expect(onScene(rect, hitbox, { x: 110, y: 250 })).toBe(false);
    expect(onScene(rect, hitbox, { x: 300, y: 150 })).toBe(false);
    expect(onScene(rect, hitbox, { x: 399, y: 299 })).toBe(true);
    expect(onScene(rect, hitbox, { x: 400, y: 250 })).toBe(false);
    expect(onScene(rect, hitbox, { x: 300, y: 300 })).toBe(false);
  });
});

describe('syncCorrection', () => {
  it('leaves a drift nobody can tell alone', () => {
    expect(syncCorrection(0)).toEqual({ seek: false, rate: 1 });
    expect(syncCorrection(SYNC_TOLERANCE_MS)).toEqual({ seek: false, rate: 1 });
    expect(syncCorrection(-SYNC_TOLERANCE_MS)).toEqual({ seek: false, rate: 1 });
  });

  it('slows a picture that is ahead of the sound and speeds up one that is behind it', () => {
    expect(syncCorrection(80)).toEqual({ seek: false, rate: 0.96 });
    expect(syncCorrection(-80)).toEqual({ seek: false, rate: 1.04 });
  });

  it('jumps when the picture is far off, in either direction', () => {
    expect(syncCorrection(SYNC_SEEK_MS)).toEqual({ seek: true, rate: 1 });
    expect(syncCorrection(-5000)).toEqual({ seek: true, rate: 1 });
  });

  it('does not act on a number that is not one', () => {
    expect(syncCorrection(Number.NaN)).toEqual({ seek: false, rate: 1 });
  });
});

describe('parseRange', () => {
  it('has no opinion about a request that is not one for a range', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('', 100)).toBeNull();
    expect(parseRange('bytes=-', 100)).toBeNull();
    expect(parseRange('items=0-5', 100)).toBeNull();
    expect(parseRange('bytes=0-5,10-20', 100)).toBeNull();
  });

  it('reads a start and an end, and a start alone', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
  });

  it('reads the last bytes', () => {
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-1000', 100)).toEqual({ start: 0, end: 99 });
  });

  it('says so when it asks for what is not there', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=50-40', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-5', 0)).toBe('unsatisfiable');
  });
});

describe('parseSceneState', () => {
  it('takes what an overlay says about a scene', () => {
    expect(parseSceneState({ run: 3, state: 'playing' })).toEqual({ run: 3, state: 'playing' });
    expect(parseSceneState({ run: 3, state: 'failed', message: 'no sound' })).toEqual({ run: 3, state: 'failed', message: 'no sound' });
    expect(parseSceneState({ run: 1, state: 'ended', message: 'x'.repeat(900) })!.message).toHaveLength(500);
  });

  it('refuses the rest', () => {
    for (const bad of [null, 'x', {}, { run: 'a', state: 'playing' }, { run: 1.5, state: 'playing' }, { run: 1, state: 'paused' }, { state: 'ended' }]) {
      expect(parseSceneState(bad)).toBeNull();
    }
  });
});

describe('the volume setting', () => {
  it('is kept between 0 and 1, and falls back to the default', () => {
    expect(sanitizeSettings({ volume: 0.25 }).volume).toBe(0.25);
    expect(sanitizeSettings({ volume: 7 }).volume).toBe(1);
    expect(sanitizeSettings({ volume: -2 }).volume).toBe(0);
    expect(sanitizeSettings({ volume: 'loud' }).volume).toBe(0.6);
    expect(sanitizeSettings({}).volume).toBe(0.6);
  });
});
