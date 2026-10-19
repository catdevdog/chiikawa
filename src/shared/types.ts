import type { Lines, Mode, PetView, Rect, Roam, SpeechLevel } from '../engine/types';

export interface Settings {
  mode: Mode;
  scale: number;
  roam: Roam;
  skin: string;
  /** keep the pet click-through at all times */
  clickThrough: boolean;
  autoStart: boolean;
  /** where the pet lives: "all" monitors, the "primary" one, or the id of one monitor */
  monitor: string;
  /** what the pet says: "all" (answers and murmurs), "reactions" (only answers), "off" */
  speech: SpeechLevel;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'auto',
  scale: 1,
  roam: 'free',
  skin: 'usagi',
  clickThrough: false,
  autoStart: false,
  monitor: 'all',
  speech: 'all',
};

export interface SkinInfo {
  id: string;
  name: string;
  builtin: boolean;
}

/** A rectangle in the coordinates all monitors share (device-independent pixels, the primary monitor's corner is 0,0). */
export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InitInfo {
  /** where this overlay window sits in the shared coordinates (the work area of its monitor) */
  area: Area;
  settings: Settings;
  skins: SkinInfo[];
  platform: string;
  version: string;
}

/**
 * The pet as the main process simulates it, for an overlay to draw. Everything is in the shared coordinates;
 * the overlay subtracts its own origin. The velocity lets it draw smoothly between two frames.
 */
export interface ViewFrame {
  view: PetView;
  /** px per second */
  vx: number;
  vy: number;
}

/** A mouse button going down or up in an overlay, in that overlay's own coordinates. */
export interface PointerReport {
  kind: 'down' | 'up';
  x: number;
  y: number;
}

/** What the main process needs to know about the skin on screen to simulate the pet. */
export interface SkinReport {
  box: { w: number; h: number; anchorX: number; anchorY: number };
  /** the body inside the box, as fractions of it */
  hitbox: Rect;
  /** what the skin says, by situation */
  lines: Lines;
}

export const IPC = {
  init: 'buddy:init',
  settings: 'buddy:settings',
  area: 'buddy:area',
  view: 'buddy:view',
  pointer: 'buddy:pointer',
  skin: 'buddy:skin',
  log: 'buddy:log',
  reloadSkin: 'buddy:reload-skin',
  makerExisting: 'buddy:maker-existing',
  makerSave: 'buddy:maker-save',
  makerApply: 'buddy:maker-apply',
} as const;
