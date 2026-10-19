import type { Mode, Roam, Vec2 } from '../engine/types';
import type { Battery } from '../shared/power';
import { DEFAULT_SETTINGS, type Area, type InitInfo, type PointerReport, type Settings, type SkinInfo, type SkinReport, type ViewFrame } from '../shared/types';

/**
 * Everything the renderer needs from its surroundings. In Electron the pet is simulated by the main process and
 * this page only draws it; in a plain browser tab (the test page) the page runs the pet itself.
 */
export interface Host {
  /** true in the browser test page, where the pet lives inside a normal page */
  readonly harness: boolean;
  init(): Promise<InitInfo>;
  onSettings(cb: (s: Settings) => void): void;
  /** this window moved or changed size on the screen (Electron) */
  onArea(cb: (a: Area) => void): void;
  /** the files of the skin in use were rewritten (the skin maker saved over it) */
  onReloadSkin(cb: () => void): void;
  /** Electron: the pet as simulated by the main process, or null when it is not in this window */
  onView(cb: (frame: ViewFrame | null) => void): void;
  /** harness: where the browser's pointer is */
  onCursor(cb: (p: Vec2) => void): void;
  /** Electron: a mouse button went down or up on the pet */
  pointer(report: PointerReport): void;
  /** Electron: the main process needs the size and the lines of the skin on screen to simulate the pet */
  reportSkin(skin: SkinReport): void;
  /** Electron: the charge and charger of this computer, so that the pet can notice when it runs low */
  reportBattery(battery: Battery): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  /** harness only: the on-page controls change settings through this */
  patchSettings?(patch: Partial<Settings>): void;
}

export function pickHost(): Host {
  const api = window.buddyHost;
  if (!api) return browserHost();
  return {
    harness: false,
    init: () => api.init(),
    onSettings: (cb) => api.onSettings(cb),
    onArea: (cb) => api.onArea(cb),
    onReloadSkin: (cb) => api.onReloadSkin(cb),
    onView: (cb) => api.onView(cb),
    onCursor: () => {},
    pointer: (r) => api.pointer(r),
    reportSkin: (g) => api.reportSkin(g),
    reportBattery: (b) => api.reportBattery(b),
    log: (level, message) => api.log(level, message),
  };
}

const MODES: Mode[] = ['auto', 'follow', 'attach', 'wander'];
const ROAMS: Roam[] = ['free', 'floor'];
const STORE_KEY = 'desktop-buddy.harness.settings';

function browserHost(): Host {
  let settings: Settings = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) settings = { ...settings, ...JSON.parse(raw) };
  } catch {
    // storage can be unavailable (private mode, blocked); defaults are fine
  }
  const q = new URLSearchParams(location.search);
  const mode = q.get('mode') as Mode | null;
  const roam = q.get('roam') as Roam | null;
  const scale = Number(q.get('scale'));
  if (mode && MODES.includes(mode)) settings.mode = mode;
  if (roam && ROAMS.includes(roam)) settings.roam = roam;
  if (scale > 0) settings.scale = scale;
  if (q.get('skin')) settings.skin = q.get('skin')!;

  const listeners: ((s: Settings) => void)[] = [];
  return {
    harness: true,
    async init() {
      const skins: SkinInfo[] = await fetch('/skins/index.json')
        .then((r) => r.json())
        .catch(() => [{ id: 'default', name: 'default', builtin: true }]);
      return {
        area: { x: 0, y: 0, width: innerWidth, height: innerHeight },
        settings,
        skins,
        platform: 'web',
        version: 'harness',
      };
    },
    onSettings: (cb) => void listeners.push(cb),
    onArea: () => {},
    onReloadSkin: () => {},
    onView: () => {},
    onCursor: (cb) => addEventListener('pointermove', (e) => cb({ x: e.clientX, y: e.clientY })),
    pointer: () => {},
    reportSkin: () => {},
    reportBattery: () => {},
    log: (level, message) => console[level](message),
    patchSettings(patch) {
      settings = { ...settings, ...patch };
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(settings));
      } catch {
        // see above
      }
      for (const cb of listeners) cb(settings);
    },
  };
}
