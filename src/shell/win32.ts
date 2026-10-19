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
export function createWin32Lister(koffi: Koffi, ownPid: number): () => RawWindow[] {
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

  return () => {
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
}

/**
 * The system's windows, or null where that is not possible: not Windows, or the library that calls the system could
 * not be loaded. Nothing else in the app depends on it.
 */
export function openWin32Source(ownPid: number, toDip: (r: Rect) => Rect, warn: (message: string) => void): WindowSource | null {
  if (process.platform !== 'win32') return null;
  try {
    const koffi = require('koffi') as Koffi;
    return { list: createWin32Lister(koffi, ownPid), toDip };
  } catch (err) {
    warn(`windows to sit on are not available: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
