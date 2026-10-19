import type { Area } from './types';

/** One monitor, as far as the pet cares. Coordinates are in the shared space (device-independent pixels). */
export interface DisplayInfo {
  id: number;
  label: string;
  primary: boolean;
  /** the monitor without the taskbar: where the pet may be */
  workArea: Area;
  /** the whole monitor */
  bounds: Area;
  scaleFactor: number;
}

export const MONITOR_ALL = 'all';
export const MONITOR_PRIMARY = 'primary';

/** "all", "primary", or the numeric id of one monitor. */
export const isMonitorChoice = (v: unknown): v is string =>
  typeof v === 'string' && (v === MONITOR_ALL || v === MONITOR_PRIMARY || /^\d{1,15}$/.test(v));

const usable = (a: Area): boolean =>
  [a.x, a.y, a.width, a.height].every((n) => Number.isFinite(n)) && a.width > 0 && a.height > 0;

/**
 * The monitors the pet lives on for a setting, the primary one first and the rest from left to right.
 * A monitor that is chosen but not connected (any more) counts as the primary one, so the pet is never homeless.
 */
export function chooseDisplays(all: readonly DisplayInfo[], choice: string): DisplayInfo[] {
  const shown = all.filter((d) => usable(d.workArea));
  if (shown.length === 0) return [];
  const primary = shown.find((d) => d.primary) ?? shown[0]!;
  if (choice === MONITOR_ALL) {
    const rest = shown.filter((d) => d !== primary).sort((a, b) => a.workArea.x - b.workArea.x || a.workArea.y - b.workArea.y);
    return [primary, ...rest];
  }
  if (choice === MONITOR_PRIMARY) return [primary];
  return [shown.find((d) => String(d.id) === choice) ?? primary];
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * A made-up set of monitors for tests: a JSON array of `{ id, x, y, width, height, primary?, work?: {x,y,width,height} }`.
 * Returns null for anything that is not one.
 */
export function parseFakeDisplays(raw: unknown): DisplayInfo[] | null {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list) || list.length === 0 || list.length > 8) return null;
  const out: DisplayInfo[] = [];
  for (const [i, item] of list.entries()) {
    if (!item || typeof item !== 'object') return null;
    const r = item as Record<string, unknown>;
    const [x, y, width, height] = [num(r.x), num(r.y), num(r.width), num(r.height)];
    if (x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0) return null;
    const bounds: Area = { x, y, width, height };
    const w = r.work && typeof r.work === 'object' ? (r.work as Record<string, unknown>) : null;
    const workArea: Area = w
      ? { x: num(w.x) ?? x, y: num(w.y) ?? y, width: num(w.width) ?? width, height: num(w.height) ?? height }
      : { ...bounds };
    out.push({
      id: num(r.id) ?? i + 1,
      label: typeof r.label === 'string' ? r.label : '',
      primary: r.primary === true,
      workArea,
      bounds,
      scaleFactor: num(r.scaleFactor) ?? 1,
    });
  }
  if (!out.some((d) => d.primary)) out[0]!.primary = true;
  return out;
}
