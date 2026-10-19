import { describe, expect, it } from 'vitest';
import { assembleSkin, buildSkin, matchSizes, POSE_NAMES, TRICK_POSES, trickActions, type ItemInput } from '../src/maker/build';
import {
  alphaBounds,
  buildSheet,
  composeBottomCenter,
  createRaster,
  crop,
  decimateFrames,
  dominantBorderColor,
  flipHorizontal,
  hasTransparentBorder,
  removeBackground,
  resizeArea,
  DEFAULT_BG,
  type Raster,
  type RGB,
} from '../src/maker/process';
import { parseManifest } from '../src/shared/manifest';
import { MAX_SKIN_FILES, validateSkinPayload } from '../src/shared/skin-payload';

type RGBA = [number, number, number, number];

const px = (r: Raster, x: number, y: number): RGBA => {
  const i = (y * r.width + x) * 4;
  return [r.data[i]!, r.data[i + 1]!, r.data[i + 2]!, r.data[i + 3]!];
};

function paint(r: Raster, x: number, y: number, c: RGBA): void {
  r.data.set(c, (y * r.width + x) * 4);
}

function block(w: number, h: number, bx: number, by: number, bw: number, bh: number, c: RGBA = [200, 80, 80, 255]): Raster {
  const r = createRaster(w, h);
  for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) paint(r, x, y, c);
  return r;
}

/** A round character with an outline on a flat background: the classic sticker. */
function character(size: number, bg: RGB, body: RGB, line: RGB, radius = 14, thick = 2): Raster {
  const r = createRaster(size, size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const rgb = d <= radius - thick ? body : d <= radius ? line : bg;
      paint(r, x, y, [rgb[0], rgb[1], rgb[2], 255]);
    }
  }
  return r;
}

const opaque = (r: Raster): number => {
  let n = 0;
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i]! > 0) n++;
  return n;
};

const WHITE: RGB = [255, 255, 255];
const LINE: RGB = [60, 60, 60];

describe('background detection', () => {
  it('finds the flat background colour on the border', () => {
    expect(dominantBorderColor(character(41, WHITE, WHITE, LINE))).toEqual([255, 255, 255]);
    expect(dominantBorderColor(character(41, [200, 230, 255], WHITE, LINE))).toEqual([200, 230, 255]);
  });

  it('knows when there is nothing to remove', () => {
    const clear = block(30, 30, 10, 10, 10, 10);
    expect(hasTransparentBorder(clear)).toBe(true);
    expect(dominantBorderColor(clear)).toBeNull();
    expect(hasTransparentBorder(character(41, WHITE, WHITE, LINE))).toBe(false);
  });
});

