import { ACTION_MS } from '../engine/actions';
import { PET_STATES, type ActionMotion, type PoseState, type Rect } from '../engine/types';
import type { PoseSource, SkinManifest } from '../shared/manifest';
import { animate, type AnimSpec } from './animate';
import {
  alphaBounds,
  buildSheet,
  composeBottomCenter,
  crop,
  decimateFrames,
  flipHorizontal,
  removeBackground,
  resizeArea,
  unionRect,
  type BgOptions,
  type Raster,
} from './process';

/**
 * Pictures for the pet's tricks: a skin made here may have up to this many, each saved as a pose of its own and
 * listed as an action in the manifest.
 */
export const TRICK_POSES = ['trick1', 'trick2', 'trick3', 'trick4'] as const;

/** Every pose name the maker knows: the states of the pet and the tricks. */
export const POSE_NAMES: readonly string[] = [...PET_STATES, ...TRICK_POSES];

/** One imported image (or animation) and how it should be used. */
export interface ItemInput {
  pose: string;
  frames: Raster[];
  /** ms per frame */
  durations: number[];
  /** null keeps the image as it is */
  bg: BgOptions | null;
  /** size multiplier relative to the other poses; 1 = as imported */
  scale: number;
  /** animated artwork: skip the engine's hop and squash for this pose */
  motionOff: boolean;
  /** mirror the image, for artwork that faces the other way from the rest of the skin */
  flip?: boolean;
  /** make a still image move (blinking, swaying ears and tail); ignored for images that already move */
  anim?: AnimSpec;
}

export interface BuiltPose {
  pose: string;
  frames: Raster[];
  durations: number[];
  motionOff: boolean;
}

export interface BuiltSkin {
  /** every frame of every pose has exactly this size */
  width: number;
  height: number;
  poses: BuiltPose[];
  /** idle body area and feet point, as fractions of the canvas */
  hitbox: Rect;
  anchor: { x: number; y: number };
}

export interface BuildOptions {
  /** longest side of the shared canvas in px */
  maxSide?: number;
  /** transparent rows kept under the feet */
  bottomPad?: number;
  maxFrames?: number;
}

/** An item after background removal and trimming, ready to be laid out. */
export interface Prepared {
  item: ItemInput;
  frames: Raster[];
  durations: number[];
  w: number;
  h: number;
  /** what the animation found to move; null when one was asked for and nothing was found, absent otherwise */
  moves?: { eyes: number; ears: boolean; tail: boolean } | null;
}

/**
 * Background removal and trimming of one item. This is the slow part for long animations, so callers
 * that re-run the layout often (the maker's live preview) cache its result per item.
 */
export function prepareItem(item: ItemInput, maxFrames = 48): Prepared | null {
  if (item.frames.length === 0) return null;
  const kept = decimateFrames(item.frames, item.durations, maxFrames);
  const cleaned = item.bg ? kept.frames.map((f) => removeBackground(f, item.bg!)) : kept.frames;
  let frames = cleaned;
  let durations = kept.durations;
  let moves: Prepared['moves'];
  if (item.anim && cleaned.length === 1) {
    const moving = animate(cleaned[0]!, item.anim);
    moves = moving ? { eyes: moving.rig.eyes.length, ears: !!moving.rig.ears, tail: !!moving.rig.tail } : null;
    if (moving) {
      frames = moving.frames;
      durations = moving.durations;
    }
  }
  // one box for all frames, so an animation does not jitter against itself
  let box: Rect | null = null;
  for (const f of frames) box = unionRect(box, alphaBounds(f));
  if (!box) return null;
  const trimmed = frames.map((f) => crop(f, box!));
  return { item, frames: item.flip ? trimmed.map(flipHorizontal) : trimmed, durations, w: box.w, h: box.h, moves };
}

/**
 * Copies of the same artwork often come in different pixel sizes (a small GIF next to large stills). Canvases of the
 * same shape (aspect ratio within 3 %) are taken to be such copies, so each is sized to the largest one; a canvas of
 * another shape keeps its own size. Returns one size multiplier per canvas.
 */
export function matchSizes(canvases: { w: number; h: number }[]): number[] {
  const longest = (c: { w: number; h: number }): number => Math.max(c.w, c.h);
  let ref: { w: number; h: number } | null = null;
  for (const c of canvases) if (!ref || longest(c) > longest(ref)) ref = c;
  if (!ref) return [];
  const aspect = ref.w / ref.h;
  return canvases.map((c) => (Math.abs(c.w / c.h / aspect - 1) <= 0.03 ? longest(ref!) / longest(c) : 1));
}

/** The first item of each pose wins. */
const firstPerPose = <T extends { pose: string }>(list: T[]): T[] => {
  const seen = new Set<string>();
  return list.filter((it) => !seen.has(it.pose) && !!seen.add(it.pose));
};

/** Cleans, trims and aligns the items on one shared canvas. See `layoutSkin`. */
export function buildSkin(items: ItemInput[], opts: BuildOptions = {}): BuiltSkin {
  const prepared = firstPerPose(items)
    .map((item) => prepareItem(item, opts.maxFrames ?? 48))
    .filter((p): p is Prepared => p !== null);
  return layoutSkin(prepared, opts);
}

/**
 * Scales and aligns prepared items on one shared canvas (bottom-centred), so that switching between
 * poses never changes the character's size or lifts its feet.
 */
