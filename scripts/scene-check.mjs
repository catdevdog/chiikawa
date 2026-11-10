// Run after `npm run build` (the build workflow does, on Windows): the app itself (not packaged, so that its test hooks are there) is given
// a scene of made-up pictures and a made-up sound, and what the overlay really paints is looked at: a video with transparency has to be
// painted with its transparency (a disc and a square, and nothing else, on a canvas the desktop shows through), the picture has to keep
// together with the sound, the main character that acts in it has to step out, and the scene has to end by itself, with a pet back on the
// screen. It only tells. The picture is tests/fixtures/scene-alpha.webm (320 x 180, 2 s: a grey disc that moves to the right, and a white
// square in the corner that is there for the first quarter of every second); it was made with
//   ffmpeg -f lavfi -i "color=c=black@0:s=320x180:r=24:d=2,format=yuva444p,geq=lum='if(lt(hypot(X-(50+110*T)\,Y-130)\,25)\,150\,if(lt(X\,30)*lt(Y\,30)*lt(mod(T\,1)\,0.25)\,235\,16))':cb=128:cr=128:a='if(lt(hypot(X-(50+110*T)\,Y-130)\,25)\,255\,if(lt(X\,30)*lt(Y\,30)*lt(mod(T\,1)\,0.25)\,255\,0))',format=yuva420p" -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 34 -auto-alt-ref 0 scene-alpha.webm
// and the sound (a beep at the start of every second, 2.4 s: longer than the picture) is written here.
//   node scripts/scene-check.mjs
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright-core');
const electronPath = require('electron');
const root = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`);
};
async function waitFor(fn, timeout = 8000, step = 50) {
  const from = Date.now();
  for (;;) {
    const v = await fn();
    if (v || Date.now() - from > timeout) return v;
    await sleep(step);
  }
}

/** 16-bit mono PCM: a 660 Hz beep for the first quarter of every second. */
function beeps(seconds, rate = 22050) {
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    buf.writeInt16LE(Math.round((t % 1 < 0.25 ? Math.sin(2 * Math.PI * 660 * t) * 0.3 : 0) * 32767), 44 + i * 2);
  }
  return buf;
}

const userData = mkdtempSync(path.join(os.tmpdir(), 'buddy-scene-'));
const dir = path.join(userData, 'scenes', 'check');
mkdirSync(dir, { recursive: true });
copyFileSync(path.join(root, 'tests', 'fixtures', 'scene-alpha.webm'), path.join(dir, 'scene.webm'));
writeFileSync(path.join(dir, 'song.wav'), beeps(2.4));
writeFileSync(path.join(dir, 'scene.json'), JSON.stringify({ name: 'Check', video: 'scene.webm', audio: 'song.wav', size: { w: 320, h: 180 }, anchor: { x: 0.5, y: 0.95 }, cast: ['usagi'] }));
writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ skin: 'usagi', friends: [], mode: 'wander', roam: 'floor', speech: 'off', tricks: false, windows: false, volume: 0.6 }));

const args = ['.', '--disable-gpu', `--user-data-dir=${userData}`, '--lang=ko', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])];
const app = await electron.launch({ executablePath: electronPath, args, env: { ...process.env, BUDDY_TEST: '1' }, cwd: root });
const T = (fn, ...a) => app.evaluate((_, [name, rest]) => globalThis.__buddyTest[name](...rest), [fn, a]);
const SC = (fn, ...a) => app.evaluate((_, [name, rest]) => globalThis.__buddyTest.scene[name](...rest), [fn, a]);
const logText = () => (existsSync(path.join(userData, 'buddy.log')) ? readFileSync(path.join(userData, 'buddy.log'), 'utf8') : '');

try {
  await waitFor(() => app.evaluate(() => !!globalThis.__buddyTest?.view()).catch(() => false), 40000, 200);
  const page = await waitFor(() => app.windows().find((w) => w.url().startsWith('buddy://app/index.html')), 15000);
  check('the app is up, with an overlay', !!page);
  const area = (await T('windows'))[0].area;
  check('the scene is on offer', (await SC('list')).some((s) => s.id === 'check'), JSON.stringify(await SC('list')));

  check('it is started', (await SC('play', 'check')) === true);
  const playing = await waitFor(async () => (await SC('state'))?.phase === 'playing', 15000);
  check('the overlay gets the picture and the sound ready and says that it plays', !!playing, JSON.stringify(await SC('state')));
  check('the main character, which acts in it, steps out', JSON.stringify(await SC('offstage')) === JSON.stringify(['usagi']));
  const rect = (await SC('state'))?.rect;
  if (!rect) throw new Error('there is no scene to look at');

  const px = (x, y) =>
    page.evaluate(([x, y]) => {
      const c = document.getElementById('stage');
      const d = c.width / c.clientWidth;
      return Array.from(c.getContext('2d').getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data);
    }, [x - area.x, y - area.y]);
  const where = () => page.evaluate(() => window.__buddyScene.debug());

  let disc = 0, discOf = 0, clear = 0, clearOf = 0, flash = 0, flashOf = 0, dark = 0, darkOf = 0;
  const drifts = [];
  const from = Date.now();
  while (Date.now() - from < 2600) {
    const d = await where();
    if (!d) break;
    if (d.videoMs !== null && d.audioMs !== null && d.audioMs > 400 && d.videoMs < 1900) drifts.push(d.videoMs - d.audioMs);
    const ms = d.pictureMs;
    if (ms > 150 && ms < 1850) {
      const p = await px(rect.x + 50 + 110 * (ms / 1000), rect.y + 130);
      discOf++;
      if (p[3] === 255 && Math.abs(p[0] - 150) < 40) disc++;
      const q = await px(rect.x + 290, rect.y + 20);
      clearOf++;
      if (q[3] === 0) clear++;
      const mod = ms % 1000;
      if (mod > 330 && mod < 900) {
        darkOf++;
        if ((await px(rect.x + 10, rect.y + 10))[3] === 0) dark++;
      } else if (mod > 60 && mod < 200) {
        flashOf++;
        const f = await px(rect.x + 10, rect.y + 10);
        if (f[3] === 255 && f[0] > 200) flash++;
      }
    }
    await sleep(60);
  }
  check('the disc is painted where the picture time says it is, with its colour', discOf > 8 && disc / discOf > 0.8, `${disc}/${discOf}`);
  check('the rest of the picture is transparent in the canvas (alpha 0)', clearOf > 8 && clear / clearOf > 0.95, `${clear}/${clearOf}`);
  check('the square is there for the first quarter of every second and gone after it', flashOf > 1 && flash / flashOf > 0.7 && darkOf > 3 && dark / darkOf > 0.7, `there ${flash}/${flashOf}, gone ${dark}/${darkOf}`);
  const worst = drifts.length ? Math.max(...drifts.map(Math.abs)) : Number.NaN;
  check('the video keeps together with the sound (never more than 150 ms apart)', drifts.length > 8 && worst < 150, `${drifts.length} samples, worst ${Math.round(worst)} ms`);

  const ended = await waitFor(async () => (await SC('state')) === null, 8000);
  check('the scene ends by itself, when the sound (the longer of the two) is over', !!ended, JSON.stringify(await SC('state')));
  check('the character is back on the screen', JSON.stringify(await SC('offstage')) === '[]' && (await T('views')).some((v) => v.id === 'usagi'));
  const log = logText();
  check('the log says that it was shown and that it is over', /scene check plays/.test(log) && /scene check is over/.test(log), log.split('\n').filter((l) => /scene/.test(l)).slice(-4).join(' | '));
} catch (err) {
  check('the check itself went through', false, String(err?.stack ?? err));
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await app.close().catch(() => {});
  process.exit(failed.length ? 1 : 0);
}
