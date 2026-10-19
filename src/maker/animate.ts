import { createRaster, type Raster } from './process';

/**
 * Moves a still image without redrawing it: ears sway, eyes blink, a tail wiggles. Every frame is the original
 * pixels warped a little, so the character stays exactly as drawn. The parts are found from the picture itself
 * (see `detectRig`); a preset that finds nothing to move returns nothing and the image stays still.
 */

export type AnimPreset = 'idle' | 'walk' | 'run' | 'sleep' | 'flutter';
export const ANIM_PRESETS: readonly AnimPreset[] = ['idle', 'walk', 'run', 'sleep', 'flutter'];

export interface Eye {
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** the eye as a solid shape (highlight filled in) over `box`: what is squashed when the eye closes */
  box?: { x: number; y: number; w: number; h: number };
  fill?: Uint8Array;
  color?: [number, number, number];
}

export interface Rig {
  /** the ears are the narrow part above the head: rows from `top` down to `base` */
  ears: { top: number; base: number } | null;
  eyes: Eye[];
  /** a white fluffy tail: its centre, radius and the point it hangs on */
  tail: { x: number; y: number; r: number; ax: number; ay: number } | null;
  /** a propeller-like part that flutters sideways; never detected, only given by hand */
  blades: { cx: number; top: number; bottom: number } | null;
}

export interface AnimSpec {
  preset: AnimPreset;
  /** strength of the movement, 1 = default */
  amount?: number;
  /** which way ears and tail stream when running: +1 = toward +x in the image */
  back?: 1 | -1;
  /** parts given by hand (in the coordinates of the image passed in); `null` switches a detected part off */
  rig?: Partial<Rig>;
}

export interface Animated {
  /** all frames have the same size: the original plus a margin for the movement */
  frames: Raster[];
  /** ms per frame */
  durations: number[];
  rig: Rig;
}

const EMPTY_RIG: Rig = { ears: null, eyes: [], tail: null, blades: null };

const lum = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

interface Component {
  area: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  sx: number;
  sy: number;
  r: number;
  g: number;
  b: number;
  /** touches transparent pixels or the image border */
  open: boolean;
  label: number;
}

/** 4-connected components of `on`; returns the label map and one record per component. */
function components(on: Uint8Array, mask: Uint8Array, data: Uint8ClampedArray, w: number, h: number): { labels: Int32Array; list: Component[] } {
  const labels = new Int32Array(w * h);
  const list: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < on.length; start++) {
    if (!on[start] || labels[start]) continue;
    const label = list.length + 1;
    const c: Component = { area: 0, x0: w, y0: h, x1: -1, y1: -1, sx: 0, sy: 0, r: 0, g: 0, b: 0, open: false, label };
    labels[start] = label;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p / w) | 0;
      c.area++;
      c.sx += x;
      c.sy += y;
      c.r += data[p * 4]!;
      c.g += data[p * 4 + 1]!;
      c.b += data[p * 4 + 2]!;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      const visit = (q: number, inside: boolean): void => {
        if (!inside || !mask[q]) {
          c.open = true;
          return;
        }
        if (on[q] && !labels[q]) {
          labels[q] = label;
          stack.push(q);
        }
      };
      visit(p - 1, x > 0);
      visit(p + 1, x < w - 1);
      visit(p - w, y > 0);
      visit(p + w, y < h - 1);
    }
    list.push(c);
  }
  return { labels, list };
}

/** Finds the ears, eyes and tail of a character (see `Rig`). Works on an image with a transparent background. */
export function detectRig(src: Raster): Rig {
  const { width: w, height: h, data } = src;
  const n = w * h;
  const mask = new Uint8Array(n);
  let area = 0;
  let bx0 = w;
  let by0 = h;
  let bx1 = -1;
  let by1 = -1;
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3]! <= 128) continue;
    mask[i] = 1;
    area++;
    const x = i % w;
    const y = (i / w) | 0;
    if (x < bx0) bx0 = x;
    if (x > bx1) bx1 = x;
    if (y < by0) by0 = y;
    if (y > by1) by1 = y;
  }
  if (area === 0) return { ...EMPTY_RIG };
  const W = bx1 - bx0 + 1;
  const H = by1 - by0 + 1;

  const ears = detectEars(mask, w, bx0, bx1, by0, by1, W, H);
  const eyes = detectEyes(data, mask, w, h, area, ears ? ears.base : by0);
  const tail = detectTail(data, mask, w, h, area, { x: (bx0 + bx1) / 2, y: (by0 + by1) / 2 }, Math.max(W, H));
  return { ears, eyes, tail, blades: null };
}

