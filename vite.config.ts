import { createReadStream, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { skinTitle } from './src/shared/skin-name.ts';
import { validateSkinPayload } from './src/shared/skin-payload.ts';

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
      out.push({ id: entry.name, name: skinTitle(manifest, 'ko', entry.name), builtin: entry.name === 'default' });
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

/**
 * Dev only: lets the skin maker, opened in a normal browser, write skins into ./skins.
 * It runs the same validation as the app's save, and the custom header keeps other web pages from posting here.
 */
function makerSave(): Plugin {
  return {
    name: 'maker-save',
    configureServer(server) {
      server.middlewares.use('/__maker/save', (req, res) => {
        const reply = (status: number, body: unknown): void => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST' || req.headers['x-maker'] !== '1') return reply(405, { ok: false, error: 'not allowed' });
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (c: Buffer) => {
          size += c.length;
          if (size > 140 * 1024 * 1024) req.destroy();
          else chunks.push(c);
        });
        req.on('end', () => {
          try {
            const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const files = Array.isArray(raw.files)
              ? raw.files.map((f: { name?: string; data?: string }) => ({
                  name: f?.name,
                  data: typeof f?.data === 'string' ? new Uint8Array(Buffer.from(f.data, 'base64')) : null,
                }))
              : raw.files;
            const checked = validateSkinPayload({ id: raw.id, files });
            if (!checked.ok) return reply(400, { ok: false, error: checked.error });
            const dir = path.join(skinsDir, checked.payload.id);
            const tmp = `${dir}.tmp-${process.pid}`;
            rmSync(tmp, { recursive: true, force: true });
            mkdirSync(tmp, { recursive: true });
            for (const f of checked.payload.files) writeFileSync(path.join(tmp, f.name), f.data);
            rmSync(dir, { recursive: true, force: true });
            renameSync(tmp, dir);
            reply(200, { ok: true, where: dir });
          } catch (err) {
            reply(500, { ok: false, error: String(err) });
          }
        });
      });
    },
  };
}

export default defineConfig({
  root: path.join(root, 'src/renderer'),
  base: './',
  plugins: [serveSkins(), makerSave()],
  build: {
    outDir: path.join(root, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome130',
    rollupOptions: {
      input: {
        index: path.join(root, 'src/renderer/index.html'),
        maker: path.join(root, 'src/renderer/maker.html'),
      },
    },
  },
  server: { port: 5173 },
});
