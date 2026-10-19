import { describe, expect, it } from 'vitest';
import { animate, detectRig } from '../src/maker/animate';
import { assembleSkin, buildSkin, prepareItem, type ItemInput } from '../src/maker/build';
import { createRaster, resizeArea, type Raster } from '../src/maker/process';

type RGB = [number, number, number];
const CREAM: RGB = [253, 238, 204];
const OUTLINE: RGB = [20, 20, 24];
const WHITE: RGB = [255, 255, 255];

function ellipse(r: Raster, cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (x < 0 || y < 0 || x >= r.width || y >= r.height) continue;
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) r.data.set([c[0], c[1], c[2], 255], (y * r.width + x) * 4);
    }
  }
}

function rect(r: Raster, x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) r.data.set([c[0], c[1], c[2], 255], (y * r.width + x) * 4);
}

/** A cartoon rabbit: two thin ears, a round head with two eyes (with highlights) and a white tail. */
function rabbit(): Raster {
  const r = createRaster(240, 320);
  for (const x of [88, 120]) {
    rect(r, x - 2, 8, x + 18, 125, OUTLINE);
    rect(r, x, 10, x + 16, 125, CREAM);
  }
  ellipse(r, 112, 200, 77, 92, OUTLINE);
  ellipse(r, 112, 200, 75, 90, CREAM);
  ellipse(r, 195, 260, 14, 14, OUTLINE);
  ellipse(r, 195, 260, 12, 12, WHITE);
  for (const x of [85, 140]) {
    ellipse(r, x, 190, 8, 10, OUTLINE);
    ellipse(r, x - 2, 186, 3, 3, WHITE);
  }
  return r;
}

const px = (r: Raster, x: number, y: number): [number, number, number, number] => {
  const i = (y * r.width + x) * 4;
  return [r.data[i]!, r.data[i + 1]!, r.data[i + 2]!, r.data[i + 3]!];
};

/** Dark pixels inside a box. */
function darkIn(r: Raster, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const [R, G, B, A] = px(r, x, y);
      if (A > 200 && 0.299 * R + 0.587 * G + 0.114 * B < 80) n++;
    }
  }
  return n;
}

/** Mean x of the opaque pixels in a row band. */
function centroidX(r: Raster, y0: number, y1: number): number {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < r.width; x++) {
      if (px(r, x, y)[3]! > 128) {
        sum += x;
        n++;
      }
    }
  }
  return sum / n;
}

const same = (a: Raster, b: Raster): boolean => a.width === b.width && a.height === b.height && a.data.every((v, i) => v === b.data[i]);

describe('detectRig', () => {
  const rig = detectRig(rabbit());

  it('finds the ears as the thin part above the head', () => {
    expect(rig.ears).not.toBeNull();
    expect(rig.ears!.top).toBe(8);
    expect(rig.ears!.base).toBeGreaterThan(105);
    expect(rig.ears!.base).toBeLessThan(135);
  });

  it('finds both eyes as solid blobs, highlight included, and ignores the outline', () => {
    expect(rig.eyes).toHaveLength(2);
    const [left, right] = rig.eyes;
    expect(left!.x).toBeCloseTo(85, 0);
    expect(right!.x).toBeCloseTo(140, 0);
    expect(left!.y).toBeCloseTo(190, 0);
    expect(left!.rx).toBeGreaterThan(7);
    expect(left!.rx).toBeLessThan(10);
    // the white highlight is part of the eye
    const { box, fill } = left!;
    expect(fill![(186 - box!.y) * box!.w + (83 - box!.x)]).toBe(1);
  });

  it('finds a white tail that is small next to the body', () => {
    expect(rig.tail).not.toBeNull();
    expect(rig.tail!.x).toBeCloseTo(195, -1);
    expect(rig.tail!.y).toBeCloseTo(260, -1);
  });

  it('finds the same parts at half the size (the maker previews on small copies)', () => {
    for (const [w, h] of [[180, 240], [120, 160], [90, 120]] as const) {
      const small = resizeArea(rabbit(), w, h);
      const found = detectRig(small);
      expect(found.ears, `${w}px ears`).not.toBeNull();
      expect(found.eyes, `${w}px eyes`).toHaveLength(2);
      expect(found.tail, `${w}px tail`).not.toBeNull();
      expect(animate(small, { preset: 'idle' })!.frames).toHaveLength(10);
    }
  });

  it('finds nothing in a blob, and does not take a white body for a tail', () => {
    const blob = createRaster(100, 100);
    ellipse(blob, 50, 50, 40, 40, CREAM);
    expect(detectRig(blob)).toMatchObject({ ears: null, eyes: [], tail: null });
    const ghost = createRaster(100, 100);
    ellipse(ghost, 50, 50, 40, 40, WHITE);
    ellipse(ghost, 40, 45, 5, 6, OUTLINE);
    ellipse(ghost, 62, 45, 5, 6, OUTLINE);
    const found = detectRig(ghost);
    expect(found.tail).toBeNull();
    expect(found.eyes).toHaveLength(2);
    expect(detectRig(createRaster(10, 10))).toMatchObject({ ears: null, eyes: [], tail: null });
  });
});

