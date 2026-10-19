import { describe, expect, it } from 'vitest';
import { bodyOf, fitTo } from '../src/shared/body';

const BOX = { w: 100, h: 120, anchorX: 0.5, anchorY: 0.95 };

describe('bodyOf', () => {
  it('is the size the skin was measured at', () => {
    expect(bodyOf({ box: BOX, hitbox: { x: 0, y: 0, w: 1, h: 1 }, body: 87 })).toBe(87);
  });

  it('guesses from the hitbox when the picture could not be measured, and a bad number counts as none', () => {
    const hitbox = { x: 0.1, y: 0.1, w: 0.5, h: 0.8 };
    const guess = bodyOf({ box: BOX, hitbox });
    // the hitbox is 50 x 96 px, and a picture fills a part of it
    expect(guess).toBeGreaterThan(40);
    expect(guess).toBeLessThan(Math.sqrt(50 * 96));
    for (const body of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) expect(bodyOf({ box: BOX, hitbox, body })).toBe(guess);
  });
});

describe('fitTo', () => {
  it('scales a character so that it looks as big as the reference', () => {
    expect(fitTo(100, 100)).toBe(1);
    expect(fitTo(100, 125)).toBeCloseTo(0.8);
    expect(fitTo(100, 80)).toBeCloseTo(1.25);
    // what it makes of the character is the reference's size
    expect(125 * fitTo(100, 125)).toBeCloseTo(100);
  });

  it('never makes one very big or very small, whatever was measured', () => {
    expect(fitTo(100, 1000)).toBe(0.6);
    expect(fitTo(100, 5)).toBe(1.7);
  });

  it('leaves a character as it is when either size is not a size', () => {
    expect(fitTo(0, 100)).toBe(1);
    expect(fitTo(100, 0)).toBe(1);
    expect(fitTo(Number.NaN, 100)).toBe(1);
    expect(fitTo(100, Number.NaN)).toBe(1);
  });
});