function detectEars(mask: Uint8Array, w: number, x0: number, x1: number, y0: number, y1: number, W: number, H: number): Rig['ears'] {
  // ears are a narrow band on top of the head: the head starts where the row width suddenly jumps
  const total = new Int32Array(y1 + 1);
  for (let y = y0; y <= y1; y++) {
    let n = 0;
    for (let x = x0; x <= x1; x++) n += mask[y * w + x]!;
    total[y] = n;
  }
  let base = -1;
  // the rows just above the current one, as a share of the height (about 20 to 6 rows of a 650px picture)
  const far = Math.max(3, Math.round(0.031 * H));
  const near = Math.max(1, Math.round(0.012 * H));
  for (let y = y0 + Math.round(0.08 * H); y <= y1; y++) {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(y0, y - far); k <= y - near; k++) {
      sum += total[k]!;
      count++;
    }
    if (count > 0 && total[y]! >= 1.25 * (sum / count) && total[y]! >= 0.15 * W) {
      base = y;
      break;
    }
  }
  if (base < 0) return null;
  const zone = base - y0;
  if (zone < 0.1 * H || zone > 0.6 * H) return null;
  let band = 0;
  for (let y = y0; y < base; y++) band += total[y]!;
  if (band / zone > 0.45 * W) return null;
  return { top: y0, base };
}

function detectEyes(data: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, area: number, belowY: number): Eye[] {
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < dark.length; i++) {
    if (mask[i] && data[i * 4 + 3]! > 200 && lum(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!) < 80) dark[i] = 1;
  }
  const { labels, list } = components(dark, mask, data, w, h);
  const candidates = list.filter((c) => {
    if (c.open || c.area < 0.0012 * area || c.area > 0.05 * area) return false;
    const bw = c.x1 - c.x0 + 1;
    const bh = c.y1 - c.y0 + 1;
    if ((c.y0 + c.y1) / 2 < belowY) return false;
    const aspect = bh / bw;
    return aspect >= 0.55 && aspect <= 2.6 && c.area / (bw * bh) >= 0.4;
  });
  // an eye is a solid, roundish blob once its highlight is filled in; glyphs and strokes are not
  const eyes = candidates.map((c) => buildEye(c, labels, w)).filter((e) => e.fill && fillRatio(e) >= 0.62);
  eyes.sort((a, b) => b.rx * b.ry - a.rx * a.ry);
  const first = eyes[0];
  if (!first) return [];
  const partner = eyes.slice(1).find((e) => {
    const sizeRatio = (e.rx * e.ry) / (first.rx * first.ry);
    return sizeRatio >= 0.5 && Math.abs(e.y - first.y) <= 0.9 * Math.max(e.ry, first.ry) * 2 && Math.abs(e.x - first.x) >= 1.2 * Math.max(e.rx, first.rx) * 2;
  });
  return partner ? [first, partner].sort((a, b) => a.x - b.x) : [first];
}

const fillRatio = (e: Eye): number => {
  let n = 0;
  for (const v of e.fill!) n += v;
  return n / e.fill!.length;
};

