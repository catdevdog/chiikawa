import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { forPartner } from '../src/engine/speech';
import { SAY_EVENTS } from '../src/engine/types';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import { parseManifest, poseFiles } from '../src/shared/manifest';

const ROOT = path.resolve(__dirname, '..');

/** The characters of the show that ship with the app (the original mascot is not one of them). */
const CAST = ['chiikawa', 'hachiware', 'usagi', 'rakko'];

/** The skins the installer ships: every `from: skins/<id>` entry of electron-builder.yml. */
const bundled = [...readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8').matchAll(/from:\s*skins\/([\w.-]+)/g)].map((m) => m[1]!);

/** What each of them is called in Korean: nobody in the show calls anybody by name, so no line may say one. */
const NAMES = bundled.map((id) => JSON.parse(readFileSync(path.join(ROOT, 'skins', id, 'manifest.json'), 'utf8')).names?.ko as string).filter(Boolean);

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

      it('has a Korean name for the menu, and a plain one for everywhere else', () => {
        const manifest = parseManifest(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')), id);
        expect(manifest.name, `${id}: name`).toBeTruthy();
        expect(manifest.names?.ko, `${id}: names.ko`).toMatch(/^[가-힣]+$/);
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

      it('has lines that are all kept (nothing is dropped as malformed) and a good text colour', () => {
        const raw = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
        const manifest = parseManifest(raw, id);
        const kept: Record<string, unknown[]> = manifest.lines ?? {};
        for (const [event, list] of Object.entries<unknown[]>(raw.lines ?? {})) {
          expect(Object.keys(kept), `${id}: lines.${event} is not a known situation or is empty`).toContain(event);
          expect(kept[event]!.length, `${id}: lines.${event}`).toBe(list.length);
        }
        if (raw.textColor !== undefined) expect(manifest.textColor).toBe(raw.textColor);
      });

      it('has actions that are all kept (each has a pose the skin has) and a few words for most of them', () => {
        const raw = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
        const manifest = parseManifest(raw, id);
        expect(Object.keys(manifest.actions ?? {}), `${id}: an action was dropped as malformed`).toEqual(Object.keys(raw.actions ?? {}));
        for (const [name, action] of Object.entries(manifest.actions ?? {})) {
          expect(manifest.poses[action.pose], `${id}: action ${name} needs the pose ${action.pose}`).toBeTruthy();
          expect(action.lines.length, `${id}: action ${name} says nothing`).toBeGreaterThan(0);
          // the picture may be a pose that is also used for a state (a cheer in the colours of a landing)
          expect(action.ms, `${id}: action ${name}`).toBeGreaterThanOrEqual(1500);
        }
      });

      it('has something to say in every situation', () => {
        const manifest = parseManifest(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')), id);
        for (const event of SAY_EVENTS) expect(manifest.lines?.[event]?.length ?? 0, `${id}: lines.${event}`).toBeGreaterThan(0);
      });

      it('can greet and answer any friend, and has words of its own for the characters it knows', () => {
        const manifest = parseManifest(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')), id);
        for (const event of ['meet', 'reply'] as const) {
          const list = manifest.lines?.[event] ?? [];
          // a friend this skin has no words for (a skin somebody made) still gets a greeting
          expect(list.filter((l) => !l.with).length, `${id}: lines.${event} for anyone`).toBeGreaterThan(0);
          // words for a friend are for a character that exists, and never for the skin itself
          for (const l of list) {
            for (const friend of l.with ?? []) {
              expect(bundled, `${id}: lines.${event} "${l.text}" is for ${friend}`).toContain(friend);
              expect(friend, `${id}: lines.${event} "${l.text}" is for itself`).not.toBe(id);
            }
          }
          // the four characters of the show talk to each other in their own words
          if (CAST.includes(id)) {
            for (const friend of CAST.filter((c) => c !== id)) {
              expect(forPartner(list, friend).some((l) => l.with), `${id}: lines.${event} for ${friend}`).toBe(true);
            }
          }
        }
      });

      it('has a picture of its own for hiding at a wall (a tilted face and the hands), and its sheet has all of its frames', () => {
        const manifest = parseManifest(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')), id);
        const peek = manifest.poses.peek;
        expect(peek, `${id}: poses.peek`).toBeTruthy();
        if (typeof peek === 'object') {
          const idle = manifest.poses.idle;
          // it moves like the ordinary picture does (it blinks when that blinks)
          if (typeof idle === 'object') expect(peek.count, `${id}: peek frames`).toBe(idle.count);
        }
      });

      it('never calls anybody by name', () => {
        const raw = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
        const said: string[] = Object.values<unknown[]>(raw.lines ?? {})
          .flat()
          .map((l) => (typeof l === 'string' ? l : (l as { text: string }).text));
        for (const action of Object.values<{ say?: string[] }>(raw.actions ?? {})) said.push(...(action.say ?? []));
        expect(said.length).toBeGreaterThan(0);
        for (const name of NAMES) for (const text of said) expect(text, `${id}: "${text}" says the name ${name}`).not.toContain(name);
      });

      it('stays small enough to bundle', () => {
        const bytes = readdirSync(dir).reduce((sum, f) => sum + statSync(path.join(dir, f)).size, 0);
        expect(bytes).toBeLessThan(4 * 1024 * 1024);
      });
    });
  }
});
