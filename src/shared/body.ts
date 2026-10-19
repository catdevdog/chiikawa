import type { SkinReport } from './types';

/**
 * How big a character looks, as the side of a square with the area of its picture (in sprite-box pixels at scale 1).
 * Skins draw their characters at different sizes in their boxes (a rabbit with long ears in a tall box, a round bear
 * in a wide one), so the box and even the height say little; the area is what the eye compares.
 */
export type BodySource = Pick<SkinReport, 'box' | 'hitbox'> & { body?: number };

/** The part of a hitbox that a picture fills, for a skin whose picture could not be measured. */
const FILL = 0.75;

export function bodyOf(skin: BodySource): number {
  if (typeof skin.body === 'number' && Number.isFinite(skin.body) && skin.body > 0) return skin.body;
  return Math.sqrt(skin.box.w * skin.hitbox.w * skin.box.h * skin.hitbox.h * FILL);
}

/** The most a pet is made bigger or smaller to match another, so that a bad measurement cannot blow one up or shrink it away. */
const FIT_MIN = 0.6;
const FIT_MAX = 1.7;

/** By how much to scale a pet whose picture looks `body` big, so that it looks as big as `reference`. */
export function fitTo(reference: number, body: number): number {
  if (!(reference > 0) || !(body > 0)) return 1;
  return Math.min(FIT_MAX, Math.max(FIT_MIN, reference / body));
}
