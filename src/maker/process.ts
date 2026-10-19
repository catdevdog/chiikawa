import type { Rect } from '../engine/types';

/** Straight (non-premultiplied) RGBA pixels. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type RGB = [number, number, number];

export function createRaster(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneRaster(r: Raster): Raster {
  return { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) };
}

/** Visits every pixel on the outer border once. */
function forEachBorder(w: number, h: number, fn: (p: number) => void): void {
  for (let x = 0; x < w; x++) {
    fn(x);
    if (h > 1) fn((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    fn(y * w);
    if (w > 1) fn(y * w + w - 1);
  }
}

/** True when (nearly) the whole border is already transparent, i.e. there is no background to remove. */
export function hasTransparentBorder(r: Raster, share = 0.9): boolean {
  let total = 0;
  let clear = 0;
  forEachBorder(r.width, r.height, (p) => {
    total++;
    if (r.data[p * 4 + 3]! < 24) clear++;
  });
  return total > 0 && clear / total >= share;
}

/** The most common opaque colour along the border (what a flat background looks like), or null if there is none. */
export function dominantBorderColor(r: Raster): RGB | null {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  forEachBorder(r.width, r.height, (p) => {
    const i = p * 4;
    if (r.data[i + 3]! < 200) return;
    const cr = r.data[i]!;
    const cg = r.data[i + 1]!;
    const cb = r.data[i + 2]!;
    const key = ((cr >> 3) << 10) | ((cg >> 3) << 5) | (cb >> 3);
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n++;
    bin.r += cr;
    bin.g += cg;
    bin.b += cb;
    bins.set(key, bin);
  });
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin;
  return best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : null;
}

export interface BgOptions {
  /** colour to remove */
  key: RGB;
  /** 0..100; how far from `key` a colour may be and still count as background */
  tolerance: number;
  /** true: only background connected to the border goes (keeps white eyes and bellies); false: every matching pixel */
  contiguous: boolean;
  /** px (0..4) shaved off the edge to get rid of leftover halos */
  erode: number;
  /** px (0..4) of edge softening */
  feather: number;
}

export const DEFAULT_BG: Omit<BgOptions, 'key'> = { tolerance: 14, contiguous: true, erode: 0, feather: 0 };

const dist3 = (r: number, g: number, b: number, k: RGB): number => Math.hypot(r - k[0], g - k[1], b - k[2]);

/**
 * Makes the background transparent. Edge pixels are un-mixed from the background colour
 * (P = a*F + (1-a)*K) so the outline keeps its own colour and a soft alpha instead of a white fringe.
 */
export function removeBackground(src: Raster, o: BgOptions): Raster {
  const { width: w, height: h } = src;
  const out = cloneRaster(src);
  const s = src.data;
  const d = out.data;
  const thr = Math.max(0, o.tolerance) * 1.5;
  const soft = Math.max(thr * 0.6, 8);
  const strong = thr + soft;
  const key = o.key;
  const keyDist = (i: number): number => dist3(s[i]!, s[i + 1]!, s[i + 2]!, key);

  const candidate = (p: number): boolean => s[p * 4 + 3]! < 16 || keyDist(p * 4) <= thr;
  const bg = new Uint8Array(w * h);
  if (o.contiguous) {
    const stack: number[] = [];
    const push = (p: number): void => {
      if (!bg[p] && candidate(p)) {
        bg[p] = 1;
        stack.push(p);
      }
    };
    forEachBorder(w, h, push);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p / w) | 0;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
  } else {
    for (let p = 0; p < w * h; p++) if (candidate(p)) bg[p] = 1;
  }

  const touchesBg = (p: number): boolean => {
    const x = p % w;
    const y = (p / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && bg[ny * w + nx]) return true;
      }
    }
    return false;
  };

  const alpha = new Uint8ClampedArray(w * h);
  for (let p = 0; p < w * h; p++) alpha[p] = bg[p] ? 0 : s[p * 4 + 3]!;

  // edge pixels: estimate the foreground colour from the strongest nearby non-background pixel
  for (let p = 0; p < w * h; p++) {
    if (bg[p] || !touchesBg(p)) continue;
    const i = p * 4;
    const x = p % w;
    const y = (p / w) | 0;
    let fr = 0;
    let fg = 0;
    let fb = 0;
    let fd = -1;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const q = ny * w + nx;
        if (bg[q]) continue;
        const dd = keyDist(q * 4);
        if (dd > fd) {
          fd = dd;
          fr = s[q * 4]!;
          fg = s[q * 4 + 1]!;
          fb = s[q * 4 + 2]!;
        }
      }
    }
    const vx = fr - key[0];
    const vy = fg - key[1];
    const vz = fb - key[2];
    const len2 = vx * vx + vy * vy + vz * vz;
    let a: number;
    if (fd >= strong && len2 > 100) {
      // project the pixel onto the background -> foreground line
      a = ((s[i]! - key[0]) * vx + (s[i + 1]! - key[1]) * vy + (s[i + 2]! - key[2]) * vz) / len2;
      a = Math.min(1, Math.max(0, a));
      if (a > 0.02) {
        d[i] = fr;
        d[i + 1] = fg;
        d[i + 2] = fb;
      }
    } else {
      // no clearly different neighbour (e.g. a white body next to a white background): fall back to colour distance
      a = Math.min(1, Math.max(0, (keyDist(i) - thr) / soft));
    }
    alpha[p] = Math.round(alpha[p]! * a);
  }

  for (let n = 0; n < Math.round(o.erode); n++) erodeAlpha(alpha, w, h);
  const radius = Math.round(o.feather);
  if (radius > 0) blurAlpha(alpha, w, h, radius);

  for (let p = 0; p < w * h; p++) {
    d[p * 4 + 3] = alpha[p]!;
    if (!alpha[p]) {
      d[p * 4] = 0;
      d[p * 4 + 1] = 0;
      d[p * 4 + 2] = 0;
    }
  }
  return out;
}

