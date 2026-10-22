import type { Rect } from '../engine/types';
import { isStandable, type RawWindow, type WindowFacts, type WindowSource } from './perch';

/** The few parts of koffi (a library for calling the system's own functions) that are used here, so that they can be stood in for. */
export interface Koffi {
  load(name: string): { func(signature: string): (...args: any[]) => any };
  struct(name: string, members: Record<string, string>): unknown;
  proto(signature: string): unknown;
}

const GWL_EXSTYLE = -20;
const GW_OWNER = 4;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
/** characters of a title or a class name that are read */
const TEXT_CHARS = 256;

/** `n` UTF-16 characters of a buffer the system filled in. */
const wide = (buf: Buffer, n: number): string => buf.toString('utf16le', 0, Math.max(0, Math.min(n, TEXT_CHARS)) * 2);

/**
 * Lists the windows of other programs that a pet may sit on, front to back, as the system has them right now. A
 * window is as the task switcher would show it (see `isStandable`), and its frame is the one that is drawn (without
 * the invisible border that the system adds around it). The pixels are those of the screen.
 *
 * Opening the libraries and declaring the functions happens once, here; the returned function is what to call
 * every time.
 */
export function createWin32Lister(koffi: Koffi, ownPid: number): (() => RawWindow[]) & { frames(ids: string[]): RawWindow[] } {
  const user32 = koffi.load('user32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  koffi.struct('RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
  // window handles are passed around as plain integers: they only ever need to be handed back
  koffi.proto('bool __stdcall EnumWindowsProc(intptr_t hwnd, intptr_t lparam)');
  const enumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lparam)');
  const isVisible = user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)');
  const isIconic = user32.func('bool __stdcall IsIconic(intptr_t hwnd)');
  const getLong = user32.func('int32_t __stdcall GetWindowLongW(intptr_t hwnd, int index)');
  const getWindow = user32.func('intptr_t __stdcall GetWindow(intptr_t hwnd, uint32_t cmd)');
  const getText = user32.func('int __stdcall GetWindowTextW(intptr_t hwnd, _Out_ uint8_t *text, int max)');
  const getClass = user32.func('int __stdcall GetClassNameW(intptr_t hwnd, _Out_ uint8_t *text, int max)');
  const getPid = user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)');
  const getRect = user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)');
  const dwmRect = dwmapi.func('int32_t __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t attribute, _Out_ RECT *value, uint32_t size)');
  const dwmFlag = dwmapi.func('int32_t __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t attribute, _Out_ uint32_t *value, uint32_t size)');
  const buf = Buffer.alloc(TEXT_CHARS * 2 + 2);

  const inspect = (hwnd: number): RawWindow | null => {
    if (!isVisible(hwnd)) return null;
    const cloaked = [0];
    const hr = dwmFlag(hwnd, DWMWA_CLOAKED, cloaked, 4);
    const pid = [0];
    getPid(hwnd, pid);
    buf.fill(0);
    const title = wide(buf, getText(hwnd, buf, TEXT_CHARS));
    buf.fill(0);
    const className = wide(buf, getClass(hwnd, buf, TEXT_CHARS));
    const facts: WindowFacts = {
      visible: true,
      minimized: !!isIconic(hwnd),
      cloaked: hr === 0 && cloaked[0] !== 0,
      exStyle: getLong(hwnd, GWL_EXSTYLE) >>> 0,
      hasOwner: getWindow(hwnd, GW_OWNER) !== 0,
      title,
      className,
      pid: pid[0] ?? 0,
    };
    if (!isStandable(facts, ownPid)) return null;
    // the frame that is drawn, not the one the system reserves around it
    const frame: { left?: number; top?: number; right?: number; bottom?: number } = {};
    if (dwmRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, frame, 16) !== 0 && !getRect(hwnd, frame)) return null;
    const { left, top, right, bottom } = frame;
    if (left === undefined || top === undefined || right === undefined || bottom === undefined) return null;
    return { id: String(hwnd), left, top, right, bottom, title };
  };

  const list = (): RawWindow[] => {
    const found: RawWindow[] = [];
    enumWindows((hwnd: number): boolean => {
      try {
        const w = inspect(hwnd);
        if (w) found.push(w);
      } catch {
        // a window that went away while it was looked at; the next one
      }
      return true;
    }, 0);
    return found;
  };
  /** Just these windows (by id), looked at the same way: the ones a pet goes along with, which are read often. A window that is gone, or no longer one to stand on, is not in the answer. */
  const frames = (ids: string[]): RawWindow[] => {
    const found: RawWindow[] = [];
    for (const id of ids) {
      const hwnd = Number(id);
      if (!Number.isSafeInteger(hwnd) || hwnd === 0) continue;
      try {
        const w = inspect(hwnd);
        if (w) found.push(w);
      } catch {
        // gone while it was looked at
      }
    }
    return found;
  };
  return Object.assign(list, { frames });
}

