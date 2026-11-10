import { app } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isSceneId, parseSceneManifest, sceneFiles, type SceneInfo, type SceneManifest } from '../shared/scene';
import { skinTitle, type Lang } from '../shared/skin-name';
import { language } from './i18n';
import { log } from './log';
import { safeJoin } from './safe-path';

/** Scenes put here by the user (they survive updates). The app ships none: a scene is the user's own picture and sound. */
export const userScenesDir = (): string => path.join(app.getPath('userData'), 'scenes');

/** `rel` is "<scene id>/<file>". */
export async function resolveSceneFile(rel: string): Promise<string | null> {
  if (!isSceneId(rel.split('/')[0])) return null;
  const file = safeJoin(userScenesDir(), rel);
  if (!file) return null;
  try {
    return (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

/** A scene folder as it can be played: scene.json read and checked, and every file it names there. Throws what is wrong with it. */
export async function readScene(id: string): Promise<SceneManifest> {
  if (!isSceneId(id)) throw new Error(`"${id}" is not a name of a scene folder`);
  const dir = path.join(userScenesDir(), id);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(dir, 'scene.json'), 'utf8'));
  } catch (err) {
    throw new Error(`scene "${id}": scene.json could not be read (${err instanceof Error ? err.message : String(err)})`);
  }
  const manifest = parseSceneManifest(raw, id);
  for (const file of sceneFiles(manifest)) {
    const full = safeJoin(dir, file);
    if (!full || !(await stat(full).then((s) => s.isFile(), () => false))) throw new Error(`scene "${id}": the file "${file}" is not there`);
  }
  return manifest;
}

/** What went wrong with a scene folder has been written in the log already (the menu is built often; each problem is told once). */
const told = new Set<string>();

/** The scenes that can be played, by name. A folder that is not one, or has something wrong in it, is left out (and said once in the log). */
export async function listScenes(lang: Lang = language()): Promise<SceneInfo[]> {
  let entries;
  try {
    entries = await readdir(userScenesDir(), { withFileTypes: true });
  } catch {
    return [];
  }
  const found: SceneInfo[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !isSceneId(e.name)) continue;
    try {
      const manifest = await readScene(e.name);
      found.push({ id: e.name, name: skinTitle(manifest, lang, e.name) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // a folder with no scene.json is not meant to be one
      if (/scene\.json could not be read/.test(message) && !existsSync(path.join(userScenesDir(), e.name, 'scene.json'))) continue;
      if (!told.has(message)) {
        told.add(message);
        log('warn', `scenes: ${message}`);
      }
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name, lang));
}

const SCENES_README = `Desktop Buddy scenes
====================

A scene is a short show played over the desktop, with a sound: the characters in it step out of
the screen while it plays and come back when it is over. Put one folder per scene here:

  scenes/
    my-scene/
      scene.json
      scene.webm      (the picture: a video with transparency, VP9 with alpha)
      song.mp3        (the sound, optional)

scene.json:

  {
    "name": "My scene",
    "names": { "ko": "내 장면" },
    "video": "scene.webm",
    "audio": "song.mp3",
    "size": { "w": 640, "h": 360 },
    "anchor": { "x": 0.5, "y": 0.95 },
    "cast": ["usagi"]
  }

The picture is "video" (WebM with transparency; a video of another kind plays with its background),
or "picture": a file name or a sprite sheet like the poses of a skin (png, apng, gif, webp):

  "picture": { "sheet": "scene.png", "frameWidth": 320, "frameHeight": 180, "count": 48, "durations": 50 }

"audio" is the sound. Without it a video plays its own sound; a picture is silent. "offsetMs" is how many
milliseconds after the picture the sound starts (negative: before it). The picture is kept in step with the
sound while it plays.

"size" is how big the picture is at normal size, in pixels (it is fitted into that, bottom-centred), "anchor"
where its feet are as fractions of that (it stands on the floor there), "cast" the characters (folder names
of skins) whose pets are not on the screen while it plays, "volume" how loud it is (0 to 1, on top of the
volume in the tray), "maxMs" the longest it may take. A click on the picture ends it.

Start a scene from the tray menu: Scenes. The sound is set there as well.

장면 폴더 사용법
================
장면은 소리와 함께 바탕화면 위에서 보여 주는 짧은 공연입니다. 나오는 캐릭터(cast)의 펫은 장면이 도는
동안 화면에서 빠졌다가 끝나면 돌아옵니다. 장면마다 폴더를 만들고 scene.json과 파일을 넣으면 됩니다.
그림은 "video"(투명도가 있는 WebM)이거나 "picture"(스킨의 포즈처럼 이미지 파일이나 스프라이트 시트)이고,
소리는 "audio"입니다. 없으면 영상은 자기 소리를 내고 그림만 있으면 소리가 없습니다. 그림은 소리에 맞춰
어긋나지 않게 재생됩니다. 트레이 메뉴의 "장면"에서 시작하고 소리 크기도 거기서 고릅니다.
이 폴더에는 직접 만들었거나 쓸 권리가 있는 그림과 소리만 넣는 것을 권합니다.
`;

/** Creates the folder for scenes with a short how-to, so that "open scenes folder" is not an empty mystery. */
export function ensureUserScenesDir(): void {
  const dir = userScenesDir();
  mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, 'README.txt');
  if (!existsSync(readme)) writeFileSync(readme, SCENES_README);
}
