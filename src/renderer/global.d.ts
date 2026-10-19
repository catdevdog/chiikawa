import type { Vec2 } from '../engine/types';
import type { Battery } from '../shared/power';
import type { SkinPayload } from '../shared/skin-payload';
import type { Area, InitInfo, PointerReport, Settings, SkinReport, ViewFrame } from '../shared/types';

/** Surface exposed by the Electron preload script. Absent when running in a plain browser. */
export interface BuddyHostApi {
  init(): Promise<InitInfo>;
  onSettings(cb: (s: Settings) => void): void;
  onArea(cb: (a: Area) => void): void;
  onView(cb: (frame: ViewFrame | null) => void): void;
  onReloadSkin(cb: () => void): void;
  pointer(report: PointerReport): void;
  reportSkin(skin: SkinReport): void;
  reportBattery(battery: Battery): void;
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
