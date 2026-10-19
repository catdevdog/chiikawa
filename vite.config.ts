import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const skinsDir = path.join(root, 'skins');

const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function listSkins(): { id: string; name: string; builtin: boolean }[] {
  const out: { id: string; name: string; builtin: boolean }[] = [];
  for (const entry of readdirSync(skinsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(readFileSync(path.join(skinsDir, entry.name, 'manifest.json'), 'utf8'));
      out.push({ id: entry.name, name: typeof manifest.name === 'string' ? manifest.name : entry.name, builtin: entry.name === 'default' });
    } catch {
      // not a skin folder
    }
  }
  return out;
}

/** Serves ./skins at /skins in the browser harness. Electron serves the same URLs through buddy://. */
function serveSkins(): Plugin {
  return {
    name: 'serve-skins',
    configureServer(server) {
      server.middlewares.use('/skins', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
        if (rel === '/index.json') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(listSkins()));
          return;
        }
        const file = path.resolve(skinsDir, '.' + rel);
        if (!file.startsWith(skinsDir + path.sep)) return next();
        try {
          if (!statSync(file).isFile()) return next();
        } catch {
          return next();
        }
        res.setHeader('content-type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  root: path.join(root, 'src/renderer'),
  base: './',
  plugins: [serveSkins()],
  build: {
    outDir: path.join(root, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome130',
  },
  server: { port: 5173 },
});
