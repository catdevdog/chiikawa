// Run with the packaged app's own executable in node mode (ELECTRON_RUN_AS_NODE=1): loads koffi from the app's asar the
// way the app does, and calls one function of the system through it.
//   "Desktop Buddy.exe" scripts/win32-packaged-smoke.cjs <the resources folder of the packaged app>
const path = require('node:path');

const resources = process.argv[2];
const dir = path.join(resources, 'app.asar', 'node_modules', 'koffi');
const koffi = require(dir);
const isWindow = koffi.load('user32.dll').func('bool __stdcall IsWindow(intptr_t hwnd)');
if (isWindow(0) !== false) {
  console.error('::error::IsWindow(0) came back as something other than false');
  process.exit(1);
}
console.log(`koffi ${require(path.join(dir, 'package.json')).version} works from the packaged app`);
