import { parseLineList } from './speech';
import { ACTION_MOTIONS, ACTION_TRIGGERS, type ActionDef, type ActionMotion, type ActionTrigger, type Actions } from './types';

export const MAX_ACTIONS = 16;
export const ACTION_MS = { min: 800, max: 20_000, fallback: 2600 };
const NAME = /^[A-Za-z][\w-]{0,23}$/;

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/**
 * The `actions` of a skin manifest:
 * `{ "camera": { "pose": "camera", "ms": 3600, "motion": "still", "on": ["welcome"], "say": ["찰칵!"] } }`.
 * `poses` (when given) says which poses the skin has and whether each one moves by itself: an action whose pose is
 * missing is dropped, and a picture that moves by itself is left alone by the engine unless the action says otherwise.
 * Anything malformed is dropped.
 */
export function parseActions(raw: unknown, poses?: ReadonlyMap<string, boolean>): Actions {
  const out: Actions = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_ACTIONS) break;
    if (!NAME.test(name) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const v = value as Record<string, unknown>;
    const pose = typeof v.pose === 'string' && v.pose ? v.pose : name;
    if (poses && !poses.has(pose)) continue;
    const motion: ActionMotion = ACTION_MOTIONS.includes(v.motion as ActionMotion) ? (v.motion as ActionMotion) : poses?.get(pose) ? 'off' : 'bounce';
    const on = Array.isArray(v.on) ? ACTION_TRIGGERS.filter((t) => (v.on as unknown[]).includes(t)) : [];
    const def: ActionDef = {
      pose,
      ms: Math.round(clamp(v.ms, ACTION_MS.min, ACTION_MS.max, ACTION_MS.fallback)),
      weight: clamp(v.weight, 0.1, 10, 1),
      motion,
      on: on as ActionTrigger[],
      lines: parseLineList(v.say ?? v.lines),
    };
    out[name] = def;
  }
  return out;
}