/** An eye as a filled shape: the dark blob plus the highlight and anything else enclosed by it. */
function buildEye(c: Component, labels: Int32Array, w: number): Eye {
  const bw = c.x1 - c.x0 + 1;
  const bh = c.y1 - c.y0 + 1;
  const own = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (labels[(c.y0 + y) * w + c.x0 + x] === c.label) own[y * bw + x] = 1;
  // a one pixel halo closes the thin gaps that antialiasing leaves around a highlight
  const barrier = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (!own[y * bw + x]) continue;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          if (x + i >= 0 && y + j >= 0 && x + i < bw && y + j < bh) barrier[(y + j) * bw + x + i] = 1;
        }
      }
    }
  }
  // everything reachable from the box border without crossing the blob is outside
  const outside = new Uint8Array(bw * bh);
  const stack: number[] = [];
  const push = (x: number, y: number): void => {
    const i = y * bw + x;
    if (!barrier[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < bw; x++) {
    push(x, 0);
    push(x, bh - 1);
  }
  for (let y = 0; y < bh; y++) {
    push(0, y);
    push(bw - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % bw;
    const y = (i / bw) | 0;
    if (x > 0) push(x - 1, y);
    if (x < bw - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < bh - 1) push(x, y + 1);
  }
  const isOutside = (x: number, y: number): boolean => x < 0 || y < 0 || x >= bw || y >= bh || outside[y * bw + x] === 1;
  const fill = new Uint8Array(bw * bh);
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      let inside: boolean;
      if (own[i]) inside = true;
      else if (outside[i]) inside = false;
      // halo pixels belong to the eye only when they are not on its outer rim
      else if (barrier[i]) inside = !(isOutside(x - 1, y) || isOutside(x + 1, y) || isOutside(x, y - 1) || isOutside(x, y + 1));
      else inside = true;
      if (!inside) continue;
      fill[i] = 1;
      sx += x;
      sy += y;
      count++;
    }
  }
  return {
    x: c.x0 + sx / count + 0.5,
    y: c.y0 + sy / count + 0.5,
    rx: bw / 2,
    ry: bh / 2,
    box: { x: c.x0, y: c.y0, w: bw, h: bh },
    fill,
    color: [Math.round(c.r / c.area), Math.round(c.g / c.area), Math.round(c.b / c.area)],
  };
}

function detectTail(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  w: number,
  h: number,
  area: number,
  center: { x: number; y: number },
  size: number,
): Rig['tail'] {
  const white = new Uint8Array(w * h);
  for (let i = 0; i < white.length; i++) {
    if (mask[i] && data[i * 4 + 3]! > 200 && Math.min(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!) >= 236) white[i] = 1;
  }
  const { list } = components(white, mask, data, w, h);
  // a tail is a clearly visible white patch that is small next to the body (a white character has no such patch)
  const best = list.filter((c) => c.area >= 0.004 * area && c.area <= 0.12 * area).sort((a, b) => b.area - a.area)[0];
  if (!best) return null;
  const x = best.sx / best.area + 0.5;
  const y = best.sy / best.area + 0.5;
  if (Math.hypot(x - center.x, y - center.y) < 0.25 * size) return null;
  const r = Math.sqrt(best.area / Math.PI) * 1.3;
  // it hangs on the body side
  const d = Math.hypot(center.x - x, center.y - y) || 1;
  return { x, y, r, ax: x + ((center.x - x) / d) * r * 0.9, ay: y + ((center.y - y) / d) * r * 0.9 };
}

// --- poses and timelines ------------------------------------------------------------------------------

/** One look of the character; every value is 0 at rest. */
interface Pose {
  /** lean of the ears, as a fraction of their length (+ = toward +x); both ears lean together */
  ear: number;
  /** 0 = eyes open, 1 = closed */
  blink: number;
  /** tail swing in radians around its hanging point */
  tail: number;
  /** width of the propeller as a fraction of normal */
  blades: number;
}

const REST: Pose = { ear: 0, blink: 0, tail: 0, blades: 1 };
const poseKey = (p: Pose): string => [p.ear, p.blink, p.tail, p.blades].map((v) => v.toFixed(4)).join();

interface Key {
  pose: Pose;
  ms: number;
}

