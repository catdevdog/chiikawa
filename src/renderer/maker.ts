import { Pet, PET_STATES, type Mode, type PetState } from '../engine';
import {
  assembleSkin,
  buildSkin,
  layoutSkin,
  matchSizes,
  prepareItem,
  skinGeometry,
  type BuiltSkin,
  type ItemInput,
  type Prepared,
} from '../maker/build';
import { ANIM_PRESETS, type AnimPreset, type Rig } from '../maker/animate';
import { guessPose, slugify } from '../maker/guess';
import {
  DEFAULT_BG,
  dominantBorderColor,
  flipHorizontal,
  hasTransparentBorder,
  removeBackground,
  resizeArea,
  type BgOptions,
  type Raster,
  type RGB,
} from '../maker/process';
import { isSkinId } from '../shared/ids';
import { validateSkinPayload } from '../shared/skin-payload';
import { drawScene } from './draw';
import { decodeFile, pickMakerHost, rasterToBitmap, rasterToPng, toImageData } from './maker-io';
import { resolvePose } from './poses';
import { DEFAULT_TEXT_COLOR, Sprite, type Skin } from './skin';

const POSE_LABELS: Record<PetState, string> = {
  idle: '기본 (idle) · 필수',
  walk: '걷기',
  run: '달리기',
  sit: '앉기',
  sleep: '잠자기',
  held: '들렸을 때',
  fall: '떨어지는 중',
  land: '착지',
  surprised: '놀람',
  happy: '기쁨',
};

/** longest side used for the live pet preview and thumbnails; the saved skin is built from the full frames */
const PREVIEW_SIDE = 220;
const STAGE = { width: 380, height: 240 };

type BgMode = 'auto' | 'color' | 'off';
type BgChoice = 'checker' | 'white' | 'black' | 'gray';

