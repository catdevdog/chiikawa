import { Pet, type PetView } from '../engine';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';
import { drawScene } from './draw';
import { mountHarness } from './harness';
import { pickHost } from './host';
import { loadSkin, type Skin } from './skin';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const host = pickHost();

async function loadSkinOrDefault(id: string): Promise<Skin> {
  try {
    return await loadSkin(id);
  } catch (err) {
    host.log('error', `could not load skin "${id}": ${err instanceof Error ? err.message : String(err)}`);
    if (id === 'default') throw err;
    return loadSkin('default');
  }
}

async function start(): Promise<void> {
  const info = await host.init();
  const query = new URLSearchParams(location.search);
  const debug = host.harness && query.get('debug') === '1';
  document.body.classList.toggle('harness', host.harness);

  let settings: Settings = { ...DEFAULT_SETTINGS, ...info.settings };
  let skin = await loadSkinOrDefault(settings.skin);
  let world = info.world;

  // test-page knob: make the pet nod off quickly
  const sleepAfter = host.harness ? Number(query.get('sleepAfter')) : 0;
  const pet = new Pet({
    world,
    mode: settings.mode,
    config: {
      scale: settings.scale,
      roam: settings.roam,
      sprite: skin.box,
      hitbox: skin.hitbox,
      ...(sleepAfter > 0 ? { sleepAfterMs: sleepAfter } : {}),
    },
  });
  pet.setInteractive(!settings.clickThrough);

  const resize = (width: number, height: number): void => {
    world = { width, height };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pet.setWorld(width, height);
  };
  resize(world.width, world.height);

  let panel: ReturnType<typeof mountHarness> | undefined;
  const apply = async (next: Settings): Promise<void> => {
    const prev = settings;
    settings = next;
    pet.setMode(next.mode);
    pet.setScale(next.scale);
    pet.setRoam(next.roam);
    pet.setInteractive(!next.clickThrough);
    if (next.skin !== prev.skin) {
      skin = await loadSkinOrDefault(next.skin);
      pet.setSprite(skin.box, skin.hitbox);
    }
    panel?.sync(next);
  };

  host.onCursor((p) => {
    pet.setCursor(p);
    // click-through windows may not deliver a "leave", so the global cursor decides when hover ends
    if (!pet.isOver(p)) pet.pointerLeave();
  });
  host.onWorld((w) => resize(w.width, w.height));
  host.onSettings((s) => void apply(s));
  if (host.harness) {
    panel = mountHarness({ settings, skins: info.skins, patch: (p) => host.patchSettings?.(p) });
    (window as unknown as { __buddy: unknown }).__buddy = {
      pet,
      get skin() {
        return skin;
      },
      get world() {
        return world;
      },
    };
  }

  const at = (e: PointerEvent) => ({ x: e.clientX, y: e.clientY });
  canvas.addEventListener('pointerdown', (e) => {
    const p = at(e);
    if (!pet.isOver(p)) return;
    pet.pointerDown(p);
    canvas.setPointerCapture(e.pointerId);
    host.setDragging(true);
  });
  canvas.addEventListener('pointermove', (e) => pet.pointerMove(at(e)));
  const release = (e: PointerEvent): void => {
    pet.pointerUp(at(e));
    host.setDragging(false);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => pet.pointerLeave());
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  let sent = { x: NaN, y: NaN, w: NaN, h: NaN, interactive: false };
  const report = (v: PetView): void => {
    const r = v.hitbox;
    const moved =
      Math.abs(r.x - sent.x) > 0.5 || Math.abs(r.y - sent.y) > 0.5 || Math.abs(r.w - sent.w) > 0.5 || Math.abs(r.h - sent.h) > 0.5;
    if (!moved && v.interactive === sent.interactive) return;
    sent = { x: r.x, y: r.y, w: r.w, h: r.h, interactive: v.interactive };
    host.reportHitbox({ rect: { x: r.x, y: r.y, w: r.w, h: r.h }, interactive: v.interactive });
  };

  let last = performance.now();
  let lastDraw = 0;
  let lastStatus = 0;
  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const dt = now - last;
    last = now;
    pet.update(dt);
    const v = pet.view;
    // calm states (idle, sit, sleep) only need a slow refresh
    if (v.animating || now - lastDraw >= 66) {
      drawScene(ctx, v, skin, world, { debug });
      lastDraw = now;
    }
    report(v);
    if (panel && now - lastStatus > 150) {
      panel.setStatus(`${pet.mode} / ${v.state}`);
      lastStatus = now;
    }
  };
  requestAnimationFrame(frame);
}

window.addEventListener('error', (e) => host.log('error', `${e.message} (${e.filename}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => host.log('error', `unhandled rejection: ${String(e.reason)}`));
start().catch((err) => host.log('error', `startup failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`));