describe('animate', () => {
  const src = rabbit();
  const pad = Math.ceil(0.08 * 320);
  const eyeBox = (x: number, y: number): [number, number, number, number] => [x - 12 + pad, y - 14 + pad, x + 12 + pad, y + 14 + pad];

  it('does not touch its input and gives every frame the same padded size', () => {
    const copy = new Uint8ClampedArray(src.data);
    const a = animate(src, { preset: 'idle' })!;
    expect(src.data).toEqual(copy);
    expect(a.frames.length).toBe(a.durations.length);
    for (const f of a.frames) expect([f.width, f.height]).toEqual([240 + pad * 2, 320 + pad * 2]);
  });

  it('idle: rests, blinks, then flicks its ears; the rest frames are the original pixels', () => {
    const a = animate(src, { preset: 'idle' })!;
    expect(a.durations.reduce((s, d) => s + d, 0)).toBe(3870);
    const rest = a.frames[0]!;
    expect(px(rest, 10 + pad, 100 + pad)).toEqual(px(src, 10, 100));
    expect(a.frames[4]).toBe(rest);
    expect(a.frames[9]).toBe(rest);
    expect(px(rest, 95 + pad, 60 + pad)).toEqual(px(src, 95, 60));

    // frames 1-3 are the blink: the eyes get thin, and the skin where they were is painted over
    const open = darkIn(rest, ...eyeBox(85, 190));
    const half = darkIn(a.frames[1]!, ...eyeBox(85, 190));
    const closed = darkIn(a.frames[2]!, ...eyeBox(85, 190));
    expect(half).toBeLessThan(open * 0.7);
    expect(closed).toBeLessThan(open * 0.3);
    expect(closed).toBeGreaterThan(5);
    expect(darkIn(a.frames[2]!, ...eyeBox(140, 190))).toBeLessThan(open * 0.3);
    // nothing else on the face changed
    expect(px(a.frames[2]!, 112 + pad, 240 + pad)).toEqual(px(rest, 112 + pad, 240 + pad));
  });

  it('idle: the ears lean as one band, more toward the tips, and the head stays put', () => {
    const a = animate(src, { preset: 'idle' })!;
    const rest = a.frames[0]!;
    const flick = a.frames[6]!;
    const tip = (f: Raster): number => centroidX(f, 12 + pad, 30 + pad);
    const lowerEar = (f: Raster): number => centroidX(f, 85 + pad, 100 + pad);
    expect(tip(flick) - tip(rest)).toBeGreaterThan(8);
    expect(lowerEar(flick) - lowerEar(rest)).toBeGreaterThan(0);
    expect(lowerEar(flick) - lowerEar(rest)).toBeLessThan(tip(flick) - tip(rest));
    // below the ears nothing moves
    for (let y = 150; y < 300; y += 25) for (let x = 40; x < 190; x += 15) expect(px(flick, x + pad, y + pad)).toEqual(px(rest, x + pad, y + pad));
  });

  it('walk: one 500ms step of 8 frames; ears and tail move, the face does not', () => {
    const a = animate(src, { preset: 'walk' })!;
    expect(a.frames).toHaveLength(8);
    expect(a.durations.every((d) => d === 62.5)).toBe(true);
    const lean = a.frames.map((f) => centroidX(f, 12 + pad, 30 + pad));
    expect(Math.max(...lean) - Math.min(...lean)).toBeGreaterThan(6);
    for (const f of a.frames) expect(darkIn(f, ...eyeBox(85, 190))).toBe(darkIn(a.frames[0]!, ...eyeBox(85, 190)));
    expect(same(a.frames[0]!, a.frames[4]!)).toBe(false);
  });

  it('run: the ears stream backwards, whichever way that is', () => {
    const rest = animate(src, { preset: 'idle' })!.frames[0]!;
    const tip = (f: Raster): number => centroidX(f, 12 + pad, 30 + pad);
    const right = animate(src, { preset: 'run', back: 1 })!;
    const left = animate(src, { preset: 'run', back: -1 })!;
    expect(right.frames).toHaveLength(6);
    expect(right.durations.reduce((s, d) => s + d, 0)).toBeCloseTo(294, 5);
    for (const f of right.frames) expect(tip(f)).toBeGreaterThan(tip(rest) + 10);
    for (const f of left.frames) expect(tip(f)).toBeLessThan(tip(rest) - 10);
  });

  it('sleep: the eyes are shut in every frame', () => {
    const awake = darkIn(src, ...[85 - 12, 190 - 14, 85 + 12, 190 + 14]);
    const a = animate(src, { preset: 'sleep' })!;
    for (const f of a.frames) expect(darkIn(f, ...eyeBox(85, 190))).toBeLessThan(awake * 0.3);
    expect(a.durations[0]).toBeGreaterThan(2000);
  });

  it('returns nothing when there is nothing to move', () => {
    const blob = createRaster(100, 100);
    ellipse(blob, 50, 50, 40, 40, CREAM);
    expect(animate(blob, { preset: 'idle' })).toBeNull();
    expect(animate(blob, { preset: 'walk' })).toBeNull();
    // a part can be switched off by hand
    expect(animate(src, { preset: 'walk', rig: { ears: null, tail: null } })).toBeNull();
    // and given by hand
    const byHand = animate(blob, { preset: 'idle', rig: { ears: { top: 10, base: 40 } } });
    expect(byHand).not.toBeNull();
  });

  it('amount scales the movement', () => {
    const tip = (f: Raster): number => centroidX(f, 12 + pad, 30 + pad);
    const lean = (amount: number): number => Math.max(...animate(src, { preset: 'idle', amount })!.frames.map(tip)) - tip(animate(src, { preset: 'idle' })!.frames[0]!);
    expect(lean(2)).toBeGreaterThan(lean(1) * 1.5);
    expect(lean(0.5)).toBeLessThan(lean(1) * 0.7);
  });
});