/** What the experiment in which a pet pulls at the mouse needs of the system. */
export interface CursorControl {
  /** Puts the cursor at a point of the screen (in its pixels, not the pets' coordinates); false when the system refuses. */
  set(x: number, y: number): boolean;
  /** A mouse button is down, or a program has the whole screen (a game, a film, a presentation): the pet leaves the mouse alone. */
  busy(): boolean;
}

/** The keys of the mouse: left, right, middle, and the two side buttons. */
const MOUSE_KEYS = [0x01, 0x02, 0x04, 0x05, 0x06];
/**
 * What `SHQueryUserNotificationState` says about the screen: 1 nobody is at it (locked, a screen saver), 2 a program has the
 * whole screen or a presentation is on, 3 a game has it, 4 a presentation, 7 a store app has it. (5 is the ordinary state, 6 quiet hours.)
 */
const SCREEN_TAKEN = [1, 2, 3, 4, 7];
/** The screen is asked about this often at most (ms): the answer does not change quickly, and the call is the dearest. */
const SCREEN_ASK_MS = 500;

/** Declares the system's functions that move the cursor and tell that the mouse is in use, once; the returned object is what to call. */
export function createWin32Cursor(koffi: Koffi, now: () => number = Date.now): CursorControl {
  const user32 = koffi.load('user32.dll');
  const shell32 = koffi.load('shell32.dll');
  const setCursorPos = user32.func('int32_t __stdcall SetCursorPos(int x, int y)');
  const keyState = user32.func('int16_t __stdcall GetAsyncKeyState(int key)');
  const screenState = shell32.func('int32_t __stdcall SHQueryUserNotificationState(_Out_ int32_t *state)');
  let askedAt = -Infinity;
  let taken = false;
  return {
    set: (x, y) => setCursorPos(Math.round(x), Math.round(y)) !== 0,
    busy: () => {
      // the top bit of the answer is "down right now"
      for (const key of MOUSE_KEYS) if ((keyState(key) & 0x8000) !== 0) return true;
      const t = now();
      if (t - askedAt >= SCREEN_ASK_MS) {
        askedAt = t;
        const state = [0];
        taken = screenState(state) === 0 && SCREEN_TAKEN.includes(state[0] ?? 0);
      }
      return taken;
    },
  };
}

/** The system's way to move the cursor, or null where that is not possible (not Windows, or koffi could not be loaded). */
export function openWin32Cursor(warn: (message: string) => void): CursorControl | null {
  if (process.platform !== 'win32') return null;
  try {
    return createWin32Cursor(require('koffi') as Koffi);
  } catch (err) {
    warn(`the cursor cannot be moved: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * The system's windows, or null where that is not possible: not Windows, or the library that calls the system could
 * not be loaded. Nothing else in the app depends on it.
 */
export function openWin32Source(ownPid: number, toDip: (r: Rect) => Rect, warn: (message: string) => void): WindowSource | null {
  if (process.platform !== 'win32') return null;
  try {
    const koffi = require('koffi') as Koffi;
    const list = createWin32Lister(koffi, ownPid);
    return { list, frames: list.frames, toDip };
  } catch (err) {
    warn(`windows to sit on are not available: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
