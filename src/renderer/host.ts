import type { Mode, Roam, Vec2 } from '../engine/types';
import { DEFAULT_SETTINGS, type HitboxReport, type InitInfo, type Settings, type SkinInfo } from '../shared/types';

/** Everything the renderer needs from its surroundings: Electron's main process, or a plain browser tab. */
export interface Host {
  /** true in the browser test page, where the pet lives inside a normal page */
  readonly harness: boolean;
  init(): Promise<InitInfo>;
  onCursor(cb: (p: Vec2) => void): void;
  onSettings(cb: (s: Settings) => void): void;
  onWorld(cb: (w: { width: number; height: number }) => void): void;
  reportHitbox(report: HitboxReport): void;
  setDragging(on: boolean): void;
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
    onCursor: (cb) => api.onCursor(cb),
    onSettings: (cb) => api.onSettings(cb),
    onWorld: (cb) => api.onWorld(cb),
    reportHitbox: (r) => api.reportHitbox(r),
    setDragging: (on) => api.setDragging(on),
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
        world: { width: innerWidth, height: innerHeight },
        settings,
        skins,
        platform: 'web',
        version: 'harness',
      };
    },
    onCursor: (cb) => addEventListener('pointermove', (e) => cb({ x: e.clientX, y: e.clientY })),
    onSettings: (cb) => void listeners.push(cb),
    onWorld: (cb) => addEventListener('resize', () => cb({ width: innerWidth, height: innerHeight })),
    reportHitbox: () => {},
    setDragging: () => {},
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
