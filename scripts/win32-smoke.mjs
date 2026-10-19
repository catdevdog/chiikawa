// Run on Windows (the build workflow does): declares the system's functions that read the windows of other programs
// through the real koffi, exactly as the app does, and lists the windows it finds. With a title as the argument it also
// looks for a window with that title (scripts/win32-smoke-window.ps1 opens one).
//   node scripts/win32-smoke.mjs [title]
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
const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'buddy-smoke-')), 'win32.cjs');
await build({ entryPoints: ['src/shell/win32.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['koffi'], outfile: out, logLevel: 'error' });
const { createWin32Lister } = require(out);

const want = process.argv[2];
let windows;
try {
  windows = createWin32Lister(require('koffi'), process.pid)();
} catch (err) {
  console.error(`::error::reading the windows failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
}
console.log(`${windows.length} windows a pet could sit on`);
for (const w of windows) console.log(`  ${w.id}  ${w.right - w.left}x${w.bottom - w.top} at ${w.left},${w.top}  "${w.title}"`);
if (!Array.isArray(windows) || windows.some((w) => ![w.left, w.top, w.right, w.bottom].every(Number.isFinite))) {
  console.error('::error::the windows come back in a form the app cannot use');
  process.exit(1);
}
if (want) {
  const hit = windows.find((w) => w.title === want);
  if (!hit) {
    console.error(`::warning::no window titled "${want}" was found (a runner without a desktop shows none)`);
    process.exit(1);
  }
  console.log(`found "${want}" at ${hit.left},${hit.top} (${hit.right - hit.left}x${hit.bottom - hit.top})`);
}
