import { DEFAULT_CONFIG, type PetState, type Rect } from '../engine/types';
import { isSkinId } from '../shared/ids';
import { resolvePose } from './poses';

/** manifest.json of a skin pack. Only `poses.idle` is required. */
export interface SkinManifest {
  name?: string;
  /** sprite box in px at scale 1; every pose is fitted into it, bottom-centred */
  size?: { w: number; h: number };
  /** feet point inside the box, as fractions */
  anchor?: { x: number; y: number };
  /** body area inside the box, as fractions; drives clicking and screen-edge limits */
  hitbox?: Rect;
  /** direction the artwork faces; the pet is mirrored when it walks the other way */
  facing?: 'left' | 'right';
  /** pose name -> image file (png, svg, gif, apng, webp) */
  poses: Record<string, string>;
  /** optional state -> pose name overrides */
  states?: Partial<Record<PetState, string>>;
}

export interface Frame {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export class Sprite {
  private readonly ends: number[];
  private readonly total: number;

  constructor(
    readonly frames: Frame[],
    durations: number[],
  ) {
    let acc = 0;
    this.ends = durations.map((d) => (acc += d));
    this.total = acc;
  }

  frameAt(ms: number): Frame {
    if (this.frames.length === 1 || !Number.isFinite(this.total) || this.total <= 0) return this.frames[0]!;
    const t = ms % this.total;
    const i = this.ends.findIndex((end) => t < end);
    return this.frames[i < 0 ? 0 : i]!;
  }
}

export interface Skin {
  id: string;
  name: string;
  box: { w: number; h: number; anchorX: number; anchorY: number };
  hitbox: Rect;
  /** 1 if the artwork faces right, -1 if it faces left */
  artFacing: 1 | -1;
  spriteFor(state: PetState): Sprite;
}

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

function parseManifest(raw: unknown, id: string): SkinManifest {
  if (!raw || typeof raw !== 'object') throw new Error(`skin "${id}": manifest.json must be an object`);
  const m = raw as Record<string, any>;
  if (!m.poses || typeof m.poses !== 'object') throw new Error(`skin "${id}": "poses" is missing`);
  const poses: Record<string, string> = {};
  for (const [name, file] of Object.entries(m.poses)) {
    if (typeof file === 'string' && file) poses[name] = file;
  }
  if (!poses.idle) throw new Error(`skin "${id}": "poses.idle" is required`);
  const d = DEFAULT_CONFIG;
  return {
    name: typeof m.name === 'string' ? m.name : undefined,
    size: { w: num(m.size?.w, d.sprite.w, 16, 1024), h: num(m.size?.h, d.sprite.h, 16, 1024) },
    anchor: { x: num(m.anchor?.x, d.sprite.anchorX, 0, 1), y: num(m.anchor?.y, d.sprite.anchorY, 0, 1) },
    hitbox: {
      x: num(m.hitbox?.x, d.hitbox.x, 0, 1),
      y: num(m.hitbox?.y, d.hitbox.y, 0, 1),
      w: num(m.hitbox?.w, d.hitbox.w, 0.05, 1),
      h: num(m.hitbox?.h, d.hitbox.h, 0.05, 1),
    },
    facing: m.facing === 'left' ? 'left' : 'right',
    poses,
    states: typeof m.states === 'object' && m.states ? m.states : undefined,
  };
}

/** Pose files must stay inside the skin's own folder. */
function resolveInside(dir: string, file: string): string {
  const base = new URL(dir, location.href);
  const url = new URL(file, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error(`pose file escapes the skin folder: ${file}`);
  }
  return url.href;
}

export async function loadSkin(id: string, base = '/skins'): Promise<Skin> {
  if (!isSkinId(id)) throw new Error(`invalid skin id: ${id}`);
  const dir = `${base}/${id}/`;
  const res = await fetch(`${dir}manifest.json`);
  if (!res.ok) throw new Error(`skin "${id}": manifest.json not found (${res.status})`);
  const manifest = parseManifest(await res.json(), id);
  const size = manifest.size!;
  const entries = await Promise.all(
    Object.entries(manifest.poses).map(
      async ([pose, file]) => [pose, await loadSprite(resolveInside(dir, file), size)] as const,
    ),
  );
  const sprites = new Map(entries);
  const available = new Set(sprites.keys());
  return {
    id,
    name: manifest.name ?? id,
    box: { w: size.w, h: size.h, anchorX: manifest.anchor!.x, anchorY: manifest.anchor!.y },
    hitbox: manifest.hitbox!,
    artFacing: manifest.facing === 'left' ? -1 : 1,
    spriteFor: (state) => sprites.get(resolvePose(state, available, manifest.states))!,
  };
}

const RASTER_TYPES: Record<string, string> = {
  gif: 'image/gif',
  png: 'image/png',
  apng: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

async function loadSprite(url: string, size: { w: number; h: number }): Promise<Sprite> {
  const ext = new URL(url).pathname.split('.').pop()?.toLowerCase() ?? '';
  const type = RASTER_TYPES[ext];
  if (type && typeof ImageDecoder !== 'undefined') {
    try {
      return await decodeFrames(url, type);
    } catch (err) {
      console.warn(`ImageDecoder failed for ${url}, using <img> instead`, err);
    }
  }
  return loadImage(url, size);
}

/** Decodes every frame of animated GIF/APNG/WebP (and plain images) into bitmaps with proper alpha. */
async function decodeFrames(url: string, type: string): Promise<Sprite> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const decoder = new ImageDecoder({ data: await res.arrayBuffer(), type });
  try {
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
    const frames: Frame[] = [];
    const durations: number[] = [];
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      const bitmap = await createImageBitmap(image);
      // browsers treat 0/very short GIF delays as ~100ms; do the same
      durations.push(image.duration && image.duration >= 20_000 ? image.duration / 1000 : 100);
      frames.push({ image: bitmap, width: bitmap.width, height: bitmap.height });
      image.close();
    }
    return new Sprite(frames, count === 1 ? [Infinity] : durations);
  } finally {
    decoder.close();
  }
}

async function loadImage(url: string, size: { w: number; h: number }): Promise<Sprite> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  // an SVG without width/height reports 0; fall back to the box
  const width = img.naturalWidth || size.w;
  const height = img.naturalHeight || size.h;
  return new Sprite([{ image: img, width, height }], [Infinity]);
}