describe('removeBackground', () => {
  const key = WHITE;

  it('removes only the background connected to the border and keeps a white body', () => {
    const out = removeBackground(character(41, WHITE, WHITE, LINE), { ...DEFAULT_BG, key });
    expect(px(out, 0, 0)[3]).toBe(0);
    expect(px(out, 40, 40)[3]).toBe(0);
    expect(px(out, 20, 20)).toEqual([255, 255, 255, 255]); // white belly survives
    expect(px(out, 20, 20 - 13)[3]).toBe(255); // the outline survives
  });

  it('removes every matching pixel when it is not contiguous', () => {
    const out = removeBackground(character(41, WHITE, WHITE, LINE), { ...DEFAULT_BG, key, contiguous: false });
    expect(px(out, 20, 20)[3]).toBe(0);
    expect(px(out, 20, 20 - 13)[3]).toBe(255);
  });

  it('tolerance decides how noisy a background may be', () => {
    const noisy = character(41, [252, 252, 252], [255, 200, 200], LINE);
    for (let y = 0; y < 41; y++) {
      for (let x = 0; x < 41; x++) {
        if (px(noisy, x, y)[0] === 252) {
          const n = ((x * 7 + y * 13) % 7) - 3;
          paint(noisy, x, y, [252 + n, 252 + n, 252 + n, 255]);
        }
      }
    }
    const strict = removeBackground(noisy, { ...DEFAULT_BG, key: [252, 252, 252], tolerance: 0 });
    const loose = removeBackground(noisy, { ...DEFAULT_BG, key: [252, 252, 252], tolerance: 14 });
    expect(opaque(strict)).toBeGreaterThan(opaque(loose) + 200);
    expect(px(loose, 0, 0)[3]).toBe(0);
    expect(px(loose, 20, 20)[3]).toBe(255);
  });

  it('un-mixes anti-aliased edges instead of leaving a light fringe', () => {
    const strip = createRaster(24, 6);
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 24; x++) paint(strip, x, y, x < 10 ? [255, 255, 255, 255] : x === 10 ? [158, 158, 158, 255] : [60, 60, 60, 255]);
    }
    const out = removeBackground(strip, { ...DEFAULT_BG, key: WHITE });
    expect(px(out, 5, 3)[3]).toBe(0);
    const edge = px(out, 10, 3);
    expect(edge[0]).toBeLessThan(70); // back to the outline colour, not light grey
    expect(edge[3]).toBeGreaterThan(115);
    expect(edge[3]).toBeLessThan(140); // about half covered
    expect(px(out, 12, 3)).toEqual([60, 60, 60, 255]);
  });

  it('erode shaves the edge and feather softens it', () => {
    const src = character(41, WHITE, WHITE, LINE);
    const plain = removeBackground(src, { ...DEFAULT_BG, key: WHITE });
    const eroded = removeBackground(src, { ...DEFAULT_BG, key: WHITE, erode: 1 });
    expect(opaque(eroded)).toBeLessThan(opaque(plain));
    const soft = removeBackground(src, { ...DEFAULT_BG, key: WHITE, feather: 1 });
    let partial = 0;
    for (let i = 3; i < soft.data.length; i += 4) if (soft.data[i]! > 0 && soft.data[i]! < 255) partial++;
    expect(partial).toBeGreaterThan(20);
    let hard = 0;
    for (let i = 3; i < plain.data.length; i += 4) if (plain.data[i]! > 0 && plain.data[i]! < 255) hard++;
    expect(hard).toBe(0);
  });

  it('does not change its input', () => {
    const src = character(21, WHITE, WHITE, LINE, 8);
    const copy = new Uint8ClampedArray(src.data);
    removeBackground(src, { ...DEFAULT_BG, key: WHITE });
    expect(Array.from(src.data)).toEqual(Array.from(copy));
  });
});

describe('geometry helpers', () => {
  it('finds, crops and re-places the visible part', () => {
    const r = block(10, 10, 3, 2, 4, 4);
    expect(alphaBounds(r)).toEqual({ x: 3, y: 2, w: 4, h: 4 });
    expect(alphaBounds(createRaster(5, 5))).toBeNull();
    const c = crop(r, { x: 3, y: 2, w: 4, h: 4 });
    expect([c.width, c.height]).toEqual([4, 4]);
    expect(px(c, 0, 0)[3]).toBe(255);
    const placed = composeBottomCenter(c, 12, 12, 2);
    expect(px(placed, 4, 6)[3]).toBe(255);
    expect(px(placed, 7, 9)[3]).toBe(255);
    expect(px(placed, 3, 6)[3]).toBe(0);
    expect(px(placed, 4, 5)[3]).toBe(0);
    expect(px(placed, 4, 10)[3]).toBe(0);
  });

  it('mirrors an image without touching the original', () => {
    const r = createRaster(4, 2);
    paint(r, 0, 0, [10, 20, 30, 255]);
    paint(r, 3, 1, [40, 50, 60, 128]);
    const m = flipHorizontal(r);
    expect(px(m, 3, 0)).toEqual([10, 20, 30, 255]);
    expect(px(m, 0, 1)).toEqual([40, 50, 60, 128]);
    expect(px(m, 0, 0)[3]).toBe(0);
    expect(px(r, 0, 0)).toEqual([10, 20, 30, 255]);
  });

  it('downscales without darkening or fringing semi-transparent pixels', () => {
    const half = createRaster(8, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) paint(half, x, y, [255, 0, 0, 128]);
    const a = resizeArea(half, 4, 4);
    expect(px(a, 1, 1)).toEqual([255, 0, 0, 128]);

    const checker = createRaster(8, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2 === 0) paint(checker, x, y, [255, 255, 255, 255]);
    const b = resizeArea(checker, 4, 4);
    expect(px(b, 1, 1)[0]).toBeGreaterThan(250); // still white, not grey
    expect(px(b, 1, 1)[3]).toBeGreaterThan(120);
    expect(px(b, 1, 1)[3]).toBeLessThan(136);
  });

  it('never enlarges', () => {
    const r = resizeArea(block(4, 4, 0, 0, 4, 4), 16, 16);
    expect([r.width, r.height]).toEqual([4, 4]);
  });

  it('decimates animations keeping the total time', () => {
    const frames = Array.from({ length: 10 }, () => block(2, 2, 0, 0, 2, 2));
    const d = decimateFrames(frames, Array(10).fill(100), 4);
    expect(d.frames).toHaveLength(4);
    expect(d.durations.reduce((s, v) => s + v, 0)).toBe(1000);
    const same = decimateFrames(frames, Array(10).fill(100), 20);
    expect(same.frames).toHaveLength(10);
  });

  it('lays frames out on a sheet row by row', () => {
    const f = (v: number) => block(2, 2, 0, 0, 2, 2, [v, 0, 0, 255]);
    const sheet = buildSheet([f(10), f(20), f(30)], 2);
    expect([sheet.width, sheet.height]).toEqual([4, 4]);
    expect(px(sheet, 0, 0)[0]).toBe(10);
    expect(px(sheet, 2, 0)[0]).toBe(20);
    expect(px(sheet, 0, 2)[0]).toBe(30);
    expect(px(sheet, 2, 2)[3]).toBe(0);
  });
});