interface Item {
  id: number;
  name: string;
  frames: Raster[];
  durations: number[];
  /** frames reduced to PREVIEW_SIDE, for responsive previews */
  small: Raster[];
  smallFactor: number;
  pose: PetState | '';
  /** the user picked this pose (or "unused") by hand, so guessing must leave it alone */
  userSet: boolean;
  bg: { mode: BgMode; key: RGB; tolerance: number; contiguous: boolean; erode: number; feather: number };
  autoKey: RGB | null;
  scale: number;
  /** the size slider was moved by hand, so matching sizes automatically must leave it alone */
  scaleSet: boolean;
  motionOff: boolean;
  flip: boolean;
  /** make a still image move (blinking, swaying ears and tail) */
  anim: AnimPreset | '';
  animAmount: number;
  /** parts of the picture given by hand; no control for it, scripts may set it */
  rig?: Partial<Rig>;
  cache?: { key: string; value: Prepared | null };
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

const host = pickMakerHost();
const items: Item[] = [];
let selected: Item | null = null;
let nextId = 1;
let previewFrame = 0;
let bgChoice: BgChoice = 'checker';
let userEditedId = false;

// --- status ---------------------------------------------------------------------------------------

const statusEl = $('status');
function setStatus(text: string, kind: '' | 'ok' | 'error' = ''): void {
  statusEl.textContent = text;
  statusEl.className = kind;
}

// --- items ----------------------------------------------------------------------------------------

function makeItem(name: string, frames: Raster[], durations: number[]): Item {
  const first = frames[0]!;
  const autoKey = hasTransparentBorder(first) ? null : dominantBorderColor(first);
  const k = Math.min(1, PREVIEW_SIDE / Math.max(first.width, first.height));
  const small = k < 1 ? frames.map((f) => resizeArea(f, f.width * k, f.height * k)) : frames;
  return {
    id: nextId++,
    name,
    frames,
    durations,
    small,
    smallFactor: k,
    pose: '',
    userSet: false,
    bg: {
      mode: autoKey ? 'auto' : 'off',
      key: autoKey ?? [255, 255, 255],
      tolerance: DEFAULT_BG.tolerance,
      contiguous: DEFAULT_BG.contiguous,
      erode: 0,
      feather: 0,
    },
    autoKey,
    scale: 1,
    scaleSet: false,
    motionOff: frames.length > 1,
    flip: false,
    anim: '',
    animAmount: 1,
  };
}

/** A hand-given rig is in full-size pixels; the preview works on smaller copies. */
function scaleRig(rig: Partial<Rig>, k: number): Partial<Rig> {
  const out: Partial<Rig> = {};
  if ('ears' in rig) out.ears = rig.ears ? { top: rig.ears.top * k, base: rig.ears.base * k } : null;
  if ('eyes' in rig) out.eyes = (rig.eyes ?? []).map((e) => ({ x: e.x * k, y: e.y * k, rx: e.rx * k, ry: e.ry * k }));
  if ('tail' in rig) out.tail = rig.tail ? { x: rig.tail.x * k, y: rig.tail.y * k, r: rig.tail.r * k, ax: rig.tail.ax * k, ay: rig.tail.ay * k } : null;
  if ('blades' in rig) out.blades = rig.blades ? { cx: rig.blades.cx * k, top: rig.blades.top * k, bottom: rig.blades.bottom * k } : null;
  return out;
}

/** Which way ears and tail stream when running: toward +x unless the artwork faces right. */
const backward = (): 1 | -1 => ($<HTMLSelectElement>('facing').value === 'left' ? 1 : -1);

function bgOptions(it: Item, factor: number): BgOptions | null {
  if (it.bg.mode === 'off') return null;
  const key = it.bg.mode === 'auto' ? it.autoKey : it.bg.key;
  if (!key) return null;
  // px settings are defined on the full-size frames; the small copies need proportionally less
  const px = (n: number): number => (n > 0 ? Math.max(1, Math.round(n * factor)) : 0);
  return { key, tolerance: it.bg.tolerance, contiguous: it.bg.contiguous, erode: px(it.bg.erode), feather: px(it.bg.feather) };
}

const toInput = (it: Item, full: boolean): ItemInput => ({
  pose: it.pose as PetState,
  frames: full ? it.frames : it.small,
  durations: it.durations,
  bg: bgOptions(it, full ? 1 : it.smallFactor),
  scale: it.scale,
  motionOff: it.motionOff,
  flip: it.flip,
  anim:
    it.anim && it.frames.length === 1
      ? { preset: it.anim, amount: it.animAmount, back: backward(), ...(it.rig ? { rig: full ? it.rig : scaleRig(it.rig, it.smallFactor) } : {}) }
      : undefined,
});

/** Background removal and movement at preview size, remembered until those settings change. */
function cachedPrepared(it: Item): Prepared | null {
  const bg = bgOptions(it, it.smallFactor);
  const key = JSON.stringify([bg, it.flip, it.anim, it.animAmount, backward(), it.rig ?? null]);
  if (it.cache?.key !== key) {
    it.cache = { key, value: prepareItem({ ...toInput(it, false), pose: 'idle', scale: 1, motionOff: false }, 24) };
  }
  return it.cache.value;
}

const isDup = (it: Item): boolean => !!it.pose && items.filter((o) => o.pose === it.pose).length > 1;

function assignDefaults(): void {
  const used = new Set(items.map((i) => i.pose).filter(Boolean));
  for (const it of items) {
    if (it.pose || it.userSet) continue;
    const guess = guessPose(it.name);
    if (guess && !used.has(guess)) {
      it.pose = guess;
      used.add(guess);
    }
  }
  if (!used.has('idle')) {
    const first = items.find((i) => !i.pose && !i.userSet);
    if (first) first.pose = 'idle';
  }
}

async function addFiles(files: File[]): Promise<void> {
  const images = files.filter((f) => f.type.startsWith('image/') || /\.(png|gif|webp|apng|jpe?g|avif)$/i.test(f.name));
  if (images.length === 0) return setStatus('이미지 파일이 아니에요.', 'error');
  setStatus(`${images.length}개 불러오는 중…`);
  for (const file of images) {
    try {
      const { frames, durations } = await decodeFile(file);
      items.push(makeItem(file.name, frames, durations));
    } catch (err) {
      setStatus(`${file.name}: ${msg(err)}`, 'error');
    }
  }
  autoSize();
  assignDefaults();
  if (!selected && items.length) select(items[0]!);
  renderList();
  refreshEditor();
  schedulePreview();
  setStatus(`이미지 ${items.length}개`);
}

/** Sizes copies of the same artwork alike (see `matchSizes`), except images whose size was set by hand. */
function autoSize(): void {
  const scales = matchSizes(items.map((it) => ({ w: it.frames[0]!.width, h: it.frames[0]!.height })));
  items.forEach((it, i) => {
    if (!it.scaleSet) it.scale = scales[i]!;
  });
}

// --- list ------------------------------------------------------------------------------------------

const itemsEl = $('items');

function renderList(): void {
  itemsEl.replaceChildren(...items.map(renderItem));
}

function renderItem(it: Item): HTMLLIElement {
  const li = document.createElement('li');
  li.className = `item${it === selected ? ' sel' : ''}${isDup(it) ? ' dup' : ''}`;
  li.dataset.id = String(it.id);
  if (isDup(it)) li.title = '같은 포즈가 두 개예요. 하나만 쓸 수 있어요.';

  const box = document.createElement('div');
  box.className = 'thumbBox';
  const thumb = document.createElement('canvas');
  thumb.className = 'thumb';
  box.append(thumb);

  const meta = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = it.name;
  name.title = it.name;
  const info = document.createElement('div');
  info.className = 'hint';
  const modeLabel = { auto: '배경 자동', color: '배경 색 지정', off: '배경 그대로' }[it.bg.mode];
  const sizeLabel = Math.abs(it.scale - 1) > 0.005 ? ` · 크기 ${Math.round(it.scale * 100)}%` : '';
  const made = it.anim && it.frames.length === 1 && cachedPrepared(it)?.moves ? ' · 움직임 넣음' : '';
  info.textContent = `${it.frames.length > 1 ? `움직임 ${it.frames.length}프레임` : '정지 이미지'} · ${modeLabel}${sizeLabel}${it.flip ? ' · 반전' : ''}${made}`;
  meta.append(name, info);

  const bar = document.createElement('div');
  bar.className = 'bar';
  const poseSelect = document.createElement('select');
  poseSelect.setAttribute('aria-label', `${it.name} 포즈`);
  poseSelect.append(new Option('사용 안 함', ''));
  for (const p of PET_STATES) poseSelect.append(new Option(POSE_LABELS[p], p));
  poseSelect.value = it.pose;
  poseSelect.addEventListener('click', (e) => e.stopPropagation());
  poseSelect.addEventListener('change', () => {
    it.pose = poseSelect.value as PetState | '';
    it.userSet = true;
    renderList();
    schedulePreview();
  });
  const del = document.createElement('button');
  del.textContent = '✕';
  del.title = '목록에서 지우기';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    items.splice(items.indexOf(it), 1);
    autoSize();
    if (selected === it) select(items[0] ?? null);
    renderList();
    refreshEditor();
    schedulePreview();
  });
  bar.append(poseSelect, del);

  li.append(box, meta, bar);
  li.addEventListener('click', () => {
    select(it);
    renderList();
    refreshEditor();
  });

  const p = cachedPrepared(it);
  const frame = p?.frames[0] ?? it.small[0]!;
  paintRaster(thumb, frame, 'checker', 52);
  return li;
}

