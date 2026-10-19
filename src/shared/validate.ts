import { parseActions } from '../engine/actions';
import { parseLines } from '../engine/speech';
import type { Battery } from './power';
import type { PointerReport, SkinReport } from './types';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const within = (v: unknown, lo: number, hi: number): number | null => (finite(v) ? Math.min(hi, Math.max(lo, v)) : null);

/**
 * A skin as an overlay reports it: sprite box, hitbox and lines. Out-of-range numbers are pulled in and bad lines
 * dropped; a report without proper numbers is refused.
 */
export function parseSkinReport(raw: unknown): SkinReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const { box, hitbox, lines, actions } = raw as Record<string, any>;
  if (!box || typeof box !== 'object' || !hitbox || typeof hitbox !== 'object') return null;
  const nums = [
    within(box.w, 16, 1024),
    within(box.h, 16, 1024),
    within(box.anchorX, 0, 1),
    within(box.anchorY, 0, 1),
    within(hitbox.x, 0, 1),
    within(hitbox.y, 0, 1),
    within(hitbox.w, 0.05, 1),
    within(hitbox.h, 0.05, 1),
  ];
  if (nums.some((n) => n === null)) return null;
  const [w, h, anchorX, anchorY, x, y, hw, hh] = nums as number[];
  return { box: { w: w!, h: h!, anchorX: anchorX!, anchorY: anchorY! }, hitbox: { x: x!, y: y!, w: hw!, h: hh! }, lines: parseLines(lines), actions: parseActions(actions) };
}

/** A mouse button going down or up in an overlay. */
export function parsePointer(raw: unknown): PointerReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const { kind, x, y } = raw as Record<string, unknown>;
  if ((kind !== 'down' && kind !== 'up') || !finite(x) || !finite(y)) return null;
  return { kind, x, y };
}

/** The battery as an overlay reports it (`navigator.getBattery()`): a charge from 0 to 1 and whether it is charging. */
export function parseBattery(raw: unknown): Battery | null {
  if (!raw || typeof raw !== 'object') return null;
  const { level, charging } = raw as Record<string, unknown>;
  if (!finite(level) || typeof charging !== 'boolean') return null;
  return { level: Math.min(1, Math.max(0, level)), charging };
}
