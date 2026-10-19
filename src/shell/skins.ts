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
(the charger goes in or out), lowBattery, meet (greeting a friend that came close), reply (answering
a friend's greeting), peek (talking to itself while it hides), found (found while it hides). The
words for triple (three clicks) are said as the pet runs off to hide.

meet and reply lines can be meant for one friend only, by the folder name of its skin:
  "meet": ["Hi!", { "text": "Oh, it's you!", "with": ["usagi"] }]
Lines meant for the friend that is met are used when there are any; otherwise the lines without "with".

Hiding (optional): three clicks on a pet send every pet to the nearest edge of the screens, where each
peeks out with only a part of its face and its hands in view until one of them is clicked. A skin may
draw that itself, as the pose "peek" in "poses"; without one the ordinary picture leans towards the wall.
Draw it as if a wall stood against the back of the picture, the side the artwork does not face (the right
side when "facing" is "left"): the picture is cut there, and what shows reaches out from it, a face tilted
towards the wall and the hands holding the edge. Make it as big as the other poses, with as many frames as
"idle" has, and the blinking goes on in it as well.

Actions (optional): short shows with pictures of their own, now and then or for a situation.
Put the pictures in "poses" and list them:

  "actions": {
    "camera": { "pose": "camera", "ms": 3600, "motion": "still", "say": ["Say cheese!"] },
    "cheer": { "pose": "cheer", "on": ["welcome", "plug"] }
  }

"ms" is how long (800-20000), "weight" how often compared with the others, "motion" what is done with a still
picture ("bounce", "sway", "still", or "off" for a picture that moves itself), "on" the situations (welcome, plug,
unplug, lowBattery, call) that do it instead of the plain reaction. The skin maker makes these from "Trick 1-4".

스킨 폴더 사용법
================
위와 같이 스킨마다 폴더를 만들고 manifest.json과 이미지(idle은 필수)를 넣으면 됩니다.
없는 포즈는 비슷한 포즈로, 최종적으로는 idle로 대체됩니다.
트레이 메뉴에서 캐릭터(스킨)를 고를 수 있습니다. 메뉴에는 "name"이 보이고, 한국어 이름을 따로
보이게 하려면 "names": { "ko": "토끼" }를 넣으면 됩니다.

대사(선택): manifest.json에 "lines"를 넣으면 상황마다 말을 합니다. 짧은 소리는 z처럼 위로
떠올랐다 사라지고, 문장은 머리 위에 잠깐 떠 있다 사라집니다. "style"("float" 또는 "hold")로 직접 정할
수 있고, 글자 색은 "textColor"입니다. 상황은 start, hover, click, rub, triple, pickup, throw, land,
flee, follow, attach, idle, sit, sleep, wake, cross(다른 모니터로 건너갈 때), call(불렀을 때),
welcome(자리로 돌아왔을 때로, 잠금 해제와 절전 복귀가 해당됩니다), plug와 unplug(충전기를 꽂고 뺄 때), lowBattery(배터리 부족),
meet(다가온 친구에게 하는 인사), reply(친구의 인사에 하는 대답), peek(벽에 숨어서 하는 혼잣말),
found(숨어 있다가 들켰을 때)입니다. triple(세 번 클릭)은 숨으러 달려갈 때 하는 말입니다.
meet와 reply 줄에 "with": ["usagi"]처럼 친구 스킨의 폴더 이름을 적으면 그 친구에게만 하는 말이 됩니다. 그 친구를 위한
줄이 있으면 그 줄만 쓰고, 없으면 "with"가 없는 줄을 씁니다.
트레이 메뉴의 "대사"에서 끄거나 반응할 때만 말하게 할 수 있습니다.

숨기(선택): 펫을 세 번 클릭하면 모든 펫이 화면의 가장 가까운 가장자리로 가서 얼굴 일부와 손만 내밀고
숨습니다. 숨은 펫 가운데 하나를 클릭하면 모두 나옵니다. "poses"에 "peek" 포즈를 넣으면 그 그림으로 숨고,
없으면 기본 그림이 벽 쪽으로 기울어집니다. 그림은 그림이 바라보는 쪽의 반대편에 벽이 있다고 보고 그립니다
("facing"이 "left"이면 오른쪽입니다). 그 가장자리에서 그림이 잘려 있어야 하고, 보이는 부분은 거기서부터
나옵니다. 벽 쪽으로 기울인 얼굴과 벽을 잡은 손을 그리면 됩니다. 크기는 다른 포즈와 같게, 프레임 수는
"idle"과 같게 하면 눈 깜빡임도 같이 움직입니다.

재롱(선택): "actions"에 적으면 펫이 가끔, 또는 어떤 상황에서 그림으로 짧은 행동을 합니다. 그림은 "poses"에
다른 포즈처럼 넣고 이렇게 적습니다: "actions": { "camera": { "pose": "camera", "ms": 3600, "motion": "still",
"say": ["찰칵!"] } }. ms는 길이(800~20000), weight는 확률의 비율, motion은 정지 그림을 움직이는 방법
(bounce, sway, still, 그림이 스스로 움직이면 off), on은 일반 반응 대신 이 재롱을 하는 상황(welcome, plug,
unplug, lowBattery, call)입니다. 스킨 메이커에서는 포즈를 "재롱 1~4"로 고르면 만들어집니다.
`;

/** Creates the user skin folder with a short how-to so "open skin folder" is not an empty mystery. */
export function ensureUserSkinsDir(): void {
  const dir = userSkinsDir();
  mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, 'README.txt');
  if (!existsSync(readme)) writeFileSync(readme, SKINS_README);
}