function select(it: Item | null): void {
  selected = it;
  previewFrame = 0;
}

// --- editor ----------------------------------------------------------------------------------------

const before = $<HTMLCanvasElement>('before');
const after = $<HTMLCanvasElement>('after');
const editor = $('editor');
const editorEmpty = $('editorEmpty');
const tolerance = $<HTMLInputElement>('tolerance');
const erode = $<HTMLInputElement>('erode');
const feather = $<HTMLInputElement>('feather');
const contiguous = $<HTMLInputElement>('contiguous');
const keyColor = $<HTMLInputElement>('keyColor');
const scale = $<HTMLInputElement>('scale');
const motionOff = $<HTMLInputElement>('motionOff');
const flip = $<HTMLInputElement>('flip');
const anim = $<HTMLSelectElement>('anim');
const animAmount = $<HTMLInputElement>('animAmount');
const frameRow = $('frameRow');
const frameInput = $<HTMLInputElement>('frame');
const modeRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="bgmode"]')];

const hex = (c: RGB): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const fromHex = (s: string): RGB => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;

function paintRaster(canvas: HTMLCanvasElement, r: Raster, bg: BgChoice, maxSide: number): void {
  const k = Math.min(1, maxSide / Math.max(r.width, r.height));
  canvas.width = r.width;
  canvas.height = r.height;
  canvas.style.width = `${Math.round(r.width * k)}px`;
  canvas.style.height = 'auto';
  const ctx = canvas.getContext('2d')!;
  if (bg === 'checker') {
    const s = Math.max(2, Math.round(10 / k));
    for (let y = 0; y * s < r.height; y++) {
      for (let x = 0; x * s < r.width; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#e9edf4' : '#c9d0dc';
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
  } else {
    ctx.fillStyle = { white: '#ffffff', black: '#000000', gray: '#7a8190' }[bg];
    ctx.fillRect(0, 0, r.width, r.height);
  }
  const tmp = new OffscreenCanvas(r.width, r.height);
  tmp.getContext('2d')!.putImageData(toImageData(r), 0, 0);
  ctx.drawImage(tmp, 0, 0);
}

function refreshEditor(): void {
  const it = selected;
  editor.hidden = !it;
  editorEmpty.hidden = !!it;
  if (!it) return;
  for (const r of modeRadios) r.checked = r.value === it.bg.mode;
  // "auto" needs a detectable flat border colour
  modeRadios.find((r) => r.value === 'auto')!.disabled = !it.autoKey;
  keyColor.value = hex(it.bg.mode === 'auto' && it.autoKey ? it.autoKey : it.bg.key);
  tolerance.value = String(it.bg.tolerance);
  erode.value = String(it.bg.erode);
  feather.value = String(it.bg.feather);
  contiguous.checked = it.bg.contiguous;
  scale.value = String(Math.round(it.scale * 100));
  motionOff.checked = it.motionOff;
  motionOff.disabled = it.frames.length < 2;
  flip.checked = it.flip;
  anim.value = it.anim;
  anim.disabled = it.frames.length > 1;
  animAmount.value = String(Math.round(it.animAmount * 100));
  animAmount.disabled = !it.anim || it.frames.length > 1;
  $('animAmountVal').textContent = `${Math.round(it.animAmount * 100)}%`;
  showAnimInfo(it);
  frameRow.hidden = it.frames.length < 2;
  frameInput.max = String(it.frames.length - 1);
  frameInput.value = String(previewFrame);
  $('frameLabel').textContent = `${previewFrame + 1} / ${it.frames.length}`;
  $('toleranceVal').textContent = String(it.bg.tolerance);
  $('erodeVal').textContent = String(it.bg.erode);
  $('featherVal').textContent = String(it.bg.feather);
  $('scaleVal').textContent = `${Math.round(it.scale * 100)}%`;
  paintEditor();
}

/** Tells what the movement found to move, so a picture that stays still does not look like a bug. */
function showAnimInfo(it: Item): void {
  const el = $('animInfo');
  if (it.frames.length > 1) {
    el.textContent = '이미 움직이는 이미지라서 따로 넣지 않아요.';
    return;
  }
  if (!it.anim) {
    el.textContent = '정지 이미지에 눈 깜빡임, 귀·꼬리 흔들림을 코드로 넣어요. 그림은 그대로고 몸에서 해당 부분만 살짝 움직여요.';
    return;
  }
  const moves = cachedPrepared(it)?.moves;
  if (!moves) {
    el.textContent = '움직일 부분(눈·귀·꼬리)을 찾지 못해서 정지 이미지 그대로 써요.';
    return;
  }
  const found = [moves.eyes ? `눈 ${moves.eyes}개` : '', moves.ears ? '귀' : '', moves.tail ? '꼬리' : ''].filter(Boolean).join(', ');
  const frames = cachedPrepared(it)?.frames.length ?? 0;
  el.textContent = `${found}를 찾았어요. ${frames}프레임짜리 움직임이 만들어져요.`;
}

let editorPaintPending = false;
function schedulePaintEditor(): void {
  if (editorPaintPending) return;
  editorPaintPending = true;
  requestAnimationFrame(() => {
    editorPaintPending = false;
    paintEditor();
  });
}

function paintEditor(): void {
  const it = selected;
  if (!it) return;
  const src = it.frames[Math.min(previewFrame, it.frames.length - 1)]!;
  paintRaster(before, src, bgChoice, 300);
  const opts = bgOptions(it, 1);
  const cleaned = opts ? removeBackground(src, opts) : src;
  paintRaster(after, it.flip ? flipHorizontal(cleaned) : cleaned, bgChoice, 300);
}

/** Called after any change to the selected item's background settings. */
function changed(): void {
  const it = selected;
  if (!it) return;
  $('toleranceVal').textContent = String(it.bg.tolerance);
  $('erodeVal').textContent = String(it.bg.erode);
  $('featherVal').textContent = String(it.bg.feather);
  $('scaleVal').textContent = `${Math.round(it.scale * 100)}%`;
  schedulePaintEditor();
  schedulePreview();
}

for (const r of modeRadios) {
  r.addEventListener('change', () => {
    if (!selected || !r.checked) return;
    selected.bg.mode = r.value as BgMode;
    if (selected.bg.mode === 'auto' && selected.autoKey) keyColor.value = hex(selected.autoKey);
    renderList();
    changed();
  });
}
tolerance.addEventListener('input', () => selected && ((selected.bg.tolerance = Number(tolerance.value)), changed()));
erode.addEventListener('input', () => selected && ((selected.bg.erode = Number(erode.value)), changed()));
feather.addEventListener('input', () => selected && ((selected.bg.feather = Number(feather.value)), changed()));
contiguous.addEventListener('change', () => selected && ((selected.bg.contiguous = contiguous.checked), changed()));
scale.addEventListener(
  'input',
  () => selected && ((selected.scale = Number(scale.value) / 100), (selected.scaleSet = true), renderList(), changed()),
);
motionOff.addEventListener('change', () => selected && ((selected.motionOff = motionOff.checked), changed()));
flip.addEventListener('change', () => selected && ((selected.flip = flip.checked), renderList(), changed()));
anim.addEventListener('change', () => {
  if (!selected) return;
  selected.anim = ANIM_PRESETS.includes(anim.value as AnimPreset) ? (anim.value as AnimPreset) : '';
  renderList();
  refreshEditor();
  schedulePreview();
});
animAmount.addEventListener('input', () => {
  if (!selected) return;
  selected.animAmount = Number(animAmount.value) / 100;
  $('animAmountVal').textContent = `${Math.round(selected.animAmount * 100)}%`;
  showAnimInfo(selected);
  schedulePreview();
});
keyColor.addEventListener('input', () => {
  if (!selected) return;
  selected.bg.key = fromHex(keyColor.value);
  selected.bg.mode = 'color';
  refreshEditor();
  renderList();
  schedulePreview();
});
frameInput.addEventListener('input', () => {
  previewFrame = Number(frameInput.value);
  $('frameLabel').textContent = `${previewFrame + 1} / ${selected?.frames.length ?? 1}`;
  schedulePaintEditor();
});

// clicking the original picks the colour to remove
before.addEventListener('click', (e) => {
  const it = selected;
  if (!it) return;
  const src = it.frames[Math.min(previewFrame, it.frames.length - 1)]!;
  const rect = before.getBoundingClientRect();
  const x = Math.min(src.width - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * src.width)));
  const y = Math.min(src.height - 1, Math.max(0, Math.floor(((e.clientY - rect.top) / rect.height) * src.height)));
  const i = (y * src.width + x) * 4;
  if (src.data[i + 3]! < 200) return setStatus('그 자리는 이미 투명해요. 지울 색이 있는 곳을 눌러 보세요.');
  it.bg.key = [src.data[i]!, src.data[i + 1]!, src.data[i + 2]!];
  it.bg.mode = 'color';
  refreshEditor();
  renderList();
  schedulePreview();
});

