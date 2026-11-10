import { clamp } from '../engine/vec';
import type { Rect, Vec2 } from '../engine/types';
import { isSkinId } from './ids';
import { parsePose, type PoseSource } from './manifest';
import { parseNames, type Lang } from './skin-name';
import type { Area } from './types';

/**
 * scene.json of a scene folder: a short show that the characters act in, played over the desktop with a sound. The picture is
 * a video (with transparency: WebM) or pictures like the poses of a skin (an animated image, or a sprite sheet), and the sound
 * is a file of its own or the sound of the video. Only the picture is required.
 */
export interface SceneManifest {
  name?: string;
  /** the name in other languages, shown in the menu when the app speaks that language: `{ "ko": "공연" }` */
  names?: Partial<Record<Lang, string>>;
  /** the picture as a video; it plays its own sound unless `audio` names one */
  video?: string;
  /** the picture as pictures (a still, an animated image, or a sprite sheet), used when there is no `video` */
  picture?: PoseSource;
  /** the sound, a file next to the manifest */
  audio?: string;
  /** how big the picture is at normal size (px); it is fitted into this, bottom-centred */
  size: { w: number; h: number };
  /** where the feet are inside it, as fractions: it stands on the floor there */
  anchor: { x: number; y: number };
  /** the part of it that a click stops the show at, as fractions of the size */
  hitbox: Rect;
  /** the characters (skin ids) that act in it: while it plays, their pets are not on the screen */
  cast: string[];
  /** how many ms after the picture the sound starts (negative: before it) */
  offsetMs: number;
  /** how loud it is made compared with the volume that is chosen, from 0 to 1 */
  volume: number;
  /** the longest it may take (ms); the stage gives up on a show that has not ended by then */
  maxMs: number;
}

export const SCENE_DEFAULTS = {
  size: { w: 640, h: 360 },
  anchor: { x: 0.5, y: 0.95 },
  hitbox: { x: 0.15, y: 0.05, w: 0.7, h: 0.9 },
  maxMs: 10 * 60_000,
} as const;

/** The most characters a scene names. */
export const MAX_CAST = 8;

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** A file of the scene folder: a plain relative path that stays inside it. */
export const isSceneFile = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[\\\0:]/.test(v) && !v.startsWith('/') && !v.split('/').some((p) => p === '..' || p === '');

/** Scene ids are folder names, like skin ids. */
export const isSceneId = isSkinId;

/** Validates a parsed scene.json and fills in defaults; one that shows nothing is refused. */
export function parseSceneManifest(raw: unknown, id: string): SceneManifest {
  if (!raw || typeof raw !== 'object') throw new Error(`scene "${id}": scene.json must be an object`);
  const m = raw as Record<string, any>;
  const video = isSceneFile(m.video) ? m.video : undefined;
  const picture = video ? undefined : (parsePose(m.picture) ?? undefined);
  if (!video && !picture) throw new Error(`scene "${id}": "video" or "picture" is required`);
  if (typeof picture === 'string' ? !isSceneFile(picture) : picture !== undefined && !isSceneFile(picture.sheet)) {
    throw new Error(`scene "${id}": "picture" must be a file inside the scene folder`);
  }
  const d = SCENE_DEFAULTS;
  const cast: string[] = [];
  if (Array.isArray(m.cast)) for (const c of m.cast) if (isSkinId(c) && !cast.includes(c) && cast.length < MAX_CAST) cast.push(c);
  return {
    ...(typeof m.name === 'string' ? { name: m.name } : {}),
    names: parseNames(m.names),
    ...(video ? { video } : {}),
    ...(picture ? { picture } : {}),
    ...(isSceneFile(m.audio) ? { audio: m.audio } : {}),
    size: { w: num(m.size?.w, d.size.w, 16, 4096), h: num(m.size?.h, d.size.h, 16, 4096) },
    anchor: { x: num(m.anchor?.x, d.anchor.x, 0, 1), y: num(m.anchor?.y, d.anchor.y, 0, 1) },
    hitbox: {
      x: num(m.hitbox?.x, d.hitbox.x, 0, 1),
      y: num(m.hitbox?.y, d.hitbox.y, 0, 1),
      w: num(m.hitbox?.w, d.hitbox.w, 0.05, 1),
      h: num(m.hitbox?.h, d.hitbox.h, 0.05, 1),
    },
    cast,
    offsetMs: num(m.offsetMs, 0, -10_000, 10_000),
    volume: num(m.volume, 1, 0, 1),
    maxMs: num(m.maxMs, d.maxMs, 1000, 60 * 60_000),
  };
}

/** Every file of the scene folder that the manifest refers to. */
export function sceneFiles(manifest: SceneManifest): string[] {
  const files = new Set<string>();
  if (manifest.video) files.add(manifest.video);
  if (manifest.picture) files.add(typeof manifest.picture === 'string' ? manifest.picture : manifest.picture.sheet);
  if (manifest.audio) files.add(manifest.audio);
  return [...files];
}

/**
 * Where the picture of a scene goes: its feet (`anchor`, a point inside it) on `feet`, as big as `scale` makes it, and
 * kept inside `area` (the window that shows it). One that is bigger than the area is made smaller, in proportion.
 */
export function placeScene(feet: Vec2, size: { w: number; h: number }, anchor: { x: number; y: number }, scale: number, area: Area): Area {
  const fit = Math.min(1, area.width / (size.w * scale), area.height / (size.h * scale));
  const s = scale * fit;
  const width = size.w * s;
  const height = size.h * s;
  return {
    x: clamp(feet.x - anchor.x * width, area.x, area.x + area.width - width),
    y: clamp(feet.y - anchor.y * height, area.y, area.y + area.height - height),
    width,
    height,
  };
}

/** Is the point on the part of the picture that a click stops the show at? */
export function onScene(rect: Area, hitbox: Rect, p: Vec2): boolean {
  const x = rect.x + hitbox.x * rect.width;
  const y = rect.y + hitbox.y * rect.height;
  return p.x >= x && p.x < x + hitbox.w * rect.width && p.y >= y && p.y < y + hitbox.h * rect.height;
}

/** A drift of the picture from the sound below this (ms) is left alone: nobody can tell. */
export const SYNC_TOLERANCE_MS = 40;
/** From this much (ms) the picture jumps to where the sound is; between the two it is sped up or slowed down a little. */
export const SYNC_SEEK_MS = 120;

/**
 * What to do about a picture that has drifted from the sound, which is the clock (`driftMs` is how far ahead of it the
 * picture is: negative when it is late). A small drift is run off by playing a little slower or faster, a large one by
 * jumping.
 */
export function syncCorrection(driftMs: number): { seek: boolean; rate: number } {
  const d = Math.abs(driftMs);
  if (!(d > SYNC_TOLERANCE_MS)) return { seek: false, rate: 1 };
  if (d >= SYNC_SEEK_MS) return { seek: true, rate: 1 };
  return { seek: false, rate: driftMs > 0 ? 0.96 : 1.04 };
}

/** What the main process tells an overlay about a scene. `run` tells one showing from the next. */
export type SceneCommand =
  | { kind: 'start'; run: number; id: string; manifest: SceneManifest; rect: Area; volume: number }
  | { kind: 'stop'; run: number }
  | { kind: 'volume'; run: number; volume: number };

/** What an overlay tells the main process about the scene it was given: it plays now, it is over, or it could not be played. */
export interface SceneStateReport {
  run: number;
  state: 'playing' | 'ended' | 'failed';
  message?: string;
}

/** A scene on offer, for the tray. */
export interface SceneInfo {
  id: string;
  name: string;
}
