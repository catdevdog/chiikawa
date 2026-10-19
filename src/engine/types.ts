export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** auto: follows an active cursor, wanders when it is idle. attach: hangs off the cursor. */
export type Mode = 'auto' | 'follow' | 'attach' | 'wander';
export type Roam = 'free' | 'floor';

export type PetState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sit'
  | 'sleep'
  | 'held'
  | 'fall'
  | 'land'
  | 'surprised'
  | 'happy';

export const PET_STATES: readonly PetState[] = [
  'idle',
  'walk',
  'run',
  'sit',
  'sleep',
  'held',
  'fall',
  'land',
  'surprised',
  'happy',
];

export type ParticleKind = 'heart' | 'z' | 'text';

/** How spoken words are shown: 'float' rises and fades like the z's, 'hold' stays above the head for a moment and then fades. */
export type SayStyle = 'float' | 'hold';

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** ms since spawn */
  age: number;
  /** ms until it disappears */
  life: number;
  /** text only: the words, how they move, the font size and the width they take (px) */
  text?: string;
  style?: SayStyle;
  size?: number;
  w?: number;
  /** text only: where held words sit relative to the feet (floating words use dx as a phase) */
  dx?: number;
  dy?: number;
}

/** The situations a pet can say something in. */
export type SayEvent =
  | 'start'
  | 'hover'
  | 'click'
  | 'rub'
  | 'triple'
  | 'pickup'
  | 'throw'
  | 'land'
  | 'flee'
  | 'follow'
  | 'attach'
  | 'idle'
  | 'sit'
  | 'sleep'
  | 'wake'
  | 'cross';

export const SAY_EVENTS: readonly SayEvent[] = [
  'start',
  'hover',
  'click',
  'rub',
  'triple',
  'pickup',
  'throw',
  'land',
  'flee',
  'follow',
  'attach',
  'idle',
  'sit',
  'sleep',
  'wake',
  'cross',
];

export interface Line {
  text: string;
  style: SayStyle;
}

/** What a skin says, by situation. */
export type Lines = Partial<Record<SayEvent, Line[]>>;

/** all: reactions and murmurs, reactions: only answers to what happens, off: silent. */
export type SpeechLevel = 'all' | 'reactions' | 'off';
export const SPEECH_LEVELS: readonly SpeechLevel[] = ['all', 'reactions', 'off'];

/**
 * Pixel values are for scale 1; the engine multiplies them by `scale`.
 * The sprite box is what a skin pose is fitted into; `anchor` is the feet point and
 * `hitbox` the body area inside the box (all as fractions of the box).
 */
export interface PetConfig {
  sprite: { w: number; h: number; anchorX: number; anchorY: number };
  hitbox: Rect;
  scale: number;
  roam: Roam;
  walkSpeed: number;
  runSpeed: number;
  /** start chasing the cursor beyond this distance */
  followStart: number;
  /** stop this far from the cursor */
  followStop: number;
  sleepAfterMs: number;
  /** cursor speed (px/s) that startles the pet */
  fleeSpeed: number;
  gravity: number;
}

export const DEFAULT_CONFIG: PetConfig = {
  sprite: { w: 128, h: 128, anchorX: 0.5, anchorY: 0.94 },
  hitbox: { x: 0.18, y: 0.22, w: 0.64, h: 0.72 },
  scale: 1,
  roam: 'free',
  walkSpeed: 70,
  runSpeed: 260,
  followStart: 150,
  followStop: 90,
  sleepAfterMs: 45_000,
  fleeSpeed: 1500,
  gravity: 2600,
};

export interface PetView {
  /** feet position in world (overlay) coordinates */
  x: number;
  y: number;
  facing: 1 | -1;
  state: PetState;
  /** seconds spent in the current state */
  t: number;
  /** squash and stretch multipliers, applied around the feet */
  sx: number;
  sy: number;
  /** radians */
  rot: number;
  /** px the sprite is raised (hops) */
  lift: number;
  /** what the rotation pivots around: the feet, or the top of the sprite when hanging */
  pivot: 'feet' | 'top';
  scale: number;
  particles: readonly Particle[];
  hitbox: Rect;
  /** false while the pet must not capture clicks (attached to the cursor, or click-through locked) */
  interactive: boolean;
  /** false when nothing needs a smooth frame rate (sleeping, sitting, idle) */
  animating: boolean;
}