const item = (over: Partial<ItemInput> & Pick<ItemInput, 'pose' | 'frames'>): ItemInput => ({
  durations: over.frames.map(() => 100),
  bg: null,
  scale: 1,
  motionOff: false,
  ...over,
});

describe('buildSkin', () => {
  const idle = block(100, 100, 20, 10, 60, 80); // 60x80 body
  const happy = [0, 1, 2].map((i) => block(120, 120, 10, 30 + i * 2, 100, 50)); // 100x50 body

  it('puts every pose on one canvas with the feet on the same line', () => {
    const built = buildSkin([item({ pose: 'idle', frames: [idle] }), item({ pose: 'happy', frames: happy })]);
    expect([built.width, built.height]).toEqual([100, 83]);
    for (const p of built.poses) {
      const bottoms = p.frames.map((f) => {
        expect([f.width, f.height]).toEqual([100, 83]);
        const b = alphaBounds(f)!;
        return b.y + b.h;
      });
      // the lowest point of a pose sits on the feet line (3 transparent rows below it) ...
      expect(Math.max(...bottoms)).toBe(80);
    }
    // ... while the motion between frames is kept (the test frames drop 2px per frame)
    const bottoms = built.poses.find((p) => p.pose === 'happy')!.frames.map((f) => {
      const b = alphaBounds(f)!;
      return b.y + b.h;
    });
    expect(bottoms).toEqual([76, 78, 80]);
    expect(alphaBounds(built.poses[0]!.frames[0]!)!.x).toBe(20); // idle is centred
    expect(built.anchor).toEqual({ x: 0.5, y: 80 / 83 });
    expect(built.hitbox.x).toBeCloseTo(0.2);
    expect(built.hitbox.w).toBeCloseTo(0.6);
  });

  it('keeps poses in engine order and the first of a duplicated pose', () => {
    const small = block(20, 20, 0, 0, 20, 20);
    const built = buildSkin([
      item({ pose: 'happy', frames: happy }),
      item({ pose: 'idle', frames: [idle] }),
      item({ pose: 'idle', frames: [small] }),
    ]);
    expect(built.poses.map((p) => p.pose)).toEqual(['idle', 'happy']);
    expect(alphaBounds(built.poses[0]!.frames[0]!)!.h).toBe(80);
  });

  it('scales the whole set to fit and honours a per-pose size', () => {
    const half = buildSkin([item({ pose: 'idle', frames: [idle] }), item({ pose: 'happy', frames: happy })], { maxSide: 50 });
    expect([half.width, half.height]).toEqual([50, 43]);
    const mixed = buildSkin([item({ pose: 'idle', frames: [idle] }), item({ pose: 'sleep', frames: [idle], scale: 0.5 })]);
    expect(alphaBounds(mixed.poses.find((p) => p.pose === 'sleep')!.frames[0]!)!.h).toBe(40);
    expect(alphaBounds(mixed.poses.find((p) => p.pose === 'idle')!.frames[0]!)!.h).toBe(80);
  });

  it('removes the background as part of the build', () => {
    const sticker = character(41, WHITE, WHITE, LINE);
    const built = buildSkin([item({ pose: 'idle', frames: [sticker], bg: { ...DEFAULT_BG, key: WHITE } })]);
    expect(built.width).toBeLessThanOrEqual(31); // trimmed to the round body
    expect(px(built.poses[0]!.frames[0]!, 0, 0)[3]).toBe(0);
    const mid = built.poses[0]!.frames[0]!;
    expect(px(mid, Math.floor(mid.width / 2), Math.floor(mid.height / 2))[3]).toBe(255);
  });

  it('mirrors a pose that faces the other way, frames staying aligned with each other', () => {
    // a body with a "nose" on its right edge
    const nosed = (shift: number): Raster => {
      const r = block(60, 60, 10, 20, 30, 30);
      for (let y = 30; y < 34; y++) for (let x = 40; x < 46 + shift; x++) paint(r, x, y, [20, 20, 20, 255]);
      return r;
    };
    const built = buildSkin([
      item({ pose: 'idle', frames: [nosed(0)] }),
      item({ pose: 'happy', frames: [nosed(0), nosed(4)], flip: true }),
    ]);
    const idleF = built.poses.find((p) => p.pose === 'idle')!.frames[0]!;
    const happyF = built.poses.find((p) => p.pose === 'happy')!.frames;
    const rightmost = (r: Raster): number => alphaBounds(r)!.x + alphaBounds(r)!.w;
    const leftmost = (r: Raster): number => alphaBounds(r)!.x;
    expect(rightmost(idleF)).toBeGreaterThan(idleF.width / 2 + 10); // the nose sticks out to the right
    expect(leftmost(happyF[0]!)).toBeLessThan(happyF[0]!.width / 2 - 10); // ... and to the left once mirrored
    // the longer nose of the second frame reaches further out on the same side
    expect(leftmost(happyF[1]!)).toBeLessThan(leftmost(happyF[0]!));
  });

  it('keeps the sizes of same-shaped canvases equal, whatever their resolution', () => {
    // a 258px GIF beside 720px stills of the same artwork
    expect(matchSizes([{ w: 258, h: 258 }, { w: 720, h: 720 }, { w: 719, h: 720 }])).toEqual([720 / 258, 1, 1]);
    expect(matchSizes([])).toEqual([]);
    expect(matchSizes([{ w: 100, h: 80 }])).toEqual([1]);
  });

  it('leaves canvases of another shape at their own size', () => {
    const scales = matchSizes([{ w: 720, h: 720 }, { w: 402, h: 350 }, { w: 360, h: 360 }]);
    expect(scales[0]).toBe(1);
    expect(scales[1]).toBe(1);
    expect(scales[2]).toBe(2);
  });

  it('refuses to build without an idle pose or without anything visible', () => {
    expect(() => buildSkin([item({ pose: 'happy', frames: happy })])).toThrow(/idle/);
    expect(() => buildSkin([item({ pose: 'idle', frames: [createRaster(10, 10)] })])).toThrow();
    expect(() => buildSkin([])).toThrow();
  });
});

