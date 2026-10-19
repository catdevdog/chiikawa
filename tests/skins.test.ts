import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import { parseManifest, poseFiles } from '../src/shared/manifest';

const ROOT = path.resolve(__dirname, '..');

/** The skins the installer ships: every `from: skins/<id>` entry of electron-builder.yml. */
const bundled = [...readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8').matchAll(/from:\s*skins\/([\w.-]+)/g)].map((m) => m[1]!);

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  expect([...b.subarray(0, 4)], `${file} is not a PNG`).toEqual([0x89, 0x50, 0x4e, 0x47]);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe('bundled skins', () => {
  it('ships the default mascot and the skin new installs start with', () => {
    expect(bundled).toContain('default');
    expect(bundled).toContain(DEFAULT_SETTINGS.skin);
  });

  for (const id of bundled) {
    describe(id, () => {
      const dir = path.join(ROOT, 'skins', id);

      it('has a valid manifest whose files all exist', () => {
        const manifest = parseManifest(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')), id);
        expect(manifest.poses.idle).toBeTruthy();
        for (const file of poseFiles(manifest)) expect(existsSync(path.join(dir, file)), `${id}/${file}`).toBe(true);
        for (const target of Object.values(manifest.states ?? {})) expect(manifest.poses[target!], `states -> ${target}`).toBeTruthy();
      });

      it('has sprite sheets that really contain their frames', () => {
        const manifest = parseManifest(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')), id);
        for (const pose of Object.values(manifest.poses)) {
          if (typeof pose === 'string') continue;
          const { w, h } = pngSize(path.join(dir, pose.sheet));
          const columns = Math.floor(w / pose.frameWidth);
          const rows = Math.floor(h / pose.frameHeight);
          expect(columns).toBeGreaterThan(0);
          expect(rows).toBeGreaterThan(0);
          expect(columns * rows, `${pose.sheet} holds ${columns * rows} frames`).toBeGreaterThanOrEqual(pose.count);
        }
      });

      it('stays small enough to bundle', () => {
        const bytes = readdirSync(dir).reduce((sum, f) => sum + statSync(path.join(dir, f)).size, 0);
        expect(bytes).toBeLessThan(4 * 1024 * 1024);
      });
    });
  }
});
