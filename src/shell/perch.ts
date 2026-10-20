import type { Platform, Rect, Side } from '../engine/types';

/** A window of another program as the system reports it: its frame in pixels of the screen (not yet scaled to the shared coordinates). */
export interface RawWindow {
  /** names the window for as long as it exists */
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** the title bar's text, for the log and the checks (the pets do not need it) */
  title?: string;
}

/** Where the windows of other programs come from. The system's is Windows only; the end-to-end tests bring their own. */
export interface WindowSource {
  /** the windows a pet may stand on, the one in front first */
  list(): RawWindow[];
  /** a rectangle of the screen's pixels in the coordinates the pets live in */
  toDip(r: Rect): Rect;
  /** just these windows, quickly (by id), when the source can: the ones the pets are following, which are watched closer than the rest */
  frames?(ids: string[]): RawWindow[];
}

/** A window in the coordinates the pets live in. */
export interface WindowBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A top edge shorter than this is not worth a pet's while. */
export const MIN_PERCH_WIDTH = 120;
/** A window smaller than this is a helper of some program, not a window. */
const MIN_WINDOW_W = 160;
const MIN_WINDOW_H = 60;

/** The windows a source has, in the coordinates of the pets and without the ones too small to be real windows. */
export function boxesFrom(source: WindowSource): WindowBox[] {
  const out: WindowBox[] = [];
  for (const raw of source.list()) {
    const r = source.toDip({ x: raw.left, y: raw.top, w: raw.right - raw.left, h: raw.bottom - raw.top });
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w < MIN_WINDOW_W || r.h < MIN_WINDOW_H) continue;
    out.push({ id: raw.id, x: r.x, y: r.y, w: r.w, h: r.h });
  }
  return out;
}

/** What is left of the stretch [a, b] when [c, d] is taken out of it: nothing, one piece or two. */
function cut(a: number, b: number, c: number, d: number): [number, number][] {
  if (d <= a || c >= b) return [[a, b]];
  const out: [number, number][] = [];
  if (c > a) out.push([a, c]);
  if (d < b) out.push([d, b]);
  return out;
}

/**
 * The places to stand: the top edges of the windows, front to back, without what other windows cover. A window in
 * front hides the part of a top edge it reaches over, so a pet never stands in mid-air in front of something else.
 * When a window is cut into pieces the first piece keeps its id and the others take a number after it.
 */
export function platformsFrom(windows: readonly WindowBox[], minWidth = MIN_PERCH_WIDTH): Platform[] {
  const out: Platform[] = [];
  const seen = new Set<string>();
  const above: WindowBox[] = [];
  for (const w of windows) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    let spans: [number, number][] = [[w.x, w.x + w.w]];
    for (const o of above) {
      // only a window that reaches the height of this top edge can cover any of it
      if (w.y < o.y || w.y >= o.y + o.h) continue;
      spans = spans.flatMap(([a, b]) => cut(a, b, o.x, o.x + o.w));
    }
    spans
      .filter(([a, b]) => b - a >= minWidth)
      .forEach(([a, b], i) => out.push({ id: i === 0 ? w.id : `${w.id}#${i}`, x0: a, x1: b, y: w.y, ax: w.x }));
    above.push(w);
  }
  return out;
}

/** A stretch of a window's side that is shorter than this has no room for a pet's feet. */
const MIN_SIDE_FREE = 60;

/**
 * The walls to hide at: the left and right edges of the windows, front to back. A window in front hides the stretch of an
 * edge that it reaches over, so `free` holds what nothing covers. The id is the window's and `:L` or `:R`.
 */
export function sidesFrom(windows: readonly WindowBox[]): Side[] {
  const out: Side[] = [];
  const seen = new Set<string>();
  const above: WindowBox[] = [];
  for (const w of windows) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    const edges: [string, number, 1 | -1][] = [
      ['L', w.x, 1],
      ['R', w.x + w.w, -1],
    ];
    for (const [letter, x, side] of edges) {
      let free: [number, number][] = [[w.y, w.y + w.h]];
      for (const o of above) {
        // only a window that reaches over this x can cover any of the edge
        if (x < o.x || x > o.x + o.w) continue;
        free = free.flatMap(([a, b]) => cut(a, b, o.y, o.y + o.h));
      }
      out.push({ id: `${w.id}:${letter}`, x, y0: w.y, y1: w.y + w.h, side, free: free.filter(([a, b]) => b - a >= MIN_SIDE_FREE) });
    }
    above.push(w);
  }
  return out;
}

/** What the system says about a window, which is what decides whether it is one a pet may sit on. */
export interface WindowFacts {
  visible: boolean;
  minimized: boolean;
  /** hidden by the system without being closed: on another virtual desktop, or an app that is suspended */
  cloaked: boolean;
  /** the extended style bits */
  exStyle: number;
  hasOwner: boolean;
  title: string;
  className: string;
  pid: number;
}

export const WS_EX_TOOLWINDOW = 0x80;
export const WS_EX_TRANSPARENT = 0x20;
export const WS_EX_LAYERED = 0x80000;
export const WS_EX_APPWINDOW = 0x40000;
export const WS_EX_NOACTIVATE = 0x08000000;

/** Windows of the desktop itself: the wallpaper host, the taskbars and the like. */
const SHELL_CLASSES = new Set([
  'Progman',
  'WorkerW',
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland',
  'XamlExplorerHostIslandWindow',
  'Windows.UI.Core.CoreWindow',
]);

/**
 * Is this a window of the kind that shows up in the task switcher, and that belongs to another program? Tool windows,
 * menus, tooltips, click-through overlays, the desktop and the taskbar, and our own windows are not.
 */
export function isStandable(f: WindowFacts, ownPid: number): boolean {
  if (!f.visible || f.minimized || f.cloaked) return false;
  if (f.pid === ownPid) return false;
  if (f.exStyle & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE)) return false;
  // a layered window that lets the mouse through is an overlay of some program
  if ((f.exStyle & WS_EX_LAYERED) !== 0 && (f.exStyle & WS_EX_TRANSPARENT) !== 0) return false;
  // a window with an owner (a dialog) is only listed when it asks to be
  if (f.hasOwner && (f.exStyle & WS_EX_APPWINDOW) === 0) return false;
  if (f.title.trim() === '') return false;
  return !SHELL_CLASSES.has(f.className);
}