for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-bg]')) {
  b.addEventListener('click', () => {
    bgChoice = b.dataset.bg as BgChoice;
    for (const o of document.querySelectorAll('button[data-bg]')) o.classList.toggle('on', o === b);
    schedulePaintEditor();
  });
}

$('applyAll').addEventListener('click', () => {
  const from = selected;
  if (!from) return;
  for (const it of items) {
    if (it === from) continue;
    // a picked colour belongs to one image (its background may differ), so only auto / off are shared
    if (from.bg.mode !== 'color') it.bg.mode = from.bg.mode === 'auto' && !it.autoKey ? 'off' : from.bg.mode;
    it.bg.tolerance = from.bg.tolerance;
    it.bg.contiguous = from.bg.contiguous;
    it.bg.erode = from.bg.erode;
    it.bg.feather = from.bg.feather;
  }
  renderList();
  schedulePreview();
  setStatus(
    from.bg.mode === 'color'
      ? '허용 오차와 가장자리 설정을 모든 이미지에 적용했어요. 지정한 배경색은 이 이미지에만 쓰여요.'
      : '배경 제거 설정을 모든 이미지에 적용했어요.',
    'ok',
  );
});

// --- pet preview -----------------------------------------------------------------------------------

const stage = $<HTMLCanvasElement>('stage');
const note = $('previewNote');
const dpr = Math.min(window.devicePixelRatio || 1, 2);
stage.width = Math.round(STAGE.width * dpr);
stage.height = Math.round(STAGE.height * dpr);
const sctx = stage.getContext('2d')!;
sctx.setTransform(dpr, 0, 0, dpr, 0, 0);