function erodeAlpha(a: Uint8ClampedArray, w: number, h: number): void {
  const copy = new Uint8ClampedArray(a);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let m = copy[p]!;
      if (x > 0) m = Math.min(m, copy[p - 1]!);
      if (x < w - 1) m = Math.min(m, copy[p + 1]!);
      if (y > 0) m = Math.min(m, copy[p - w]!);
      if (y < h - 1) m = Math.min(m, copy[p + w]!);
      a[p] = m;
    }
  }
}

/** Separable box blur of the alpha channel; the border counts as transparent. */
function blurAlpha(a: Uint8ClampedArray, w: number, h: number, r: number): void {
  const size = 2 * r + 1;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w) sum += a[y * w + xx]!;
      }
      tmp[y * w + x] = sum / size;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h) sum += tmp[yy * w + x]!;
      }
      a[y * w + x] = Math.round(sum / size);
    }
  }
}

/** Bounding box of pixels whose alpha exceeds `threshold`, or null for an empty image. */
export function alphaBounds(r: Raster, threshold = 8): Rect | null {
  let x0 = r.width;
  let y0 = r.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      if (r.data[(y * r.width + x) * 4 + 3]! > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function crop(r: Raster, rect: Rect): Raster {
  const out = createRaster(rect.w, rect.h);
  for (let y = 0; y < rect.h; y++) {
    const from = ((rect.y + y) * r.width + rect.x) * 4;
    out.data.set(r.data.subarray(from, from + rect.w * 4), y * rect.w * 4);
  }
  return out;
}

/** A mirrored copy (for artwork that faces the other way from the rest of the skin). */
export function flipHorizontal(r: Raster): Raster {
  const out = createRaster(r.width, r.height);
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const si = (y * r.width + x) * 4;
      const di = (y * r.width + (r.width - 1 - x)) * 4;
      out.data[di] = r.data[si]!;
      out.data[di + 1] = r.data[si + 1]!;
      out.data[di + 2] = r.data[si + 2]!;
      out.data[di + 3] = r.data[si + 3]!;
    }
  }
  return out;
}

