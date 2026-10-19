import type { Vec2 } from '../engine/types';
import type { HitboxReport, InitInfo, Settings } from '../shared/types';

/** Surface exposed by the Electron preload script. Absent when running in a plain browser. */
export interface BuddyHostApi {
  init(): Promise<InitInfo>;
  onCursor(cb: (p: Vec2) => void): void;
  onSettings(cb: (s: Settings) => void): void;
  onWorld(cb: (w: { width: number; height: number }) => void): void;
  reportHitbox(report: HitboxReport): void;
  setDragging(on: boolean): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

declare global {
  interface Window {
    buddyHost?: BuddyHostApi;
  }
}