const pet = new Pet({ world: STAGE, mode: 'wander' });
let previewSkin: Skin | null = null;
let disposeSkin: (() => void) | null = null;
let previewToken = 0;
let previewTimer = 0;

function schedulePreview(): void {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => void rebuildPreview(), 200);
}

async function toSkin(built: BuiltSkin): Promise<{ skin: Skin; dispose: () => void }> {
  const sprites = new Map<string, Sprite>();
  const bitmaps: ImageBitmap[] = [];
  for (const p of built.poses) {
    const frames = await Promise.all(
      p.frames.map(async (r) => {
        const image = await rasterToBitmap(r);
        bitmaps.push(image);
        return { image, width: r.width, height: r.height };
      }),
    );
    sprites.set(p.pose, new Sprite(frames, frames.length === 1 ? [Infinity] : p.durations));
  }
  const available = new Set<string>(sprites.keys());
  const still = new Set(built.poses.filter((p) => p.motionOff && p.frames.length > 1).map((p) => p.pose));
  const g = skinGeometry(built);
  const skin: Skin = {
    id: 'preview',
    name: 'preview',
    box: { w: g.size.w, h: g.size.h, anchorX: g.anchor.x, anchorY: g.anchor.y },
    hitbox: g.hitbox,
    artFacing: $<HTMLSelectElement>('facing').value === 'left' ? -1 : 1,
    spriteFor: (state) => sprites.get(resolvePose(state, available))!,
    motionOff: (state) => still.has(state),
    lines: {},
    textColor: DEFAULT_TEXT_COLOR,
  };
  return { skin, dispose: () => bitmaps.forEach((b) => b.close()) };
}

