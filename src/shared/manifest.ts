import { DEFAULT_CONFIG, PET_STATES, type PetState, type Rect } from '../engine/types.ts';

/** A pose stored as a sprite sheet: frames laid out left to right, top to bottom. */
export interface SheetPose {
  sheet: string;
  frameWidth: number;
  frameHeight: number;
  count: number;
  /** ms per frame: one value for all frames, or one per frame */
  durations?: number | number[];
}

/** A single image file (png, svg, gif, apng, webp) or a sprite sheet. */
export type PoseSource = string | SheetPose;

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
  poses: Record<string, PoseSource>;
  /** optional state -> pose name overrides */
  states?: Partial<Record<PetState, string>>;
  /** states whose artwork already moves: the engine's hop and squash is skipped for them */
  motion?: Partial<Record<PetState, 'auto' | 'off'>>;
}

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

function parsePose(v: unknown): PoseSource | null {
  if (typeof v === 'string') return v || null;
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.sheet !== 'string' || !o.sheet) return null;
  const frameWidth = Math.round(num(o.frameWidth, 0, 0, 4096));
  const frameHeight = Math.round(num(o.frameHeight, 0, 0, 4096));
  const count = Math.round(num(o.count, 0, 0, 512));
  if (frameWidth < 1 || frameHeight < 1 || count < 1) return null;
  const pose: SheetPose = { sheet: o.sheet, frameWidth, frameHeight, count };
  if (typeof o.durations === 'number') pose.durations = num(o.durations, 100, 10, 10_000);
  else if (Array.isArray(o.durations)) pose.durations = o.durations.slice(0, count).map((d) => num(d, 100, 10, 10_000));
  return pose;
}

/** Validates a parsed manifest.json and fills in defaults. Malformed pose entries are dropped. */
export function parseManifest(raw: unknown, id: string): SkinManifest {
  if (!raw || typeof raw !== 'object') throw new Error(`skin "${id}": manifest.json must be an object`);
  const m = raw as Record<string, any>;
  if (!m.poses || typeof m.poses !== 'object') throw new Error(`skin "${id}": "poses" is missing`);
  const poses: Record<string, PoseSource> = {};
  for (const [name, value] of Object.entries(m.poses)) {
    const pose = parsePose(value);
    if (pose) poses[name] = pose;
  }
  if (!poses.idle) throw new Error(`skin "${id}": "poses.idle" is required`);

  const states: Partial<Record<PetState, string>> = {};
  const motion: Partial<Record<PetState, 'auto' | 'off'>> = {};
  for (const s of PET_STATES) {
    const st = m.states?.[s];
    if (typeof st === 'string' && st) states[s] = st;
    const mo = m.motion?.[s];
    if (mo === 'off' || mo === 'auto') motion[s] = mo;
  }

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
    states,
    motion,
  };
}

/** Every image file the manifest refers to. */
export function poseFiles(manifest: SkinManifest): string[] {
  const files = new Set<string>();
  for (const p of Object.values(manifest.poses)) files.add(typeof p === 'string' ? p : p.sheet);
  return [...files];
}