function timeline(spec: AnimSpec, rig: Rig): Key[] | null {
  const k = spec.amount ?? 1;
  const back = spec.back ?? 1;
  const hasEars = !!rig.ears;
  const hasEyes = rig.eyes.length > 0;
  const hasTail = !!rig.tail;
  const hasBlades = !!rig.blades;
  const key = (over: Partial<Pose>, ms: number): Key => ({ pose: { ...REST, ...over }, ms });
  const cycle = (frames: number, ms: number, at: (phase: number) => Partial<Pose>): Key[] =>
    Array.from({ length: frames }, (_, i) => key(at(i / frames), ms / frames));
  const sin = (phase: number): number => Math.sin(2 * Math.PI * phase);

  switch (spec.preset) {
    case 'idle': {
      if (!hasEars && !hasEyes && !hasTail) return null;
      const keys: Key[] = [key({}, 1500)];
      if (hasEyes) keys.push(key({ blink: 0.55 }, 70), key({ blink: 1 }, 90), key({ blink: 0.55 }, 70));
      keys.push(key({}, 900));
      if (hasEars) keys.push(key({ ear: 0.16 * k }, 60), key({ ear: 0.3 * k }, 60), key({ ear: 0.12 * k }, 60), key({ ear: -0.06 * k }, 60));
      else if (hasTail) keys.push(key({ tail: 0.4 * k }, 70), key({ tail: -0.4 * k }, 70), key({ tail: 0.2 * k }, 70));
      keys.push(key({}, 1000));
      return keys;
    }
    case 'walk': {
      if (!hasEars && !hasTail) return null;
      // one step is 500 ms, the engine's walking hop
      return cycle(8, 500, (ph) => ({ ear: 0.14 * k * sin(ph - 0.2), tail: 0.35 * k * sin(ph + 0.1) }));
    }
    case 'run': {
      if (!hasEars && !hasTail) return null;
      // one stride is 294 ms; the ears stream backwards
      return cycle(6, 294, (ph) => ({ ear: back * k * (0.24 + 0.08 * sin(ph)), tail: 0.4 * k * sin(2 * ph) }));
    }
    case 'sleep': {
      if (!hasEyes && !hasEars && !hasTail) return null;
      const closed = hasEyes ? 1 : 0;
      const keys: Key[] = [key({ blink: closed }, 3200)];
      if (hasEars) keys.push(key({ blink: closed, ear: 0.14 * k }, 70), key({ blink: closed, ear: 0.26 * k }, 70), key({ blink: closed, ear: 0.1 * k }, 70));
      else if (hasTail) keys.push(key({ blink: closed, tail: 0.35 * k }, 80), key({ blink: closed, tail: -0.35 * k }, 80));
      keys.push(key({ blink: closed }, 4300));
      return keys;
    }
    case 'flutter': {
      if (!hasBlades && !hasEars) return null;
      const widths = [1, 0.55, 0.8, 0.4];
      return widths.map((wd, i) => key({ blades: hasBlades ? 1 - (1 - wd) * Math.min(1, k) : 1, ear: 0.05 * k * (i % 2 ? 1 : -1) }, 50));
    }
  }
}

// --- warping ------------------------------------------------------------------------------------------------

function padRaster(src: Raster, pad: number): Raster {
  const out = createRaster(src.width + pad * 2, src.height + pad * 2);
  for (let y = 0; y < src.height; y++) {
    out.data.set(src.data.subarray(y * src.width * 4, (y + 1) * src.width * 4), ((y + pad) * out.width + pad) * 4);
  }
  return out;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Bilinear sample in premultiplied space at continuous coordinates (pixel centres at +0.5). */
function sample(src: Uint8ClampedArray, w: number, h: number, fx: number, fy: number, out: Uint8ClampedArray, o: number): void {
  const x = fx - 0.5;
  const y = fy - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  let a = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let j = 0; j < 2; j++) {
    const yy = y0 + j;
    if (yy < 0 || yy >= h) continue;
    for (let i = 0; i < 2; i++) {
      const xx = x0 + i;
      if (xx < 0 || xx >= w) continue;
      const wt = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
      const p = (yy * w + xx) * 4;
      const wa = wt * src[p + 3]!;
      a += wa;
      r += wa * src[p]!;
      g += wa * src[p + 1]!;
      b += wa * src[p + 2]!;
    }
  }
  if (a <= 0) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    return;
  }
  out[o] = r / a;
  out[o + 1] = g / a;
  out[o + 2] = b / a;
  out[o + 3] = a;
}

/** An eye as a mask: the detected shape, or an ellipse when only a position and size were given. */
function eyeShape(e: Eye): { box: { x: number; y: number; w: number; h: number }; fill: Uint8Array } {
  if (e.box && e.fill) return { box: e.box, fill: e.fill };
  const x = Math.floor(e.x - e.rx);
  const y = Math.floor(e.y - e.ry);
  const w = Math.ceil(e.rx * 2) + 1;
  const h = Math.ceil(e.ry * 2) + 1;
  const fill = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const dx = (x + i + 0.5 - e.x) / e.rx;
      const dy = (y + j + 0.5 - e.y) / e.ry;
      if (dx * dx + dy * dy <= 1) fill[j * w + i] = 1;
    }
  }
  return { box: { x, y, w, h }, fill };
}

const median = (v: number[]): number => v.sort((a, b) => a - b)[v.length >> 1]!;