async function rebuildPreview(): Promise<void> {
  const token = ++previewToken;
  const prepared: Prepared[] = [];
  for (const it of items) {
    if (!it.pose) continue;
    const p = cachedPrepared(it);
    // pose, size and motion are applied here so changing them never re-runs the background removal
    if (p) prepared.push({ ...p, item: { ...p.item, pose: it.pose, scale: it.scale, motionOff: it.motionOff } });
  }
  if (!prepared.some((p) => p.item.pose === 'idle')) {
    previewSkin = null;
    note.textContent = items.length ? '기본(idle) 포즈를 지정하면 미리보기가 나와요' : '이미지를 추가하면 미리보기가 나와요';
    note.hidden = false;
    return;
  }
  try {
    const { skin, dispose } = await toSkin(layoutSkin(prepared, { maxSide: PREVIEW_SIDE }));
    if (token !== previewToken) return dispose();
    disposeSkin?.();
    disposeSkin = dispose;
    previewSkin = skin;
    pet.setSprite(skin.box, skin.hitbox);
    note.hidden = true;
  } catch (err) {
    previewSkin = null;
    note.textContent = msg(err);
    note.hidden = false;
  }
}

const stagePoint = (e: PointerEvent): { x: number; y: number } => {
  const r = stage.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * STAGE.width, y: ((e.clientY - r.top) / r.height) * STAGE.height };
};
stage.addEventListener('pointermove', (e) => {
  const p = stagePoint(e);
  pet.setCursor(p);
  pet.pointerMove(p);
});
stage.addEventListener('pointerdown', (e) => {
  const p = stagePoint(e);
  if (!pet.isOver(p)) return;
  pet.pointerDown(p);
  stage.setPointerCapture(e.pointerId);
});
const stageUp = (e: PointerEvent): void => {
  pet.pointerUp(stagePoint(e));
  if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
};
stage.addEventListener('pointerup', stageUp);
stage.addEventListener('pointercancel', stageUp);
stage.addEventListener('pointerleave', () => pet.pointerLeave());

for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-mode]')) {
  b.addEventListener('click', () => {
    pet.setMode(b.dataset.mode as Mode);
    for (const o of document.querySelectorAll('button[data-mode]')) o.classList.toggle('on', o === b);
  });
}
$<HTMLInputElement>('petScale').addEventListener('input', (e) => pet.setScale(Number((e.target as HTMLInputElement).value)));
$('facing').addEventListener('change', () => {
  if (previewSkin) previewSkin.artFacing = $<HTMLSelectElement>('facing').value === 'left' ? -1 : 1;
  // running ears stream the other way now
  if (items.some((it) => it.anim === 'run')) schedulePreview();
});

