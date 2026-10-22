import { describe, expect, it } from 'vitest';
import {
  boxesFrom,
  isStandable,
  platformsFrom,
  WS_EX_APPWINDOW,
  WS_EX_LAYERED,
  WS_EX_NOACTIVATE,
  WS_EX_TOOLWINDOW,
  WS_EX_TRANSPARENT,
  type RawWindow,
  type WindowBox,
  type WindowFacts,
  type WindowSource,
} from '../src/shell/perch';
import { createWin32Cursor, createWin32Lister, type Koffi } from '../src/shell/win32';

const box = (id: string, x: number, y: number, w: number, h: number): WindowBox => ({ id, x, y, w, h });

describe('platformsFrom', () => {
  it('makes a place to stand of the top edge of a window', () => {
    expect(platformsFrom([box('a', 100, 200, 600, 400)])).toEqual([{ id: 'a', x0: 100, x1: 700, y: 200, ax: 100 }]);
  });

  it('leaves out what a window in front covers of the top edge of one behind it', () => {
    // b is in front and reaches over the right part of a's top edge
    const p = platformsFrom([box('b', 500, 150, 400, 300), box('a', 100, 200, 600, 400)]);
    expect(p).toEqual([
      { id: 'b', x0: 500, x1: 900, y: 150, ax: 500 },
      { id: 'a', x0: 100, x1: 500, y: 200, ax: 100 },
    ]);
  });

  it('cuts a top edge in two when the window in front is in the middle of it, and numbers the pieces', () => {
    const p = platformsFrom([box('front', 300, 100, 200, 500), box('back', 100, 200, 700, 300)]);
    expect(p.map((x) => [x.id, x.x0, x.x1])).toEqual([
      ['front', 300, 500],
      ['back', 100, 300],
      ['back#1', 500, 800],
    ]);
    // both pieces still move with the window itself
    expect(p.filter((x) => x.id.startsWith('back')).map((x) => x.ax)).toEqual([100, 100]);
  });

  it('has no place on a window whose top edge is completely covered', () => {
    expect(platformsFrom([box('front', 0, 100, 1000, 600), box('back', 100, 200, 500, 300)]).map((x) => x.id)).toEqual(['front']);
  });

  it('is not hindered by a window in front that does not reach the height of the top edge', () => {
    // one that is entirely above it, and one that begins below it
    const p = platformsFrom([box('above', 100, 0, 600, 150), box('below', 100, 400, 600, 300), box('a', 100, 200, 600, 400)]);
    expect(p.map((x) => [x.id, x.x0, x.x1])).toEqual([
      ['above', 100, 700],
      ['below', 100, 700],
      ['a', 100, 700],
    ]);
  });

  it('is not hindered by a window behind', () => {
    const p = platformsFrom([box('a', 100, 200, 600, 400), box('behind', 0, 0, 2000, 1000)]);
    expect(p.find((x) => x.id === 'a')).toEqual({ id: 'a', x0: 100, x1: 700, y: 200, ax: 100 });
  });

  it('drops pieces that are too narrow to stand on', () => {
    // only 80 px of the top edge is left
    const p = platformsFrom([box('front', 180, 100, 800, 500), box('back', 100, 200, 800, 300)]);
    expect(p.map((x) => x.id)).toEqual(['front']);
    expect(platformsFrom([box('front', 180, 100, 800, 500), box('back', 100, 200, 800, 300)], 60).map((x) => x.id)).toEqual(['front', 'back']);
  });

  it('knows each window once', () => {
    expect(platformsFrom([box('a', 100, 200, 600, 400), box('a', 0, 0, 2000, 900)])).toHaveLength(1);
  });
});

describe('boxesFrom', () => {
  const source = (windows: RawWindow[], toDip = (r: { x: number; y: number; w: number; h: number }) => r): WindowSource => ({ list: () => windows, toDip });

  it('takes the frame of each window and puts it in the coordinates of the pets', () => {
    // a screen that shows everything at 150%: the pets' pixels are two thirds of the screen's
    const boxes = boxesFrom(source([{ id: '1', left: 300, top: 150, right: 1500, bottom: 1050 }], (r) => ({ x: r.x / 1.5, y: r.y / 1.5, w: r.w / 1.5, h: r.h / 1.5 })));
    expect(boxes).toEqual([{ id: '1', x: 200, y: 100, w: 800, h: 600 }]);
  });

  it('leaves out windows too small to be windows and frames that make no sense', () => {
    const boxes = boxesFrom(
      source([
        { id: 'tiny', left: 0, top: 0, right: 100, bottom: 40 },
        { id: 'flat', left: 0, top: 0, right: 900, bottom: 30 },
        { id: 'nan', left: 0, top: 0, right: Number.NaN, bottom: 500 },
        { id: 'ok', left: 10, top: 20, right: 510, bottom: 420 },
      ]),
    );
    expect(boxes.map((b) => b.id)).toEqual(['ok']);
  });
});