/** The colour of the skin around an eye: the median of the light, opaque pixels a few pixels outside it. */
function skinAround(src: Raster, box: { x: number; y: number; w: number; h: number }, fill: Uint8Array): [number, number, number] {
  const size = Math.max(box.w, box.h);
  const inner = Math.max(1, Math.round(0.06 * size));
  const outer = Math.max(inner + 2, Math.round(0.17 * size));
  const near = (x: number, y: number, d: number): boolean => {
    for (let j = -d; j <= d; j++) {
      for (let i = -d; i <= d; i++) {
        const mx = x + i - box.x;
        const my = y + j - box.y;
        if (mx >= 0 && my >= 0 && mx < box.w && my < box.h && fill[my * box.w + mx]) return true;
      }
    }
    return false;
  };
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = Math.max(0, box.y - outer - 1); y < Math.min(src.height, box.y + box.h + outer + 1); y++) {
    for (let x = Math.max(0, box.x - outer - 1); x < Math.min(src.width, box.x + box.w + outer + 1); x++) {
      const p = (y * src.width + x) * 4;
      if (src.data[p + 3]! < 250 || lum(src.data[p]!, src.data[p + 1]!, src.data[p + 2]!) < 150) continue;
      if (near(x, y, inner) || !near(x, y, outer)) continue;
      rs.push(src.data[p]!);
      gs.push(src.data[p + 1]!);
      bs.push(src.data[p + 2]!);
    }
  }
  return rs.length >= 8 ? [median(rs), median(gs), median(bs)] : [255, 255, 255];
}

/** The picture with every eye wiped out (painted over with the skin around it). */
function withoutEyes(src: Raster, eyes: Eye[]): Raster {
  const out: Raster = { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
  for (const e of eyes) {
    const { box, fill } = eyeShape(e);
    const [r, g, b] = skinAround(src, box, fill);
    // a little further than the eye itself, to take the soft edge with it
    const grow = Math.max(1, Math.round(0.04 * Math.max(box.w, box.h)));
    for (let y = box.y - grow - 1; y < box.y + box.h + grow + 1; y++) {
      for (let x = box.x - grow - 1; x < box.x + box.w + grow + 1; x++) {
        if (x < 0 || y < 0 || x >= src.width || y >= src.height) continue;
        let hit = false;
        for (let j = -grow; j <= grow && !hit; j++) {
          for (let i = -grow; i <= grow; i++) {
            const mx = x + i - box.x;
            const my = y + j - box.y;
            if (mx >= 0 && my >= 0 && mx < box.w && my < box.h && fill[my * box.w + mx]) {
              hit = true;
              break;
            }
          }
        }
        if (!hit) continue;
        const p = (y * src.width + x) * 4;
        out.data[p] = r;
        out.data[p + 1] = g;
        out.data[p + 2] = b;
        out.data[p + 3] = 255;
      }
    }
  }
  return out;
}

/** Draws an eye that is `blink` closed: the same shape squashed flat (and a little wider), over the wiped skin. */
function drawEye(out: Raster, e: Eye, blink: number): void {
  const { box, fill } = eyeShape(e);
  const color = e.color ?? [20, 20, 25];
  const k = 1 - 0.86 * blink;
  const kx = 1 + 0.22 * blink;
  const halfW = (box.w / 2) * kx + 2;
  const halfH = (box.h / 2) * k + 2;
  const rows = Math.max(1, Math.ceil(1 / k));
  const maskAt = (u: number, v: number): number => {
    const x = u - 0.5;
    const y = v - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    let sum = 0;
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const mx = x0 + i;
        const my = y0 + j;
        if (mx < 0 || my < 0 || mx >= box.w || my >= box.h) continue;
        sum += (i ? tx : 1 - tx) * (j ? ty : 1 - ty) * fill[my * box.w + mx]!;
      }
    }
    return sum;
  };
  for (let y = Math.floor(e.y - halfH); y <= Math.ceil(e.y + halfH); y++) {
    for (let x = Math.floor(e.x - halfW); x <= Math.ceil(e.x + halfW); x++) {
      if (x < 0 || y < 0 || x >= out.width || y >= out.height) continue;
      // a squashed eye shows several rows of the original in one pixel, so average them
      let cover = 0;
      for (let s = 0; s < rows; s++) {
        const u = (x + 0.5 - e.x) / kx + (e.x - box.x);
        const v = (y + (s + 0.5) / rows - e.y) / k + (e.y - box.y);
        cover += maskAt(u, v);
      }
      cover /= rows;
      if (cover <= 0.004) continue;
      const p = (y * out.width + x) * 4;
      const under = out.data[p + 3]! / 255;
      const a = cover + under * (1 - cover);
      out.data[p] = (color[0] * cover + out.data[p]! * under * (1 - cover)) / a;
      out.data[p + 1] = (color[1] * cover + out.data[p + 1]! * under * (1 - cover)) / a;
      out.data[p + 2] = (color[2] * cover + out.data[p + 2]! * under * (1 - cover)) / a;
      out.data[p + 3] = a * 255;
    }
  }
}