export function layoutSkin(all: Prepared[], opts: BuildOptions = {}): BuiltSkin {
  const maxSide = opts.maxSide ?? 320;
  const bottomPad = opts.bottomPad ?? 3;

  const prepared = firstPerPose(all.map((p) => ({ ...p, pose: p.item.pose })));
  if (prepared.length === 0) throw new Error('no visible image to build a skin from');
  if (!prepared.some((p) => p.item.pose === 'idle')) throw new Error('an "idle" pose is required');

  const longest = Math.max(...prepared.map((p) => Math.max(p.w, p.h) * p.item.scale));
  const biggest = Math.max(...prepared.map((p) => p.item.scale));
  // never enlarge: the factor that fits the canvas, and the one that keeps the largest item at its native size
  const global = Math.min(1 / biggest, maxSide / longest);

  const scaled = prepared.map((p) => {
    const f = global * p.item.scale;
    const w = Math.max(1, Math.round(p.w * f));
    const h = Math.max(1, Math.round(p.h * f));
    return { ...p, frames: p.frames.map((fr) => resizeArea(fr, w, h)), w, h };
  });
  const width = Math.max(...scaled.map((p) => p.w));
  const height = Math.max(...scaled.map((p) => p.h)) + bottomPad;

  const poses: BuiltPose[] = POSE_NAMES.flatMap((state) => {
    const p = scaled.find((s) => s.item.pose === state);
    if (!p) return [];
    return [
      {
        pose: state,
        frames: p.frames.map((fr) => composeBottomCenter(fr, width, height, bottomPad)),
        durations: p.durations,
        motionOff: p.item.motionOff,
      },
    ];
  });

  const idleBox = alphaBounds(poses.find((p) => p.pose === 'idle')!.frames[0]!) ?? { x: 0, y: 0, w: width, h: height };
  return {
    width,
    height,
    poses,
    hitbox: { x: idleBox.x / width, y: idleBox.y / height, w: idleBox.w / width, h: idleBox.h / height },
    anchor: { x: 0.5, y: (height - bottomPad) / height },
  };
}

export interface SkinMeta {
  name: string;
  facing: 'left' | 'right';
  /** sprite box height in px at scale 1 */
  boxHeight?: number;
}

export interface SkinImage {
  name: string;
  raster: Raster;
}

/** What the maker writes for each trick: a manifest `actions` entry, left to its defaults where it can be. */
export interface TrickAction {
  pose: string;
  ms: number;
  motion: ActionMotion;
}

export interface SkinAssets {
  manifest: Omit<SkinManifest, 'actions'> & { actions?: Record<string, TrickAction> };
  images: SkinImage[];
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/** The manifest's size, anchor and hitbox for a built skin. */
export function skinGeometry(
  built: BuiltSkin,
  boxHeight = 128,
): { size: { w: number; h: number }; anchor: { x: number; y: number }; hitbox: Rect } {
  return {
    size: { w: Math.min(1024, Math.max(16, Math.round((boxHeight * built.width) / built.height))), h: boxHeight },
    anchor: { x: round4(built.anchor.x), y: round4(built.anchor.y) },
    hitbox: {
      x: round4(built.hitbox.x),
      y: round4(built.hitbox.y),
      w: round4(built.hitbox.w),
      h: round4(built.hitbox.h),
    },
  };
}

/**
 * The tricks of a built skin as actions: a picture that moves is shown for a couple of rounds of it and left to move
 * by itself; a still picture hops for a moment.
 */
export function trickActions(built: BuiltSkin): Record<string, TrickAction> {
  const out: Record<string, TrickAction> = {};
  for (const p of built.poses) {
    if (!(TRICK_POSES as readonly string[]).includes(p.pose)) continue;
    const moving = p.frames.length > 1;
    const round = p.durations.reduce((sum, d) => sum + d, 0);
    const ms = moving && round > 0 ? Math.min(6000, Math.max(ACTION_MS.fallback, Math.ceil(2200 / round) * round)) : ACTION_MS.fallback;
    out[p.pose] = { pose: p.pose, ms: Math.round(ms), motion: moving ? 'off' : 'bounce' };
  }
  return out;
}

/** Turns a built skin into manifest.json content plus the images to write (a PNG per pose, sheets for animations). */
export function assembleSkin(built: BuiltSkin, meta: SkinMeta): SkinAssets {
  const images: SkinImage[] = [];
  const poses: Record<string, PoseSource> = {};
  const motion: Partial<Record<PoseState, 'off'>> = {};
  const isState = (name: string): name is PoseState => (PET_STATES as readonly string[]).includes(name);

  for (const p of built.poses) {
    const file = `${p.pose}.png`;
    if (p.frames.length === 1) {
      images.push({ name: file, raster: p.frames[0]! });
      poses[p.pose] = file;
      continue;
    }
    const columns = Math.max(1, Math.min(p.frames.length, Math.floor(4096 / built.width)));
    images.push({ name: file, raster: buildSheet(p.frames, columns) });
    const same = p.durations.every((d) => d === p.durations[0]);
    poses[p.pose] = {
      sheet: file,
      frameWidth: built.width,
      frameHeight: built.height,
      count: p.frames.length,
      durations: same ? p.durations[0]! : p.durations,
    };
    if (p.motionOff && isState(p.pose)) motion[p.pose] = 'off';
  }

  const actions = trickActions(built);
  const manifest: SkinAssets['manifest'] = {
    name: meta.name,
    ...skinGeometry(built, meta.boxHeight),
    facing: meta.facing,
    poses,
    ...(Object.keys(motion).length ? { motion } : {}),
    ...(Object.keys(actions).length ? { actions } : {}),
  };
  return { manifest, images };
}