describe('assembleSkin', () => {
  const idle = block(100, 100, 20, 10, 60, 80);
  const frames = [0, 1, 2, 3, 4].map((i) => block(100, 100, 20, 10 + i, 60, 80));

  it('writes a PNG per static pose and a sheet per animation, and the manifest parses', () => {
    const built = buildSkin([
      item({ pose: 'idle', frames: [idle] }),
      item({ pose: 'happy', frames, durations: [100, 100, 100, 100, 100], motionOff: true }),
      item({ pose: 'sleep', frames: [idle], motionOff: true }),
    ]);
    const { manifest, images } = assembleSkin(built, { name: 'Test', facing: 'left' });
    expect(images.map((i) => i.name).sort()).toEqual(['happy.png', 'idle.png', 'sleep.png']);
    expect(manifest.poses.idle).toBe('idle.png');
    expect(manifest.poses.happy).toEqual({ sheet: 'happy.png', frameWidth: built.width, frameHeight: built.height, count: 5, durations: 100 });
    // a still image has nothing to switch the engine's motion off for
    expect(manifest.motion).toEqual({ happy: 'off' });
    expect(manifest.facing).toBe('left');
    expect(manifest.size).toEqual({ w: Math.round((128 * built.width) / built.height), h: 128 });
    const sheet = images.find((i) => i.name === 'happy.png')!.raster;
    expect(sheet.width % built.width).toBe(0);
    expect((sheet.width / built.width) * Math.ceil(5 / (sheet.width / built.width)) * built.height).toBeGreaterThanOrEqual(5 * built.height);
    expect(() => parseManifest(JSON.parse(JSON.stringify(manifest)), 't')).not.toThrow();
  });

  it('keeps per-frame durations when they differ', () => {
    const built = buildSkin([item({ pose: 'idle', frames: [idle] }), item({ pose: 'happy', frames: frames.slice(0, 3), durations: [50, 100, 200] })]);
    const { manifest } = assembleSkin(built, { name: 'T', facing: 'right' });
    expect((manifest.poses.happy as { durations: number[] }).durations).toEqual([50, 100, 200]);
  });
});

