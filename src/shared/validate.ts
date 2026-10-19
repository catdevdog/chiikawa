import type { PointerReport, SkinGeometry } from './types';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const within = (v: unknown, lo: number, hi: number): number | null => (finite(v) ? Math.min(hi, Math.max(lo, v)) : null);

/** A skin's sprite box and hitbox as an overlay reports them. Out-of-range numbers are pulled in, anything else is refused. */
export function parseGeometry(raw: unknown): SkinGeometry | null {
  if (!raw || typeof raw !== 'object') return null;
  const { box, hitbox } = raw as Record<string, any>;
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
  return { box: { w: w!, h: h!, anchorX: anchorX!, anchorY: anchorY! }, hitbox: { x: x!, y: y!, w: hw!, h: hh! } };
}

/** A mouse button going down or up in an overlay. */
export function parsePointer(raw: unknown): PointerReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const { kind, x, y } = raw as Record<string, unknown>;
  if ((kind !== 'down' && kind !== 'up') || !finite(x) || !finite(y)) return null;
  return { kind, x, y };
}