let last = performance.now();
const loop = (now: number): void => {
  requestAnimationFrame(loop);
  pet.update(now - last);
  last = now;
  sctx.clearRect(0, 0, STAGE.width, STAGE.height);
  if (previewSkin) drawScene(sctx, pet.view, previewSkin, { x: 0, y: 0, ...STAGE });
};
requestAnimationFrame(loop);

// --- adding files ------------------------------------------------------------------------------------

const fileInput = $<HTMLInputElement>('file');
$('pick').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  void addFiles([...(fileInput.files ?? [])]);
  fileInput.value = '';
});
const drop = $('drop');
for (const type of ['dragenter', 'dragover']) {
  window.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
}
for (const type of ['dragleave', 'drop']) {
  window.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.remove('over');
  });
}
window.addEventListener('drop', (e) => void addFiles([...(e.dataTransfer?.files ?? [])]));

// --- saving ------------------------------------------------------------------------------------------

const nameInput = $<HTMLInputElement>('name');
const idInput = $<HTMLInputElement>('skinId');
const saveBtn = $<HTMLButtonElement>('save');
const resultEl = $('result');

// a name without ASCII letters (e.g. Korean) has no slug, so fall back to a fixed folder name
const suggestId = (): string => slugify(nameInput.value) || 'my-skin';
idInput.addEventListener('input', () => (userEditedId = true));
nameInput.addEventListener('input', () => {
  if (!userEditedId) idInput.value = suggestId();
});
idInput.value = suggestId();

saveBtn.addEventListener('click', () => void save());

async function save(): Promise<void> {
  resultEl.replaceChildren();
  try {
    const name = nameInput.value.trim() || 'My skin';
    const id = idInput.value.trim();
    if (!isSkinId(id) || id === 'default') {
      throw new Error('폴더 이름은 영문·숫자·-·_ 로 적어 주세요 ("default"는 쓸 수 없어요).');
    }
    const used = items.filter((i) => i.pose);
    if (!used.some((i) => i.pose === 'idle')) throw new Error('기본(idle) 포즈로 쓸 이미지를 하나 정해 주세요.');
    const dup = used.find(isDup);
    if (dup) throw new Error(`"${POSE_LABELS[dup.pose as PetState]}" 포즈가 두 번 지정됐어요.`);
    if ((await host.existing()).includes(id) && !window.confirm(`"${id}" 스킨이 이미 있어요. 덮어쓸까요?`)) return;

    saveBtn.disabled = true;
    setStatus('이미지를 처리하는 중…');
    await nextFrame();
    const built = buildSkin(used.map((it) => toInput(it, true)));
    const facing = $<HTMLSelectElement>('facing').value === 'left' ? 'left' : 'right';
    const { manifest, images } = assembleSkin(built, { name, facing });
    const files = [
      { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
      ...(await Promise.all(images.map(async (i) => ({ name: i.name, data: await rasterToPng(i.raster) })))),
    ];
    const checked = validateSkinPayload({ id, files });
    if (!checked.ok) throw new Error(checked.error);
    const res = await host.save(checked.payload);
    if (!res.ok) throw new Error(res.error);

    setStatus(`저장했어요 → ${res.where}`, 'ok');
    if (host.apply) {
      const apply = document.createElement('button');
      apply.textContent = '지금 이 스킨 쓰기';
      apply.className = 'primary';
      apply.addEventListener('click', () => {
        void host.apply!(id).then(
          () => setStatus(`"${name}" 스킨을 적용했어요.`, 'ok'),
          (err) => setStatus(msg(err), 'error'),
        );
      });
      resultEl.append(apply);
    } else {
      const link = document.createElement('a');
      link.href = `/?skin=${encodeURIComponent(id)}`;
      link.textContent = '테스트 페이지에서 열기';
      link.target = '_blank';
      resultEl.append(link);
    }
  } catch (err) {
    setStatus(msg(err), 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

// test hook for the browser harness only; the Electron window has no such global
if (host.kind === 'dev') (window as unknown as { __maker: unknown }).__maker = { items, pet, get skin() { return previewSkin; } };

window.addEventListener('error', (e) => setStatus(`오류: ${e.message}`, 'error'));
window.addEventListener('unhandledrejection', (e) => setStatus(`오류: ${msg(e.reason)}`, 'error'));