describe('animated items in the build', () => {
  const item = (over: Partial<ItemInput>): ItemInput => ({ pose: 'idle', frames: [rabbit()], durations: [100], bg: null, scale: 1, motionOff: false, ...over });

  it('prepareItem turns a still into frames and says what it found to move', () => {
    const p = prepareItem(item({ anim: { preset: 'idle' } }))!;
    expect(p.frames.length).toBe(10);
    expect(p.durations.length).toBe(10);
    expect(p.moves).toEqual({ eyes: 2, ears: true, tail: true });
    for (const f of p.frames) expect([f.width, f.height]).toEqual([p.w, p.h]);
    const still = prepareItem(item({}))!;
    expect(still.frames).toHaveLength(1);
    expect(still.moves).toBeUndefined();
    expect(prepareItem(item({ frames: [createRaster(50, 50)] }))).toBeNull();
  });

  it('says so when nothing could be moved, and keeps the still', () => {
    const blob = createRaster(100, 100);
    ellipse(blob, 50, 50, 40, 40, CREAM);
    const p = prepareItem(item({ frames: [blob], anim: { preset: 'idle' } }))!;
    expect(p.frames).toHaveLength(1);
    expect(p.moves).toBeNull();
  });

  it('an image that already moves is left alone', () => {
    const p = prepareItem(item({ frames: [rabbit(), rabbit()], durations: [80, 80], anim: { preset: 'idle' } }))!;
    expect(p.frames).toHaveLength(2);
    expect(p.moves).toBeUndefined();
  });

  it('animated poses share the canvas with still ones and become sheets with their own timing', () => {
    const built = buildSkin([item({ anim: { preset: 'idle' } }), item({ pose: 'sleep', anim: { preset: 'sleep' } }), item({ pose: 'happy' })]);
    const { manifest, images } = assembleSkin(built, { name: 't', facing: 'left' });
    for (const p of built.poses) for (const f of p.frames) expect([f.width, f.height]).toEqual([built.width, built.height]);
    const idle = manifest.poses.idle;
    expect(typeof idle).toBe('object');
    if (typeof idle === 'object') {
      expect(idle.count).toBe(10);
      expect(Array.isArray(idle.durations)).toBe(true);
      expect((idle.durations as number[]).reduce((s, d) => s + d, 0)).toBe(3870);
    }
    expect(manifest.poses.happy).toBe('happy.png');
    expect(images.map((i) => i.name).sort()).toEqual(['happy.png', 'idle.png', 'sleep.png']);
    // the motion is the picture's own, but the engine's hop and squash stay on (only a self-animated GIF turns them off)
    expect(manifest.motion).toBeUndefined();
  });
});
