import type { Vec2 } from '../engine/types';
import type { SkinPayload } from '../shared/skin-payload';
import type { HitboxReport, InitInfo, Settings } from '../shared/types';

/** Surface exposed by the Electron preload script. Absent when running in a plain browser. */
export interface BuddyHostApi {
  init(): Promise<InitInfo>;
  onCursor(cb: (p: Vec2) => void): void;
  onSettings(cb: (s: Settings) => void): void;
  onWorld(cb: (w: { width: number; height: number }) => void): void;
  onReloadSkin(cb: () => void): void;
  reportHitbox(report: HitboxReport): void;
  setDragging(on: boolean): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

/** Surface exposed to the skin maker window only. */
export interface BuddyMakerApi {
  existing(): Promise<string[]>;
  save(payload: SkinPayload): Promise<{ ok: true; where: string } | { ok: false; error: string }>;
  apply(id: string): Promise<void>;
}

declare global {
  interface Window {
    buddyHost?: BuddyHostApi;
    buddyMaker?: BuddyMakerApi;
  }
}
