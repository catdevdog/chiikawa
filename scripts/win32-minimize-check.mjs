// Run on Windows (the build workflow does), with the window that scripts/win32-smoke-window.ps1 opens: minimizes it the
// way the title bar's button does and the way a program does, and checks that the app's reading of the windows leaves it out
// while it is minimized and has it back once it is restored. Besides that it writes down what the system's functions say
// about the window at each step, so that a window that stays in the list can be told apart by what the system answered.
//   node scripts/win32-minimize-check.mjs [title]
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

if (process.platform !== 'win32') {
  console.log('This is not Windows: there is nothing to check.');
  process.exit(0);
}

const require = createRequire(import.meta.url);
const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'buddy-minimize-')), 'win32.cjs');
await build({ entryPoints: ['src/shell/win32.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['koffi'], outfile: out, logLevel: 'error' });
const { createWin32Lister } = require(out);
const koffi = require('koffi');

const title = process.argv[2] ?? 'buddy-smoke-window';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (n) => `0x${(Number(n) >>> 0).toString(16)}`;

const lister = createWin32Lister(koffi, process.pid);

// the same functions again, each answer read as the whole number the system gives (a BOOL is 32 bits) and as the one byte
// that koffi's `bool` reads, so that the two can be told apart
const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');
koffi.struct('ProbeRect', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
const f = {
  iconicInt: user32.func('int32_t __stdcall IsIconic(intptr_t hwnd)'),
  iconicBool: user32.func('bool __stdcall IsIconic(intptr_t hwnd)'),
  visibleInt: user32.func('int32_t __stdcall IsWindowVisible(intptr_t hwnd)'),
  visibleBool: user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)'),
  zoomedInt: user32.func('int32_t __stdcall IsZoomed(intptr_t hwnd)'),
  style: user32.func('int32_t __stdcall GetWindowLongW(intptr_t hwnd, int index)'),
  rect: user32.func('int32_t __stdcall GetWindowRect(intptr_t hwnd, _Out_ ProbeRect *rect)'),
  dwmRect: dwmapi.func('int32_t __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t attribute, _Out_ ProbeRect *value, uint32_t size)'),
  dwmFlag: dwmapi.func('int32_t __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t attribute, _Out_ uint32_t *value, uint32_t size)'),
  post: user32.func('int32_t __stdcall PostMessageW(intptr_t hwnd, uint32_t msg, uintptr_t wparam, intptr_t lparam)'),
  show: user32.func('int32_t __stdcall ShowWindow(intptr_t hwnd, int cmd)'),
};

const WM_SYSCOMMAND = 0x0112;
const SC_MINIMIZE = 0xf020;
const SC_RESTORE = 0xf120;
const SW_MINIMIZE = 6;
const SW_RESTORE = 9;
const WS_MINIMIZE = 0x20000000;

const attempt = (fn) => {
  try {
    return fn();
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
};
const box = (r) => (r && typeof r === 'object' ? `${r.left},${r.top},${r.right},${r.bottom}` : String(r));

/** What the app sees, and what the system says, about the window at this moment. */
function probe(label, id) {
  const hwnd = Number(id);
  const listed = lister().some((w) => w.id === id);
  const framed = lister.frames([id]).length > 0;
  const rect = {};
  const frame = {};
  const cloaked = [0];
  const line = {
    isIconicInt: attempt(() => hex(f.iconicInt(hwnd))),
    isIconicBool: attempt(() => f.iconicBool(hwnd)),
    isWindowVisibleInt: attempt(() => hex(f.visibleInt(hwnd))),
    isWindowVisibleBool: attempt(() => f.visibleBool(hwnd)),
    isZoomedInt: attempt(() => hex(f.zoomedInt(hwnd))),
    styleHasMinimize: attempt(() => (f.style(hwnd, -16) & WS_MINIMIZE) !== 0),
    windowRect: attempt(() => (f.rect(hwnd, rect) !== 0 ? box(rect) : 'failed')),
    dwmFrame: attempt(() => {
      const hr = f.dwmRect(hwnd, 9, frame, 16);
      return `hr=${hex(hr)} ${box(frame)}`;
    }),
    dwmCloaked: attempt(() => {
      const hr = f.dwmFlag(hwnd, 14, cloaked, 4);
      return `hr=${hex(hr)} value=${cloaked[0]}`;
    }),
    listedByTheApp: listed,
    framesByTheApp: framed,
  };
  console.log(`probe ${label}: ${JSON.stringify(line)}`);
  return { listed, framed };
}

const find = () => lister().find((w) => w.title === title);
const first = find();
if (!first) {
  console.error(`::warning::no window titled "${title}" was found (a runner without a desktop shows none)`);
  process.exit(1);
}
const id = first.id;
console.log(`the window is ${id}: ${first.right - first.left}x${first.bottom - first.top} at ${first.left},${first.top}`);

const failures = [];
const expect = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const normal = probe('normal', id);
expect(normal.listed && normal.framed, 'an ordinary window is listed (and read by id)');

for (const [name, minimize, restore] of [
  ['the title bar button (SC_MINIMIZE)', () => f.post(Number(id), WM_SYSCOMMAND, SC_MINIMIZE, 0), () => f.post(Number(id), WM_SYSCOMMAND, SC_RESTORE, 0)],
  ['ShowWindow(SW_MINIMIZE)', () => f.show(Number(id), SW_MINIMIZE), () => f.show(Number(id), SW_RESTORE)],
]) {
  minimize();
  await sleep(1500);
  const min = probe(`minimized by ${name}`, id);
  expect(!min.listed, `minimized by ${name}: the window is left out of the list`);
  expect(!min.framed, `minimized by ${name}: the window is left out when it is read by id`);
  restore();
  await sleep(1500);
  const back = probe(`restored after ${name}`, id);
  expect(back.listed && back.framed, `restored after ${name}: the window is listed again`);
}

if (failures.length > 0) {
  console.error(`::error::${failures.length} of the checks of minimized windows failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('a minimized window is left out and comes back when it is restored');