describe('tricks', () => {
  const idle = block(100, 100, 20, 10, 60, 80);
  const wide = block(140, 100, 10, 10, 120, 80);
  const loop = (n: number) => Array.from({ length: n }, (_, i) => block(100, 100, 20, 10 + i, 60, 80));

  it('are poses of their own, after the poses of the states, on the same canvas', () => {
    const built = buildSkin([
      item({ pose: 'trick2', frames: [wide] }),
      item({ pose: 'idle', frames: [idle] }),
      item({ pose: 'trick1', frames: [idle] }),
      item({ pose: 'happy', frames: [idle] }),
    ]);
    expect(built.poses.map((p) => p.pose)).toEqual(['idle', 'happy', 'trick1', 'trick2']);
    for (const p of built.poses) for (const f of p.frames) expect([f.width, f.height]).toEqual([built.width, built.height]);
  });

  it('count once per name like any other pose, and a trick alone does not make a skin', () => {
    const built = buildSkin([item({ pose: 'idle', frames: [idle] }), item({ pose: 'trick1', frames: [idle] }), item({ pose: 'trick1', frames: [wide] })]);
    expect(built.poses.filter((p) => p.pose === 'trick1')).toHaveLength(1);
    expect(() => buildSkin([item({ pose: 'trick1', frames: [idle] })])).toThrow(/idle/);
  });

  it('are listed with the other pose names', () => {
    expect(POSE_NAMES).toContain('idle');
    for (const t of TRICK_POSES) expect(POSE_NAMES).toContain(t);
    expect(new Set(POSE_NAMES).size).toBe(POSE_NAMES.length);
  });

  it('become actions in the manifest: a still picture hops, a moving one is left to move', () => {
    const built = buildSkin([
      item({ pose: 'idle', frames: [idle] }),
      item({ pose: 'trick1', frames: [idle] }),
      item({ pose: 'trick2', frames: loop(4), durations: [100, 100, 100, 100], motionOff: true }),
      item({ pose: 'sleep', frames: loop(3), durations: [100, 100, 100], motionOff: true }),
    ]);
    const { manifest, images } = assembleSkin(built, { name: 'T', facing: 'left' });
    expect(manifest.actions).toEqual({
      trick1: { pose: 'trick1', ms: 2600, motion: 'bounce' },
      trick2: { pose: 'trick2', ms: 2600, motion: 'off' },
    });
    expect(images.map((i) => i.name).sort()).toEqual(['idle.png', 'sleep.png', 'trick1.png', 'trick2.png']);
    // only the poses of the states have a say in `motion`
    expect(manifest.motion).toEqual({ sleep: 'off' });
    const parsed = parseManifest(JSON.parse(JSON.stringify(manifest)), 't');
    expect(Object.keys(parsed.actions!)).toEqual(['trick1', 'trick2']);
    expect(parsed.actions!.trick2!.motion).toBe('off');
  });

  it('have no actions entry when there is no trick', () => {
    const built = buildSkin([item({ pose: 'idle', frames: [idle] })]);
    expect(assembleSkin(built, { name: 'T', facing: 'left' }).manifest.actions).toBeUndefined();
  });

  it('last a couple of rounds of the picture, but not for ever', () => {
    const built = (n: number, ms: number) =>
      buildSkin([item({ pose: 'idle', frames: [idle] }), item({ pose: 'trick1', frames: loop(n), durations: Array<number>(n).fill(ms), motionOff: true })]);
    expect(trickActions(built(4, 1000)).trick1!.ms).toBe(4000);
    expect(trickActions(built(8, 2000)).trick1!.ms).toBe(6000);
    expect(trickActions(built(2, 50)).trick1!.ms).toBe(2600);
  });

  it('are accepted when the skin is saved', () => {
    const built = buildSkin([item({ pose: 'idle', frames: [idle] }), item({ pose: 'trick1', frames: [wide] })]);
    const { manifest, images } = assembleSkin(built, { name: 'T', facing: 'left' });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
    const result = validateSkinPayload({
      id: 'with-tricks',
      files: [{ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) }, ...images.map((i) => ({ name: i.name, data: bytes }))],
    });
    expect(result.ok).toBe(true);
  });
});

