// Bundles the Electron main process and preload script into single CJS files.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  // koffi is a native module: it is loaded from node_modules at run time, not bundled
  external: ['electron', 'koffi'],
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/shell/main.ts'], outfile: 'dist/shell/main.cjs' });
await build({ ...common, entryPoints: ['src/shell/preload.ts'], outfile: 'dist/shell/preload.cjs' });
await build({ ...common, entryPoints: ['src/shell/maker-preload.ts'], outfile: 'dist/shell/maker-preload.cjs' });
