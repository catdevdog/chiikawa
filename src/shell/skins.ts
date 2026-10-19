import { app } from 'electron';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isSkinId } from '../shared/ids';
import { skinTitle, type Lang } from '../shared/skin-name';
import { sortSkins } from '../shared/skin-order';
import type { SkinInfo } from '../shared/types';
import { language } from './i18n';
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

/** The skins on offer, named in `lang` where the skin knows its name in that language. */
export async function listSkins(lang: Lang = language()): Promise<SkinInfo[]> {
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
        found.set(e.name, { id: e.name, name: skinTitle(manifest, lang, e.name), builtin });
      } catch {
        // not a skin folder
      }
    }
  }
  return sortSkins([...found.values()]);
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

The menu shows "name". To show another name when the app speaks Korean, add
  "names": { "ko": "토끼" }

Words (optional): what the pet says, by situation. Short sounds rise and fade like the z's,
sentences stay above the head for a moment. A line with a space and more than a few letters
counts as a sentence; "style" ("float" or "hold") decides it by hand.

  "textColor": "#d4891a",
  "lines": {
    "click": ["Eek!", { "text": "Hey, that tickles!", "style": "hold" }],
    "sleep": ["zZz"]
  }

Situations: start, hover, click, rub, triple, pickup, throw, land, flee, follow, attach,
idle, sit, sleep, wake, cross (walking over to another monitor), call (called over with the
tray or Ctrl+Alt+Shift+C), welcome (the user is back: unlock, wake from sleep), plug, unplug
(the charger goes in or out), lowBattery.

스킨 폴더 사용법
================
위처럼 스킨마다 폴더를 만들고 manifest.json과 이미지(idle은 필수)를 넣으세요.
없는 포즈는 비슷한 포즈로, 최종적으로는 idle로 대체됩니다.
트레이 메뉴에서 캐릭터(스킨)를 고를 수 있어요. 메뉴에는 "name"이 보이고, 한국어 이름을 따로
보이고 싶으면 "names": { "ko": "토끼" }를 넣으세요.

대사(선택): manifest.json에 "lines"를 넣으면 상황마다 말을 해요. 짧은 소리는 z처럼 위로
떠올랐다 사라지고, 문장은 머리 위에 잠깐 떠 있다 사라져요. "style"("float"/"hold")로 직접 정할
수 있고, 글자 색은 "textColor"예요. 상황: start, hover, click, rub, triple, pickup, throw, land,
flee, follow, attach, idle, sit, sleep, wake, cross(다른 모니터로 건너갈 때), call(불렀을 때),
welcome(자리로 돌아왔을 때: 잠금 해제·절전 복귀), plug·unplug(충전기를 꽂고 뺄 때), lowBattery(배터리 부족).
트레이 메뉴 "대사"에서 끄거나 반응할 때만 말하게 할 수 있어요.
`;

/** Creates the user skin folder with a short how-to so "open skin folder" is not an empty mystery. */
export function ensureUserSkinsDir(): void {
  const dir = userSkinsDir();
  mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, 'README.txt');
  if (!existsSync(readme)) writeFileSync(readme, SKINS_README);
}
