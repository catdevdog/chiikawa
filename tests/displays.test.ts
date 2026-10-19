import { describe, expect, it } from 'vitest';
import { chooseDisplays, isMonitorChoice, parseFakeDisplays, type DisplayInfo } from '../src/shared/displays';

const display = (id: number, x: number, y: number, width: number, height: number, primary = false): DisplayInfo => ({
  id,
  label: '',
  primary,
  workArea: { x, y, width, height },
  bounds: { x, y, width, height },
  scaleFactor: 1,
});

// the second monitor is to the left of the primary one, as it often is
const LEFT = display(20, -1280, 0, 1280, 1024);
const MAIN = display(10, 0, 0, 1920, 1040, true);
const RIGHT = display(30, 1920, 0, 1600, 900);

describe('chooseDisplays', () => {
  it('"all" lists the primary monitor first and then the others from left to right', () => {
    expect(chooseDisplays([RIGHT, MAIN, LEFT], 'all').map((d) => d.id)).toEqual([10, 20, 30]);
  });

  it('"primary" is just the primary monitor', () => {
    expect(chooseDisplays([LEFT, RIGHT, MAIN], 'primary').map((d) => d.id)).toEqual([10]);
  });

  it('a numeric id picks that monitor', () => {
    expect(chooseDisplays([LEFT, MAIN, RIGHT], '30').map((d) => d.id)).toEqual([30]);
  });

  it('a monitor that is not connected falls back to the primary one', () => {
    expect(chooseDisplays([LEFT, MAIN], '30').map((d) => d.id)).toEqual([10]);
  });

  it('without a flagged primary the first monitor stands in', () => {
    expect(chooseDisplays([LEFT, RIGHT], 'primary').map((d) => d.id)).toEqual([20]);
  });

  it('skips monitors with no usable work area, and returns nothing if none is left', () => {
    const broken = display(40, 0, 0, 0, 0);
    expect(chooseDisplays([MAIN, broken], 'all').map((d) => d.id)).toEqual([10]);
    expect(chooseDisplays([broken], 'all')).toEqual([]);
    expect(chooseDisplays([], 'primary')).toEqual([]);
  });
});

describe('isMonitorChoice', () => {
  it('knows the three kinds of choice', () => {
    expect(['all', 'primary', '0', '2528732444'].every(isMonitorChoice)).toBe(true);
    expect([undefined, 3, '', 'left', '-2', '1e3'].some(isMonitorChoice)).toBe(false);
  });
});

describe('parseFakeDisplays', () => {
  it('reads a list of monitors, the first one is the primary one unless told otherwise', () => {
    const list = parseFakeDisplays('[{"x":0,"y":0,"width":1280,"height":720},{"id":9,"x":1280,"y":0,"width":1024,"height":768,"primary":true}]')!;
    expect(list.map((d) => [d.id, d.primary])).toEqual([[1, false], [9, true]]);
    const first = parseFakeDisplays([{ x: 0, y: 0, width: 800, height: 600 }])!;
    expect(first[0]!.primary).toBe(true);
    expect(first[0]!.workArea).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('takes a separate work area, like a monitor with a taskbar', () => {
    const [d] = parseFakeDisplays([{ x: 0, y: 0, width: 800, height: 600, work: { height: 560 } }])!;
    expect(d!.bounds.height).toBe(600);
    expect(d!.workArea).toEqual({ x: 0, y: 0, width: 800, height: 560 });
  });

  it('rejects anything that is not a list of rectangles', () => {
    for (const bad of ['', 'nope', '{}', '[]', [], [1], [{ x: 0, y: 0, width: 0, height: 5 }], [{ x: 'a', y: 0, width: 5, height: 5 }], undefined, null]) {
      expect(parseFakeDisplays(bad)).toBeNull();
    }
  });
});
