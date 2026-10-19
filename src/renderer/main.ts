import { Pet } from '../engine';
import { DEFAULT_SETTINGS, type Area, type Settings, type SkinReport } from '../shared/types';
import { drawScene, type Viewport } from './draw';
import { mountHarness } from './harness';
import { pickHost } from './host';
import { RemoteView } from './remote';
import { loadSkin, type Skin } from './skin';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const host = pickHost();

/** Calm poses (idle, sit, sleep) only need a slow refresh. */
const CALM_REDRAW_MS = 66;

async function loadSkinOrDefault(id: string): Promise<Skin> {
  try {
    return await loadSkin(id);
  } catch (err) {
    host.log('error', `could not load skin "${id}": ${err instanceof Error ? err.message : String(err)}`);
    if (id === 'default') throw err;
    return loadSkin('default');
  }
}

/** What `navigator.getBattery()` gives back (not in TypeScript's own DOM types). */
interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
}

/** Tells the main process the charge and the charger now and whenever either changes. A computer without one says nothing. */
async function watchBattery(): Promise<void> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
  if (host.harness || typeof nav.getBattery !== 'function') return;
  try {
    const battery = await nav.getBattery();
    const send = (): void => host.reportBattery({ level: battery.level, charging: battery.charging });
    battery.addEventListener('levelchange', send);
    battery.addEventListener('chargingchange', send);
    send();
  } catch (err) {
    host.log('info', `no battery information: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const reportOf = (skin: Skin): SkinReport => ({ box: { ...skin.box }, hitbox: { ...skin.hitbox }, lines: skin.lines });

/**
 * In Electron this window only draws: the main process simulates the pet for all monitors and sends what to
 * show. In the browser test page there is no main process, so the page runs the pet itself.
 */
async function start(): Promise<void> {
  const query = new URLSearchParams(location.search);
  const debug = host.harness && query.get('debug') === '1';
  document.body.classList.toggle('harness', host.harness);

  // Listen before asking for anything, so that nothing sent while the skin loads gets lost.
  const remote = new RemoteView();
  let ready = false;
  const queued: (() => void)[] = [];
  const later = (fn: () => void): void => {
    if (ready) fn();
    else queued.push(fn);
  };
  host.onView((frame) => remote.push(frame, performance.now()));
  host.onSettings((s) => later(() => void apply(s)));
  host.onArea((a) => later(() => place(a)));
  host.onReloadSkin(() => later(() => void loadSkinNow(settings.skin)));

  const info = await host.init();
  let settings: Settings = { ...DEFAULT_SETTINGS, ...info.settings };
  let skin: Skin | null = null;
  let pet: Pet | null = null;
  let skinSeq = 0;
  const view: Viewport = { x: info.area.x, y: info.area.y, width: 0, height: 0 };
  let lastDraw = 0;
  let drawn = false;

  /** (Re)loads the skin; a slower load that finishes after a newer request is dropped. */
  const loadSkinNow = async (id: string): Promise<void> => {
    const seq = ++skinSeq;
    const next = await loadSkinOrDefault(id);
    if (seq !== skinSeq) return;
    skin = next;
    host.reportSkin(reportOf(next));
    pet?.setSprite(next.box, next.hitbox);
    pet?.setLines(next.lines);
    lastDraw = 0;
  };
  await loadSkinNow(settings.skin);
  void watchBattery();

  // test-page knob: make the pet nod off quickly
  const sleepAfter = host.harness ? Number(query.get('sleepAfter')) : 0;
  pet = host.harness
    ? new Pet({
        world: { width: innerWidth, height: innerHeight },
        mode: settings.mode,
        // test-page knob: every situation speaks, and often
        chatty: query.get('chatty') === '1',
        config: {
          scale: settings.scale,
          roam: settings.roam,
          sprite: skin!.box,
          hitbox: skin!.hitbox,
          ...(sleepAfter > 0 ? { sleepAfterMs: sleepAfter } : {}),
        },
      })
    : null;
  pet?.setInteractive(!settings.clickThrough);
  pet?.setSpeech(settings.speech);
  pet?.setLines(skin!.lines);

  const layout = (): void => {
    view.width = innerWidth;
    view.height = innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(view.width * dpr);
    canvas.height = Math.round(view.height * dpr);
    canvas.style.width = `${view.width}px`;
    canvas.style.height = `${view.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pet?.setWorld(view.width, view.height);
    lastDraw = 0;
    drawn = false;
  };
  /** This window moved on the screen (the monitor changed). */
  const place = (a: Area): void => {
    view.x = a.x;
    view.y = a.y;
    layout();
  };
  layout();
  window.addEventListener('resize', layout);

  let panel: ReturnType<typeof mountHarness> | undefined;
  const apply = async (next: Settings): Promise<void> => {
    const prev = settings;
    settings = next;
    if (pet) {
      pet.setMode(next.mode);
      pet.setScale(next.scale);
      pet.setRoam(next.roam);
      pet.setSpeech(next.speech);
      pet.setInteractive(!next.clickThrough);
    }
    if (next.skin !== prev.skin) await loadSkinNow(next.skin);
    panel?.sync(next);
  };

  if (pet) {
    host.onCursor((p) => {
      pet.setCursor(p);
      // click-through windows may not deliver a "leave", so the global cursor decides when hover ends
      if (!pet.isOver(p)) pet.pointerLeave();
    });
    panel = mountHarness({ settings, skins: info.skins, patch: (p) => host.patchSettings?.(p) });
    (window as unknown as { __buddy: unknown }).__buddy = {
      pet,
      get skin() {
        return skin;
      },
      get world() {
        return { width: view.width, height: view.height };
      },
    };
  }

  // --- the mouse -------------------------------------------------------------------------------------
  // In Electron the main process watches the pointer and decides when this window takes the mouse, so the
  // window only reports the buttons. The test page has no one to ask and runs the pointer through the pet.
  const at = (e: PointerEvent) => ({ x: e.clientX, y: e.clientY });
  let pressing = false;
  canvas.addEventListener('pointerdown', (e) => {
    const p = at(e);
    if (pet) {
      if (!pet.isOver(p)) return;
      pet.pointerDown(p);
    } else {
      host.pointer({ kind: 'down', ...p });
    }
    pressing = true;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => pet?.pointerMove(at(e)));
  const release = (e: PointerEvent): void => {
    if (pressing) {
      pressing = false;
      if (pet) pet.pointerUp(at(e));
      else host.pointer({ kind: 'up', ...at(e) });
    }
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('pointerleave', () => pet?.pointerLeave());
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- drawing -----------------------------------------------------------------------------------------
  let last = performance.now();
  let lastStatus = 0;
  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const dt = now - last;
    last = now;
    if (pet) pet.update(dt);
    const v = pet ? pet.view : remote.at(now);
    if (!skin) return;
    if (v) {
      // calm states only need a slow refresh
      if (v.animating || now - lastDraw >= CALM_REDRAW_MS) {
        drawScene(ctx, v, skin, view, { debug });
        lastDraw = now;
        drawn = true;
      }
    } else if (drawn) {
      // the pet walked off this monitor
      ctx.clearRect(0, 0, view.width, view.height);
      drawn = false;
    }
    if (panel && pet && now - lastStatus > 150) {
      panel.setStatus(`${pet.mode} / ${pet.view.state}`);
      lastStatus = now;
    }
  };
  requestAnimationFrame(frame);

  ready = true;
  for (const fn of queued.splice(0)) fn();
}

window.addEventListener('error', (e) => host.log('error', `${e.message} (${e.filename}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => host.log('error', `unhandled rejection: ${String(e.reason)}`));
start().catch((err) => host.log('error', `startup failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`));