/** Places `src` on a transparent canvas, horizontally centred and `bottomPad` px above the bottom edge. */
export function composeBottomCenter(src: Raster, width: number, height: number, bottomPad = 0): Raster {
  const out = createRaster(width, height);
  const ox = Math.floor((width - src.width) / 2);
  const oy = height - bottomPad - src.height;
  for (let y = 0; y < src.height; y++) {
    const dy = oy + y;
    if (dy < 0 || dy >= height) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = ox + x;
      if (dx < 0 || dx >= width) continue;
      const si = (y * src.width + x) * 4;
      const di = (dy * width + dx) * 4;
      out.data[di] = src.data[si]!;
      out.data[di + 1] = src.data[si + 1]!;
      out.data[di + 2] = src.data[si + 2]!;
      out.data[di + 3] = src.data[si + 3]!;
    }
  }
  return out;
}

/** Box-filter downscale in premultiplied space (no dark or white fringes). Never enlarges. */
export function resizeArea(src: Raster, nw: number, nh: number): Raster {
  nw = Math.max(1, Math.round(nw));
  nh = Math.max(1, Math.round(nh));
  if (nw >= src.width && nh >= src.height) return cloneRaster(src);
  const out = createRaster(nw, nh);
  const sx = src.width / nw;
  const sy = src.height / nh;
  for (let y = 0; y < nh; y++) {
    const y0 = y * sy;
    const y1 = (y + 1) * sy;
    for (let x = 0; x < nw; x++) {
      const x0 = x * sx;
      const x1 = (x + 1) * sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let total = 0;
      for (let yy = Math.floor(y0); yy < Math.min(src.height, Math.ceil(y1)); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.min(src.width, Math.ceil(x1)); xx++) {
          const weight = (Math.min(xx + 1, x1) - Math.max(xx, x0)) * wy;
          const i = (yy * src.width + xx) * 4;
          const al = (src.data[i + 3]! / 255) * weight;
          r += src.data[i]! * al;
          g += src.data[i + 1]! * al;
          b += src.data[i + 2]! * al;
          a += al;
          total += weight;
        }
      }
      const o = (y * nw + x) * 4;
      if (a > 0) {
        out.data[o] = r / a;
        out.data[o + 1] = g / a;
        out.data[o + 2] = b / a;
      }
      out.data[o + 3] = total > 0 ? (a / total) * 255 : 0;
    }
  }
  return out;
}

/** Keeps at most `max` frames, merging the skipped frames' time into the kept ones. */
export function decimateFrames(frames: Raster[], durations: number[], max: number): { frames: Raster[]; durations: number[] } {
  if (frames.length <= max) return { frames, durations };
  const keptFrames: Raster[] = [];
  const keptDurations: number[] = [];
  const step = frames.length / max;
  for (let i = 0; i < max; i++) {
    const from = Math.floor(i * step);
    const to = Math.max(from + 1, Math.floor((i + 1) * step));
    keptFrames.push(frames[from]!);
    keptDurations.push(durations.slice(from, to).reduce((sum, d) => sum + d, 0));
  }
  return { frames: keptFrames, durations: keptDurations };
}

/** Lays frames out left to right, top to bottom on one sheet. */
export function buildSheet(frames: Raster[], columns: number): Raster {
  const fw = frames[0]!.width;
  const fh = frames[0]!.height;
  const cols = Math.max(1, Math.min(columns, frames.length));
  const rows = Math.ceil(frames.length / cols);
  const sheet = createRaster(cols * fw, rows * fh);
  frames.forEach((f, n) => {
    const ox = (n % cols) * fw;
    const oy = Math.floor(n / cols) * fh;
    for (let y = 0; y < fh; y++) {
      sheet.data.set(f.data.subarray(y * fw * 4, (y + 1) * fw * 4), ((oy + y) * sheet.width + ox) * 4);
    }
  });
  return sheet;
}
