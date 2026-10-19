import type { Mode, Rect, Roam } from '../engine/types';

export interface Settings {
  mode: Mode;
  scale: number;
  roam: Roam;
  skin: string;
  /** keep the pet click-through at all times */
  clickThrough: boolean;
  autoStart: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'auto',
  scale: 1,
  roam: 'free',
  skin: 'default',
  clickThrough: false,
  autoStart: false,
};

export interface SkinInfo {
  id: string;
  name: string;
  builtin: boolean;
}

export interface InitInfo {
  /** overlay size in px (the display work area) */
  world: { width: number; height: number };
  settings: Settings;
  skins: SkinInfo[];
  platform: string;
  version: string;
}

/** Where the pet is and whether it should capture the mouse; the main process decides click-through from it. */
export interface HitboxReport {
  rect: Rect;
  interactive: boolean;
}

export const IPC = {
  init: 'buddy:init',
  cursor: 'buddy:cursor',
  settings: 'buddy:settings',
  world: 'buddy:world',
  hitbox: 'buddy:hitbox',
  dragging: 'buddy:dragging',
  log: 'buddy:log',
} as const;
