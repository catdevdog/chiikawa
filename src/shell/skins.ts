import { app } from 'electron';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isSkinId } from '../shared/ids';
import type { SkinInfo } from '../shared/types';
import { safeJoin } from './safe-path';

/** Skin packs installed by the user (survive updates). */
export const userSkinsDir = (): string => path.join(app.getPath('userData'), 'skins');

/** Skins that ship with the app. */
export const bundledSkinsDir = (): string =>
  app.isPackaged ? path.join(process.resourcesPath, 'skins') : path.join(app.getAppPath(), 'skins');

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.apng': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

/** `rel` is "<skin id>/<file>"; user skins win over bundled ones with the same id. */
export async function resolveSkinFile(rel: string): Promise<string | null> {
  if (!isSkinId(rel.split('/')[0])) return null;
  for (const base of [userSkinsDir(), bundledSkinsDir()]) {
    const file = safeJoin(base, rel);
    if (!file) continue;
    try {
      if ((await stat(file)).isFile()) return file;
    } catch {
      // try the next location
    }
  }
  return null;
}

export async function listSkins(): Promise<SkinInfo[]> {
  const found = new Map<string, SkinInfo>();
  for (const [dir, builtin] of [
    [bundledSkinsDir(), true],
    [userSkinsDir(), false],
  ] as const) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || !isSkinId(e.name)) continue;
      try {
        const manifest = JSON.parse(await readFile(path.join(dir, e.name, 'manifest.json'), 'utf8'));
        found.set(e.name, { id: e.name, name: typeof manifest.name === 'string' ? manifest.name : e.name, builtin });
      } catch {
        // not a skin folder
      }
    }
  }
  return [...found.values()];
}

const SKINS_README = `Desktop Buddy skin packs
========================

Put one folder per skin here:

  skins/
    my-skin/
      manifest.json
      idle.png        (required)
      happy.gif ...   (optional)

manifest.json:

  {
    "name": "My skin",
    "size": { "w": 128, "h": 128 },
    "anchor": { "x": 0.5, "y": 0.94 },
    "hitbox": { "x": 0.17, "y": 0.1, "w": 0.66, "h": 0.81 },
    "poses": { "idle": "idle.png", "happy": "happy.gif" }
  }

Poses: idle (required), walk, run, sit, sleep, held, fall, land, surprised, happy.
A missing pose falls back to a related one, and finally to idle.
Supported files: png, apng, gif, webp, svg. Pick the skin from the tray menu.

스킨 폴더 사용법
================
위처럼 스킨마다 폴더를 만들고 manifest.json과 이미지(idle은 필수)를 넣으세요.
없는 포즈는 비슷한 포즈로, 최종적으로는 idle로 대체됩니다.
트레이 메뉴에서 캐릭터(스킨)를 고를 수 있어요.
`;

/** Creates the user skin folder with a short how-to so "open skin folder" is not an empty mystery. */
export function ensureUserSkinsDir(): void {
  const dir = userSkinsDir();
  mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, 'README.txt');
  if (!existsSync(readme)) writeFileSync(readme, SKINS_README);
}