describe('isStandable', () => {
  const normal: WindowFacts = { visible: true, minimized: false, cloaked: false, exStyle: 0, hasOwner: false, title: 'Untitled - Notepad', className: 'Notepad', pid: 4321 };
  const ok = (over: Partial<WindowFacts>): boolean => isStandable({ ...normal, ...over }, 1000);

  it('accepts a window of a program', () => {
    expect(ok({})).toBe(true);
    expect(ok({ exStyle: WS_EX_APPWINDOW })).toBe(true);
  });

  it('refuses windows that are not shown: hidden, minimized, or put away by the system', () => {
    expect(ok({ visible: false })).toBe(false);
    expect(ok({ minimized: true })).toBe(false);
    expect(ok({ cloaked: true })).toBe(false);
  });

  it('refuses our own windows', () => {
    expect(isStandable({ ...normal, pid: 1000 }, 1000)).toBe(false);
  });

  it('refuses tool windows, windows that never take the focus, and click-through overlays', () => {
    expect(ok({ exStyle: WS_EX_TOOLWINDOW })).toBe(false);
    expect(ok({ exStyle: WS_EX_NOACTIVATE })).toBe(false);
    expect(ok({ exStyle: WS_EX_LAYERED | WS_EX_TRANSPARENT })).toBe(false);
    // a layered window that takes the mouse is an ordinary window
    expect(ok({ exStyle: WS_EX_LAYERED })).toBe(true);
  });

  it('refuses a dialog of another window, unless it asks to be listed', () => {
    expect(ok({ hasOwner: true })).toBe(false);
    expect(ok({ hasOwner: true, exStyle: WS_EX_APPWINDOW })).toBe(true);
  });

  it('refuses windows without a title and the desktop and taskbars', () => {
    expect(ok({ title: '' })).toBe(false);
    expect(ok({ title: '   ' })).toBe(false);
    for (const className of ['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']) expect(ok({ className })).toBe(false);
  });
});

