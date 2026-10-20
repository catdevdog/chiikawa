import type { PetConfig, Rect } from './types';

/**
 * Hiding at a wall: the pets run to one edge of the screens and peek out from behind it, with only a part of the face
 * and the hands in view, until one of them is clicked.
 */

/** A wall to hide behind, as a pet is told about it. */
export interface Wall {
  /** the x of the edge of the screens */
  x: number;
  /** +1: the wall is the right edge (the pet hides to the left of it, looking left); -1: the left edge */
  side: 1 | -1;
  /** the floor at the wall: where the pet stands before it slips behind */
  floorY: number;
  /** where the feet are while it waits (up the wall from the floor: pets that hide together do not cover each other) */
  y: number;
  /**
   * The side of a window this wall is (a `Side` id), and how far below the top of the window the feet are: the wall goes
   * where the window goes. Without it the wall is the edge of the screens, which stays where it is.
   */
  at?: string;
  off?: number;
}

/**
 * What a picture for hiding looks like, in pixels at scale 1: the picture is cut by the wall, so it is described by
 * where the wall is and how far from it the picture reaches. A skin's own picture is measured; without one the pet
 * leans its ordinary picture towards the wall (`defaultPeek`).
 */
export interface PeekLayout {
  /** from the feet to the wall, behind the pet (the side its picture does not face) */
  edge: number;
  /** how far from the wall the picture reaches towards the front: the width of what is in view */
  reach: number;
  /** how far above the feet the picture rises, and how far below them it goes */
  top: number;
  bottom: number;
}

/** The part of the body that stays in view when the ordinary picture is the one that peeks. */
const SHOWN = 0.62;

export function defaultPeek(sprite: PetConfig['sprite'], hitbox: Rect): PeekLayout {
  const w = hitbox.w * sprite.w;
  return {
    edge: (SHOWN - 0.5) * w,
    reach: SHOWN * w,
    top: (sprite.anchorY - hitbox.y) * sprite.h,
    bottom: (hitbox.y + hitbox.h - sprite.anchorY) * sprite.h,
  };
}

/** The wall a pet is nearest to among the outer edges of the screens: the one on the side of `x` that is further from the middle. */
export function nearestSide(x: number, bounds: { x0: number; x1: number }): 1 | -1 {
  return x >= (bounds.x0 + bounds.x1) / 2 ? 1 : -1;
}

/**
 * What a picture for looking over the top of a window looks like: it stands on the feet line (the edge of the window), so
 * it is described by how far it reaches to either side of the feet and how far above them. In pixels at scale 1.
 */
export interface HangLayout {
  /** from the feet to the side, at the widest */
  half: number;
  /** how far above the feet the picture rises */
  top: number;
}

/** The part of the body, from the top of the hitbox down, that shows over the edge when the ordinary picture is the one that looks over it. */
export const HANG_SHOWN = 0.55;

export function defaultHang(sprite: PetConfig['sprite'], hitbox: Rect): HangLayout {
  const w = sprite.w;
  return {
    half: Math.max(sprite.anchorX - hitbox.x, hitbox.x + hitbox.w - sprite.anchorX) * w,
    top: HANG_SHOWN * hitbox.h * sprite.h,
  };
}
