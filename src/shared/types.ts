import type { Actions, Lines, Mode, PetView, Rect, Roam, SpeechLevel } from '../engine/types';

export interface Settings {
  mode: Mode;
  scale: number;
  roam: Roam;
  skin: string;
  /** keep the pet click-through at all times */
  clickThrough: boolean;
  autoStart: boolean;
  /** look for newer versions in the background and download them (an installed Windows build only) */
  autoUpdate: boolean;
  /** where the pet lives: "all" monitors, the "primary" one, or the id of one monitor */
  monitor: string;
  /** what the pet says: "all" (answers and murmurs), "reactions" (only answers), "off" */
  speech: SpeechLevel;
  /** the pet does one of its actions now and then on its own (it still does them when asked, and for a situation) */
  tricks: boolean;
  /** characters that live here besides `skin`, by skin id: each is a pet of its own, and they greet each other */
  friends: string[];
}

/** How many friends a pet can have (so the screens hold at most one more than this). */
export const MAX_FRIENDS = 4;

export const DEFAULT_SETTINGS: Settings = {
  mode: 'auto',
  scale: 1,
  roam: 'free',
  skin: 'usagi',
  clickThrough: false,
  autoStart: false,
  autoUpdate: true,
  monitor: 'all',
  speech: 'all',
  tricks: true,
  friends: [],
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
  /** whose pet it is: the id of its skin */
  id: string;
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
  /** the skin that was loaded */
  id: string;
  box: { w: number; h: number; anchorX: number; anchorY: number };
  /** the body inside the box, as fractions of it */
  hitbox: Rect;
  /** what the skin says, by situation */
  lines: Lines;
  /** what the skin does now and then */
  actions: Actions;
}

export const IPC = {
  init: 'buddy:init',
  settings: 'buddy:settings',
  area: 'buddy:area',
  view: 'buddy:view',
  pointer: 'buddy:pointer',
  skin: 'buddy:skin',
  battery: 'buddy:battery',
  log: 'buddy:log',
  reloadSkin: 'buddy:reload-skin',
  makerExisting: 'buddy:maker-existing',
  makerSave: 'buddy:maker-save',
  makerApply: 'buddy:maker-apply',
} as const;
