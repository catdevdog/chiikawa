// Run on Windows (the build workflow does) after `npm run build`: the app itself (not packaged, so that its test hooks are
// there) next to a real window of another program (scripts/win32-smoke-window.ps1 opens one), driven by real mouse input.
// A pet is put down beside the left edge of that window and hides there; then the window is moved, minimized and restored,
// and closed, the way a person does it, and the pet has to go along, let go, and let go. Everything is told as it happens so
// that a pet that stays where it is can be told apart by what the app knew at that moment.
//   node scripts/win32-e2e.mjs [title] [setup]
// `setup` is how the app is set up: "plain" (a pet that walks along a floor, in wander mode, silent: what the other checks use),
// "user" (the settings of somebody who has just installed it: the whole screen, mode auto, words, tricks, a friend), or "scaled"
// (those, with the screen scaled by half as much again, as on a laptop at 150 %).
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

if (process.platform !== 'win32') {
  console.log('This is not Windows: there is nothing to check.');
  process.exit(0);
}

const require = createRequire(import.meta.url);
const koffi = require('koffi');
const { _electron: electron } = require('playwright-core');
const electronPath = require('electron');

const title = process.argv[2] ?? 'buddy-smoke-window';
const setup = process.argv[3] ?? 'plain';
const SETTINGS = {
  plain: { skin: 'usagi', friends: [], mode: 'wander', roam: 'floor', speech: 'off', tricks: false, windows: true },
  user: { skin: 'usagi', friends: ['hachiware'], mode: 'auto', roam: 'free', speech: 'all', tricks: true, windows: true },
};
if (!['plain', 'user', 'scaled'].includes(setup)) {
  console.error(`unknown setup "${setup}"`);
  process.exit(2);
}
const root = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const stamp = () => `${String(Date.now() - t0).padStart(6)} ms`;
const say = (msg) => console.log(`${stamp()}  ${msg}`);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`);
};
async function waitFor(fn, timeout = 8000, step = 50) {
  const from = Date.now();
  for (;;) {
    const v = await fn();
    if (v || Date.now() - from > timeout) return v;
    await sleep(step);
  }
}

// --- the system: the windows, and the mouse --------------------------------------------------------------------------
const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'buddy-e2e-')), 'win32.cjs');
await build({ entryPoints: ['src/shell/win32.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['koffi'], outfile: out, logLevel: 'error' });
const lister = require(out).createWin32Lister(koffi, process.pid);
const user32 = koffi.load('user32.dll');
const setCursorPos = user32.func('int32_t __stdcall SetCursorPos(int x, int y)');
const mouseEvent = user32.func('void __stdcall mouse_event(uint32_t flags, uint32_t dx, uint32_t dy, uint32_t data, uintptr_t extra)');
const postMessage = user32.func('int32_t __stdcall PostMessageW(intptr_t hwnd, uint32_t msg, uintptr_t wparam, intptr_t lparam)');
const setWindowPos = user32.func('int32_t __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)');
const WM_CLOSE = 0x0010;
const WM_SYSCOMMAND = 0x0112;
const SC_MINIMIZE = 0xf020;
const SC_RESTORE = 0xf120;
const SWP_NOSIZE = 0x1;
const SWP_NOZORDER = 0x4;
const SWP_NOACTIVATE = 0x10;
const move = (x, y) => setCursorPos(Math.round(x), Math.round(y));
const down = () => mouseEvent(0x2, 0, 0, 0, 0);
const up = () => mouseEvent(0x4, 0, 0, 0, 0);

const form = lister().find((w) => w.title === title);
if (!form) {
  console.error(`::warning::no window titled "${title}" was found (a runner without a desktop shows none)`);
  process.exit(1);
}
const wid = form.id;
say(`the window is ${wid}: ${form.right - form.left}x${form.bottom - form.top} at ${form.left},${form.top}`);

// --- the app -------------------------------------------------------------------------------------------------------------
const userData = mkdtempSync(path.join(os.tmpdir(), 'buddy-e2e-data-'));
mkdirSync(path.join(userData, 'skins'), { recursive: true });
writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(SETTINGS[setup === 'plain' ? 'plain' : 'user']));
const scale = setup === 'scaled' ? ['--force-device-scale-factor=1.5'] : [];
say(`setup: ${setup}`);
const app = await electron.launch({ executablePath: electronPath, args: ['.', '--disable-gpu', `--user-data-dir=${userData}`, '--lang=ko', ...scale], env: { ...process.env, BUDDY_TEST: '1' }, cwd: root });
const logs = [];
app.process().stdout?.on('data', (d) => logs.push(String(d)));
app.process().stderr?.on('data', (d) => logs.push(String(d)));
const T = (fn, ...args) => app.evaluate((_, [name, a]) => globalThis.__buddyTest[name](...a), [fn, args]);
const P = (fn, ...args) => app.evaluate((_, [name, a]) => globalThis.__buddyTest.perch[name](...a), [fn, args]);
const view = async () => (await T('views'))[0];
const attached = async () => (await P('attachments'))[0]?.at ?? null;

let failed = false;
try {
  await waitFor(() => app.evaluate(() => !!globalThis.__buddyTest?.view()).catch(() => false), 40000, 200);
  const screens = await T('windows');
  say(`overlays: ${JSON.stringify(screens.map((s) => ({ id: s.id, area: s.area, ready: s.ready })))}`);
  const ox = screens[0].area.x;
  const oy = screens[0].area.y;

  // the app has to know the window the way the system lists it
  await waitFor(async () => (await P('sides')).some((s) => s.id === `${wid}:L`), 8000, 100);
  const sides = (await P('sides')).filter((s) => s.id.startsWith(`${wid}:`));
  say(`sides of the window: ${JSON.stringify(sides.map((s) => ({ id: s.id, x: s.x, y0: s.y0, y1: s.y1, free: s.free })))}`);
  check('the app lists both sides of the real window', sides.length === 2);
  const left = sides.find((s) => s.id === `${wid}:L`);

  // put the pet down beside the left edge, slowly, with the real mouse
  const putDown = async (feetX, feetY) => {
    const v0 = await waitFor(async () => {
      const v = await view();
      return (v.state === 'idle' || v.state === 'sit' || v.state === 'walk') && v.interactive ? v : null;
    }, 30000, 80);
    if (!v0) return false;
    const from = { x: ox + v0.hitbox.x + v0.hitbox.w / 2, y: oy + v0.hitbox.y + v0.hitbox.h / 2 };
    move(from.x, from.y);
    await sleep(400);
    down();
    const dx = feetX - v0.x;
    const dy = feetY - v0.y;
    for (let i = 1; i <= 20; i++) {
      move(from.x + (dx * i) / 20, from.y + (dy * i) / 20);
      await sleep(25);
    }
    await sleep(400);
    up();
    await sleep(400);
    move(ox + 5, oy + 5);
    return true;
  };

  const feetY = Math.round(left.y0 + (left.y1 - left.y0) * 0.6);
  say(`put down at ${left.x - 20},${feetY}`);
  check('the pet is put down beside the left edge of the real window', await putDown(left.x - 20, feetY));
  const hid = await waitFor(async () => (await attached()) === wid, 5000, 100);
  const v1 = await view();
  say(`after the drop: state ${v1.state}, at ${Math.round(v1.x)},${Math.round(v1.y)}, attached to ${await attached()}`);
  check('it holds on there: it hides at the side of that window', !!hid);
  await waitFor(async () => (await view()).state === 'peek', 4000, 100);
  await sleep(800);

  // the window moves: the pet goes with it (it is the edge of the picture at the wall that stays where the window's edge is: the pet
  // itself ducks back and forth along the way)
  const edge = (v) => v.hitbox.x + v.hitbox.w;
  const before = await view();
  setWindowPos(Number(wid), 0, form.left + 60, form.top + 30, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
  await sleep(500);
  const after = await view();
  say(`the window moved by 60,30: the wall of the pet moved by ${Math.round(edge(after) - edge(before))},${Math.round(after.y - before.y)}`);
  check('when the window is moved the pet goes along', Math.abs(edge(after) - edge(before) - 60) < 3 && Math.abs(after.y - before.y - 30) < 3 && (await attached()) === wid);

  /** what the app knows about the pet and the window, as it changes, until `done` says it is over (or the time is up) */
  async function watch(label, done, timeout = 6000) {
    const from = Date.now();
    let last = '';
    for (;;) {
      const v = await view();
      const at = await attached();
      const listed = (await P('sides')).filter((s) => s.id.startsWith(`${wid}:`)).length;
      const known = lister().some((w) => w.id === wid);
      const line = `state ${v.state}, y ${Math.round(v.y)}, attached ${at}, sides of the window ${listed}, the window is listed ${known}`;
      if (line !== last) {
        say(`${label}: ${line}`);
        last = line;
      }
      if (await done(v, at)) return true;
      if (Date.now() - from > timeout) return false;
      await sleep(50);
    }
  }

  // minimized, the way the title bar's button does it
  postMessage(Number(wid), WM_SYSCOMMAND, SC_MINIMIZE, 0);
  const letGo = await watch('minimized', (v, at) => at === null && v.state !== 'peek');
  check('when the window is minimized the pet lets go', letGo);
  const floorY = (await view()).y;
  await waitFor(async () => (await view()).state !== 'fall', 6000, 100);
  const landed = await view();
  say(`landed: state ${landed.state}, y ${Math.round(landed.y)} (was ${Math.round(floorY)} while falling)`);
  check('and falls to the floor', landed.state !== 'fall' && landed.state !== 'peek' && landed.y > left.y1);

  // restored: the window is there again (the pet is not on it any more)
  postMessage(Number(wid), WM_SYSCOMMAND, SC_RESTORE, 0);
  await waitFor(() => lister().some((w) => w.id === wid), 4000, 100);
  await waitFor(async () => (await P('sides')).some((s) => s.id === `${wid}:L`), 4000, 100);
  await sleep(500);

  // and once more beside it, and this time the window is closed
  const again = (await P('sides')).find((s) => s.id === `${wid}:L`);
  check('the restored window is listed again', !!again);
  if (again) {
    say(`put down at ${again.x - 20},${feetY + 20}`);
    check('the pet is put down beside it again', await putDown(again.x - 20, feetY + 20));
    check('it hides there again', !!(await waitFor(async () => (await attached()) === wid, 5000, 100)));
    await waitFor(async () => (await view()).state === 'peek', 4000, 100);
    await sleep(800);
    postMessage(Number(wid), WM_CLOSE, 0, 0);
    const closed = await watch('closed', (v, at) => at === null && v.state !== 'peek');
    check('when the window is closed the pet lets go', closed);
  }

  const bad = logs.join('').split('\n').filter((l) => /\berror\b|uncaught|unhandled/i.test(l) && !/dbus|libnotify|gpu|vaapi|Fontconfig|disk_cache|cache_util/i.test(l));
  check('no errors in the main process', bad.length === 0, bad.slice(0, 3).join(' | '));
} catch (err) {
  failed = true;
  check('the script itself ran to the end', false, err instanceof Error ? (err.stack ?? err.message) : String(err));
} finally {
  await app.close().catch(() => {});
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed${bad.length ? `, FAILED: ${bad.map((f) => f.name).join('; ')}` : ''}`);
  if (bad.length > 0 || failed) console.error(`::error::${bad.length} of the checks of the app with a real window failed: ${bad.map((f) => f.name).join('; ')}`);
  process.exit(bad.length > 0 || failed ? 1 : 0);
}