describe('the windows of the system', () => {
  interface Fake {
    h: number;
    visible?: boolean;
    minimized?: boolean;
    cloaked?: boolean;
    exStyle?: number;
    owner?: number;
    title: string;
    className?: string;
    pid?: number;
    /** what the system calls the window's rectangle (with the invisible border) */
    rect: { left: number; top: number; right: number; bottom: number };
    /** the rectangle that is drawn; none means the system cannot say */
    frame?: { left: number; top: number; right: number; bottom: number };
    /** looking at this window goes wrong */
    broken?: boolean;
  }

  /** A stand-in for koffi that serves a made-up list of windows, answering as the system's functions do. */
  function fakeKoffi(windows: Fake[]): { koffi: Koffi; declared: string[] } {
    const declared: string[] = [];
    const find = (h: number): Fake => {
      const w = windows.find((x) => x.h === h);
      if (!w) throw new Error(`no window ${h}`);
      if (w.broken) throw new Error('window went away');
      return w;
    };
    const text = (buf: Buffer, s: string): number => {
      buf.write(s, 'utf16le');
      return s.length;
    };
    const fns: Record<string, (...a: any[]) => any> = {
      EnumWindows: (cb: (h: number, l: number) => boolean) => {
        for (const w of windows) if (cb(w.h, 0) === false) break;
        return true;
      },
      IsWindowVisible: (h: number) => find(h).visible !== false,
      IsIconic: (h: number) => !!find(h).minimized,
      GetWindowLongW: (h: number, index: number) => {
        expect(index).toBe(-20);
        return find(h).exStyle ?? 0;
      },
      GetWindow: (h: number, cmd: number) => {
        expect(cmd).toBe(4);
        return find(h).owner ?? 0;
      },
      GetWindowTextW: (h: number, buf: Buffer) => text(buf, find(h).title),
      GetClassNameW: (h: number, buf: Buffer) => text(buf, find(h).className ?? 'AppWindow'),
      GetWindowThreadProcessId: (h: number, out: number[]) => {
        out[0] = find(h).pid ?? 77;
        return 1;
      },
      GetWindowRect: (h: number, out: object) => {
        Object.assign(out, find(h).rect);
        return true;
      },
      DwmGetWindowAttribute: (h: number, attribute: number, out: any) => {
        const w = find(h);
        if (attribute === 14) {
          out[0] = w.cloaked ? 2 : 0;
          return 0;
        }
        if (attribute !== 9) throw new Error(`unexpected attribute ${attribute}`);
        if (!w.frame) return -2147467259;
        Object.assign(out, w.frame);
        return 0;
      },
    };
    const koffi: Koffi = {
      load: () => ({
        func: (signature: string) => {
          declared.push(signature);
          const name = /(\w+)\s*\(/.exec(signature)![1]!;
          const fn = fns[name];
          if (!fn) throw new Error(`unknown function ${name}`);
          return fn;
        },
      }),
      struct: () => ({}),
      proto: () => ({}),
    };
    return { koffi, declared };
  }

  const frame = (l: number, t: number, r: number, b: number) => ({ left: l, top: t, right: r, bottom: b });

  it('lists the windows of programs front to back, with the frame that is drawn', () => {
    const { koffi } = fakeKoffi([
      { h: 100, title: 'Browser', className: 'Chrome_WidgetWin_1', rect: frame(92, 92, 908, 708), frame: frame(100, 100, 900, 700) },
      { h: 200, title: 'Notepad', rect: frame(300, 300, 700, 600), frame: frame(300, 300, 700, 600) },
    ]);
    // each comes with what kind of window it is, which is what the log says about the window a pet hides at
    expect(createWin32Lister(koffi, 1000)()).toEqual([
      { id: '100', left: 100, top: 100, right: 900, bottom: 700, title: 'Browser', className: 'Chrome_WidgetWin_1' },
      { id: '200', left: 300, top: 300, right: 700, bottom: 600, title: 'Notepad', className: 'AppWindow' },
    ]);
  });

  it('leaves out what is not a window of a program', () => {
    const { koffi } = fakeKoffi([
      { h: 1, title: 'ok', rect: frame(0, 0, 500, 400), frame: frame(0, 0, 500, 400) },
      { h: 2, title: 'hidden', visible: false, rect: frame(0, 0, 500, 400) },
      { h: 3, title: 'minimized', minimized: true, rect: frame(0, 0, 500, 400) },
      { h: 4, title: 'other desktop', cloaked: true, rect: frame(0, 0, 500, 400) },
      { h: 5, title: 'tool', exStyle: WS_EX_TOOLWINDOW, rect: frame(0, 0, 500, 400) },
      { h: 6, title: 'ours', pid: 1000, rect: frame(0, 0, 500, 400) },
      { h: 7, title: '', rect: frame(0, 0, 500, 400) },
      { h: 8, title: 'taskbar', className: 'Shell_TrayWnd', rect: frame(0, 0, 500, 400) },
      { h: 9, title: 'dialog', owner: 1, rect: frame(0, 0, 500, 400) },
    ]);
    expect(createWin32Lister(koffi, 1000)().map((w) => w.id)).toEqual(['1']);
  });

  it('falls back to the plain rectangle when the system cannot tell the frame that is drawn', () => {
    const { koffi } = fakeKoffi([{ h: 1, title: 'old', rect: frame(10, 20, 410, 320) }]);
    expect(createWin32Lister(koffi, 1000)()).toEqual([{ id: '1', left: 10, top: 20, right: 410, bottom: 320, title: 'old', className: 'AppWindow' }]);
  });

  it('goes on to the next window when looking at one goes wrong', () => {
    const { koffi } = fakeKoffi([
      { h: 1, title: 'gone', broken: true, rect: frame(0, 0, 500, 400) },
      { h: 2, title: 'fine', rect: frame(0, 0, 500, 400), frame: frame(0, 0, 500, 400) },
    ]);
    expect(createWin32Lister(koffi, 1000)().map((w) => w.id)).toEqual(['2']);
  });

  it('can look at just some of the windows, by id, the same way', () => {
    const { koffi } = fakeKoffi([
      { h: 100, title: 'Browser', rect: frame(92, 92, 908, 708), frame: frame(100, 100, 900, 700) },
      { h: 200, title: 'Notepad', rect: frame(300, 300, 700, 600), frame: frame(300, 300, 700, 600) },
      { h: 300, title: 'minimized', minimized: true, rect: frame(0, 0, 500, 400) },
      { h: 400, title: 'broken', broken: true, rect: frame(0, 0, 500, 400) },
    ]);
    const lister = createWin32Lister(koffi, 1000);
    expect(lister.frames(['200'])).toEqual([{ id: '200', left: 300, top: 300, right: 700, bottom: 600, title: 'Notepad', className: 'AppWindow' }]);
    expect(lister.frames(['200', '100']).map((w) => w.id)).toEqual(['200', '100']);
    // a window that is gone (or put away, or went wrong while it was looked at), and what is not an id of a window, are left out
    expect(lister.frames(['999', '300', '400', 'x', '0', '-5', '1.5', ''])).toEqual([]);
    expect(lister.frames([])).toEqual([]);
  });

  it('declares the functions it uses with the types the system expects', () => {
    const { koffi, declared } = fakeKoffi([]);
    createWin32Lister(koffi, 1000);
    const text = declared.join('\n');
    // the system's calling convention, window handles as integers, and the results that are filled in by the call
    expect(text).toContain('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lparam)');
    expect(text).toContain('GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)');
    expect(text).toContain('_Out_ RECT *value');
    for (const line of declared) expect(line).toMatch(/__stdcall/);
  });
});

describe('the mouse of the system', () => {
  /** A stand-in for koffi that answers as the system's functions do (a short with its top bit set is a key that is down). */
  function fakeMouseKoffi(opts: { down?: number[]; state?: number; hr?: number; refuse?: boolean } = {}): { koffi: Koffi; set: [number, number][]; asked: () => number; declared: string[] } {
    const set: [number, number][] = [];
    const declared: string[] = [];
    let asked = 0;
    const fns: Record<string, (...a: any[]) => any> = {
      SetCursorPos: (x: number, y: number) => {
        set.push([x, y]);
        return opts.refuse ? 0 : 1;
      },
      GetAsyncKeyState: (key: number) => (opts.down?.includes(key) ? -32768 : 0),
      SHQueryUserNotificationState: (out: number[]) => {
        asked++;
        out[0] = opts.state ?? 5;
        return opts.hr ?? 0;
      },
    };
    const koffi: Koffi = {
      load: () => ({
        func: (signature: string) => {
          declared.push(signature);
          const name = /(\w+)\s*\(/.exec(signature)![1]!;
          const fn = fns[name];
          if (!fn) throw new Error(`unknown function ${name}`);
          return fn;
        },
      }),
      struct: () => ({}),
      proto: () => ({}),
    };
    return { koffi, set, asked: () => asked, declared };
  }

  it('puts the cursor at a whole pixel of the screen, and says whether the system did it', () => {
    const a = fakeMouseKoffi();
    expect(createWin32Cursor(a.koffi).set(100.4, 250.6)).toBe(true);
    expect(a.set).toEqual([[100, 251]]);
    const b = fakeMouseKoffi({ refuse: true });
    expect(createWin32Cursor(b.koffi).set(5, 5)).toBe(false);
  });

  it('says the mouse is in use while any of its buttons is down', () => {
    expect(createWin32Cursor(fakeMouseKoffi().koffi).busy()).toBe(false);
    // left, right, middle, and the two side buttons
    for (const key of [0x01, 0x02, 0x04, 0x05, 0x06]) expect(createWin32Cursor(fakeMouseKoffi({ down: [key] }).koffi).busy(), `key ${key}`).toBe(true);
    // another key (a letter) is nothing to do with the mouse
    expect(createWin32Cursor(fakeMouseKoffi({ down: [0x41] }).koffi).busy()).toBe(false);
  });

  it('says the mouse is in use while a program has the whole screen, or nobody is at it', () => {
    // 5 is the ordinary state, 6 quiet hours (nothing to do with the screen)
    for (const state of [5, 6]) expect(createWin32Cursor(fakeMouseKoffi({ state }).koffi).busy(), `state ${state}`).toBe(false);
    // away from the screen, a full screen program, a game, a presentation, a store app
    for (const state of [1, 2, 3, 4, 7]) expect(createWin32Cursor(fakeMouseKoffi({ state }).koffi).busy(), `state ${state}`).toBe(true);
    // when the system cannot say, the screen is not taken for one in use
    expect(createWin32Cursor(fakeMouseKoffi({ state: 3, hr: -2147467259 }).koffi).busy()).toBe(false);
  });

  it('asks about the screen twice a second at most, but about the buttons every time', () => {
    const f = fakeMouseKoffi({ state: 2 });
    let now = 10_000;
    const mouse = createWin32Cursor(f.koffi, () => now);
    for (let i = 0; i < 30; i++) {
      expect(mouse.busy()).toBe(true);
      now += 16;
    }
    // 30 steps of 16 ms are under a second: asked at the start, and once more when 500 ms had gone by
    expect(f.asked()).toBe(1 + Math.floor((30 * 16) / 500));
    const g = fakeMouseKoffi({ down: [0x01] });
    const quick = createWin32Cursor(g.koffi, () => now);
    expect(quick.busy()).toBe(true);
    expect(g.asked()).toBe(0);
  });

  it('declares the functions it uses with the types the system expects', () => {
    const { koffi, declared } = fakeMouseKoffi();
    createWin32Cursor(koffi);
    const text = declared.join('\n');
    expect(text).toContain('int32_t __stdcall SetCursorPos(int x, int y)');
    // a short: the top bit is "down right now" (read as a one byte bool it would be lost)
    expect(text).toContain('int16_t __stdcall GetAsyncKeyState(int key)');
    expect(text).toContain('SHQueryUserNotificationState(_Out_ int32_t *state)');
    for (const line of declared) expect(line).toMatch(/__stdcall/);
  });
});
