// Run on Windows (the build workflow does): the functions that the experiment in which a pet pulls at the mouse uses, through the
// real koffi, exactly as the app declares them: the cursor is put at a few places and read back, and what the system says about the
// buttons of the mouse and about the screen (a game, a film or a presentation on it) is written down.
//   node scripts/win32-cursor-check.mjs
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
const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'buddy-cursor-')), 'win32.cjs');
await build({ entryPoints: ['src/shell/win32.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['koffi'], outfile: out, logLevel: 'error' });
const { createWin32Cursor } = require(out);
const koffi = require('koffi');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mouse = createWin32Cursor(koffi);
const user32 = koffi.load('user32.dll');
const shell32 = koffi.load('shell32.dll');
koffi.struct('CheckPoint', { x: 'int32_t', y: 'int32_t' });
const getCursorPos = user32.func('int32_t __stdcall GetCursorPos(_Out_ CheckPoint *point)');
const screenState = shell32.func('int32_t __stdcall SHQueryUserNotificationState(_Out_ int32_t *state)');
const read = () => {
  const p = {};
  getCursorPos(p);
  return [p.x, p.y];
};

const failures = [];
const expect = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const home = read();
console.log(`the cursor is at ${home}`);
for (const [x, y] of [[100, 100], [300, 220], [512, 380], [101, 101]]) {
  const done = mouse.set(x, y);
  await sleep(60);
  const at = read();
  expect(done && at[0] === x && at[1] === y, `the cursor put at ${x},${y} is read back at ${at}`);
}
// a point that is not on the screen: the system puts it at the nearest place on it, and says so (or refuses)
console.log(`a point far off the screen: set says ${mouse.set(100000, 100000)}, and the cursor is at ${read()}`);
mouse.set(home[0], home[1]);

const state = [0];
const hr = screenState(state);
console.log(`the screen: SHQueryUserNotificationState says ${state[0]} (hr ${hr}); busy() says ${mouse.busy()} (no button is down here)`);
expect(hr === 0, 'the system can say what the screen is used for');

if (failures.length > 0) {
  console.error(`::error::${failures.length} of the checks of the cursor failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('the cursor can be moved, and read back');