function render(src: Raster, wiped: Raster, rig: Rig, pose: Pose): Raster {
  const { width: w, height: h } = src;
  const out = createRaster(w, h);
  const { ears, tail, blades } = rig;
  const earLen = ears ? ears.base - ears.top : 1;
  // with the eyes wiped, the squashed eyes are drawn on top afterwards
  const from = pose.blink > 0 ? wiped.data : src.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = x + 0.5;
      let sy = y + 0.5;

      if (ears && pose.ear !== 0 && sy < ears.base) {
        // the whole ear band leans as one, more the further from the head
        const u = Math.min(1.2, (ears.base - sy) / earLen);
        sx -= pose.ear * earLen * Math.pow(u, 1.6);
      }

      if (tail && pose.tail !== 0) {
        const wgt = 1 - smoothstep(tail.r * 1.0, tail.r * 1.9, Math.hypot(sx - tail.x, sy - tail.y));
        if (wgt > 0) {
          // content at this point swung around the hanging point; look where it came from
          const a = -pose.tail * wgt;
          const px = sx - tail.ax;
          const py = sy - tail.ay;
          const c = Math.cos(a);
          const s = Math.sin(a);
          sx = tail.ax + px * c - py * s;
          sy = tail.ay + px * s + py * c;
        }
      }

      if (blades && pose.blades !== 1) {
        const v = smoothstep(blades.top - 2, blades.top + 4, sy) * (1 - smoothstep(blades.bottom - 4, blades.bottom + 2, sy));
        if (v > 0) sx = blades.cx + (sx - blades.cx) / (1 - (1 - pose.blades) * v);
      }

      const o = (y * w + x) * 4;
      if (sx === x + 0.5 && sy === y + 0.5) {
        out.data[o] = from[o]!;
        out.data[o + 1] = from[o + 1]!;
        out.data[o + 2] = from[o + 2]!;
        out.data[o + 3] = from[o + 3]!;
      } else {
        sample(from, w, h, sx, sy, out.data, o);
      }
    }
  }
  if (pose.blink > 0) for (const e of rig.eyes) drawEye(out, e, pose.blink);
  return out;
}

function shiftRig(rig: Partial<Rig>, pad: number): Partial<Rig> {
  const out: Partial<Rig> = {};
  if ('ears' in rig) out.ears = rig.ears ? { top: rig.ears.top + pad, base: rig.ears.base + pad } : null;
  if ('eyes' in rig) out.eyes = (rig.eyes ?? []).map((e) => ({ ...e, x: e.x + pad, y: e.y + pad, box: e.box ? { ...e.box, x: e.box.x + pad, y: e.box.y + pad } : undefined }));
  if ('tail' in rig) out.tail = rig.tail ? { ...rig.tail, x: rig.tail.x + pad, y: rig.tail.y + pad, ax: rig.tail.ax + pad, ay: rig.tail.ay + pad } : null;
  if ('blades' in rig) out.blades = rig.blades ? { cx: rig.blades.cx + pad, top: rig.blades.top + pad, bottom: rig.blades.bottom + pad } : null;
  return out;
}

/**
 * Turns a still image into an animation. The frames are padded (the swaying parts need room); a frame that
 * looks like the rest pose is the original pixels untouched. Returns null when the preset finds nothing to move.
 */
export function animate(src: Raster, spec: AnimSpec): Animated | null {
  const pad = Math.ceil(0.08 * Math.max(src.width, src.height));
  const padded = padRaster(src, pad);
  const rig: Rig = { ...detectRig(padded), ...shiftRig(spec.rig ?? {}, pad) };
  const keys = timeline(spec, rig);
  if (!keys) return null;
  const wiped = withoutEyes(padded, rig.eyes);
  const cache = new Map<string, Raster>();
  const frames = keys.map(({ pose }) => {
    const id = poseKey(pose);
    let frame = cache.get(id);
    if (!frame) {
      frame = id === poseKey(REST) ? padded : render(padded, wiped, rig, pose);
      cache.set(id, frame);
    }
    return frame;
  });
  return { frames, durations: keys.map((k) => k.ms), rig };
}