describe('validateSkinPayload', () => {
  const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const json = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
  const good = () => ({
    id: 'my-skin',
    files: [
      { name: 'manifest.json', data: json({ name: 'x', poses: { idle: 'idle.png' } }) },
      { name: 'idle.png', data: png() },
    ],
  });

  it('accepts a complete skin', () => {
    const r = validateSkinPayload(good());
    expect(r.ok).toBe(true);
  });

  it('rejects bad ids', () => {
    for (const id of ['', '..', '../x', 'a/b', 'default', 3]) {
      expect(validateSkinPayload({ ...good(), id }).ok).toBe(false);
    }
  });

  it('rejects file names that could leave the skin folder or are not images', () => {
    for (const name of ['../x.png', 'a/b.png', 'a\\b.png', '.hidden.png', 'x.exe', 'x.png.exe', 'C:evil.png']) {
      const p = good();
      p.files.push({ name, data: png() });
      expect(validateSkinPayload(p).ok).toBe(false);
    }
  });

  it('rejects broken content', () => {
    const notPng = good();
    notPng.files[1]!.data = new Uint8Array([1, 2, 3, 4]);
    expect(validateSkinPayload(notPng).ok).toBe(false);

    const noManifest = good();
    noManifest.files.shift();
    expect(validateSkinPayload(noManifest).ok).toBe(false);

    const missingFile = good();
    missingFile.files[0]!.data = json({ poses: { idle: 'idle.png', happy: 'happy.png' } });
    expect(validateSkinPayload(missingFile).ok).toBe(false);

    const badPose = good();
    badPose.files[0]!.data = json({ poses: { idle: 'idle.png', happy: { sheet: 'idle.png' } } });
    expect(validateSkinPayload(badPose).ok).toBe(false);

    const noIdle = good();
    noIdle.files[0]!.data = json({ poses: { happy: 'idle.png' } });
    expect(validateSkinPayload(noIdle).ok).toBe(false);

    const dup = good();
    dup.files.push({ name: 'idle.png', data: png() });
    expect(validateSkinPayload(dup).ok).toBe(false);

    const empty = good();
    empty.files[1]!.data = new Uint8Array();
    expect(validateSkinPayload(empty).ok).toBe(false);
  });

  it('limits the number of files', () => {
    const p = good();
    for (let i = 0; i < MAX_SKIN_FILES; i++) p.files.push({ name: `f${i}.png`, data: png() });
    expect(validateSkinPayload(p).ok).toBe(false);
    expect(validateSkinPayload(null).ok).toBe(false);
    expect(validateSkinPayload({ id: 'x', files: 'nope' }).ok).toBe(false);
  });
});
