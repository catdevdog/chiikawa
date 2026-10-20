import type { Actions, Lines, PetState, Rect } from '../engine/types';
import { isSkinId } from '../shared/ids';
import { parseManifest, type PoseSource, type SheetPose } from '../shared/manifest';
import type { HangLayout, PeekLayout } from '../engine/peek';
import { measureBody, measureHang, measurePeek } from './measure';
import { resolvePose } from './poses';

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
  /** how big the character looks (see `measureBody`), when its picture could be measured */
  body?: number;
  /** how the skin's own picture for hiding meets the wall (see `measurePeek`); none when it has no such picture */
  peek?: PeekLayout;
  /** how the skin's own picture for looking over the top of a window stands on the edge (see `measureHang`); none when it has no such picture */
  hang?: HangLayout;
  /** 1 if the artwork faces right, -1 if it faces left */
  artFacing: 1 | -1;
  /** the picture for a state; while it is acting, the pose of the action (`action`) when the skin has it */
  spriteFor(state: PetState, action?: string | null): Sprite;
  /** true when the artwork animates itself, so the engine's hop and squash should be skipped */
  motionOff(state: PetState): boolean;
  /** what the pet says, by situation */
  lines: Lines;
  /** what the pet does now and then, with pictures of its own */
  actions: Actions;
  /** colour of the words above the pet */
  textColor: string;
}

/** The colour of spoken words when a skin does not choose one. */
export const DEFAULT_TEXT_COLOR = '#4d5a8f';

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
    Object.entries(manifest.poses).map(async ([pose, source]) => [pose, await loadPose(dir, source, size)] as const),
  );
  const sprites = new Map(entries);
  const available = new Set(sprites.keys());
  const idle = sprites.get(resolvePose('idle', available, manifest.states));
  const body = idle ? measureBody(idle.frameAt(0), size) : null;
  const artFacing: 1 | -1 = manifest.facing === 'left' ? -1 : 1;
  const box = { w: size.w, h: size.h, anchorX: manifest.anchor!.x, anchorY: manifest.anchor!.y };
  // a skin that has a picture of its own for hiding says (by measuring it) how it meets the wall
  const own = sprites.get(manifest.states?.peek && available.has(manifest.states.peek) ? manifest.states.peek : 'peek');
  const peek = own ? measurePeek(own.frameAt(0), box, artFacing) : null;
  const ownHang = sprites.get(manifest.states?.hang && available.has(manifest.states.hang) ? manifest.states.hang : 'hang');
  const hang = ownHang ? measureHang(ownHang.frameAt(0), box) : null;
  return {
    id,
    name: manifest.name ?? id,
    box,
    hitbox: manifest.hitbox!,
    ...(body === null ? {} : { body }),
    ...(peek === null ? {} : { peek }),
    ...(hang === null ? {} : { hang }),
    artFacing,
    spriteFor: (state, action) => (action ? sprites.get(action) : undefined) ?? sprites.get(resolvePose(state, available, manifest.states))!,
    motionOff: (state) => state !== 'act' && manifest.motion?.[state] === 'off',
    lines: manifest.lines ?? {},
    actions: manifest.actions ?? {},
    textColor: manifest.textColor ?? DEFAULT_TEXT_COLOR,
  };
}

function loadPose(dir: string, source: PoseSource, size: { w: number; h: number }): Promise<Sprite> {
  if (typeof source === 'string') return loadSprite(resolveInside(dir, source), size);
  return loadSheet(resolveInside(dir, source.sheet), source);
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

/** Slices a sprite sheet into one bitmap per frame. */
async function loadSheet(url: string, pose: SheetPose): Promise<Sprite> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const sheet = await createImageBitmap(await res.blob());
  try {
    const { frameWidth: fw, frameHeight: fh, count } = pose;
    const columns = Math.max(1, Math.floor(sheet.width / fw));
    if (Math.ceil(count / columns) * fh > sheet.height) {
      throw new Error(`sprite sheet ${pose.sheet} is too small for ${count} frames of ${fw}x${fh}`);
    }
    const frames: Frame[] = [];
    for (let i = 0; i < count; i++) {
      const image = await createImageBitmap(sheet, (i % columns) * fw, Math.floor(i / columns) * fh, fw, fh);
      frames.push({ image, width: fw, height: fh });
    }
    const durations = Array.from({ length: count }, (_, i) =>
      typeof pose.durations === 'number' ? pose.durations : (pose.durations?.[i] ?? 100),
    );
    return new Sprite(frames, count === 1 ? [Infinity] : durations);
  } finally {
    sheet.close();
  }
}
