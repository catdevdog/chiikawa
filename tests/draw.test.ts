import { describe, expect, it } from 'vitest';
import { HANG_SHOWN } from '../src/engine/peek';
import type { PetState, PetView } from '../src/engine/types';
import { drawScene } from '../src/renderer/draw';
import { Sprite, type Skin } from '../src/renderer/skin';

type Call = { name: string; args: unknown[] };

/** A stand-in for a canvas context that only writes down what it is asked to do. */
function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, name: string) => (...args: unknown[]) => {
        calls.push({ name, args });
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const BOX = { w: 128, h: 100, anchorX: 0.5, anchorY: 0.9 };
const HITBOX = { x: 0.2, y: 0.1, w: 0.6, h: 0.8 };

function skin(over: Partial<Skin> = {}): Skin {
  const sprite = new Sprite([{ image: {} as CanvasImageSource, width: 128, height: 100 }], [100]);
  return {
    id: 'test',
    name: 'test',
    box: BOX,
    hitbox: HITBOX,
    artFacing: -1,
    spriteFor: () => sprite,
    motionOff: () => false,
    lines: {},
    actions: {},
    textColor: '#000',
    ...over,
  };
}

function view(state: PetState, over: Partial<PetView> = {}): PetView {
  return {
    x: 500,
    y: 400,
    facing: 1,
    state,
    t: 0,
    sx: 1,
    sy: 1,
    rot: 0,
    lift: 0,
    pivot: 'feet',
    scale: 2,
    particles: [],
    hitbox: { x: 0, y: 0, w: 0, h: 0 },
    interactive: true,
    animating: false,
    action: null,
    wall: null,
    wallSide: 1,
    ...over,
  };
}

const VIEWPORT = { x: 0, y: 0, width: 1000, height: 800 };
const draw = (state: PetState, s: Skin, over: Partial<PetView> = {}): Call[] => {
  const { ctx, calls } = recorder();
  drawScene(ctx, [{ view: view(state, over), skin: s }], VIEWPORT);
  return calls;
};
const named = (calls: Call[], name: string): Call[] => calls.filter((c) => c.name === name);

describe('drawing a pet that looks over the top edge of a window', () => {
  it('puts the top of the ordinary picture over the edge, and cuts it on the feet line, when the skin has no picture for it', () => {
    const calls = draw('hang', skin());
    // the part that shows ends on the feet line: nothing is drawn below y = 400
    const clips = named(calls, 'rect');
    expect(clips).toHaveLength(1);
    const [x, y, w, h] = clips[0]!.args as number[];
    expect(y! + h!).toBe(400);
    expect(x! + w! / 2).toBe(500);
    expect(named(calls, 'clip')).toHaveLength(1);
    // moved down until the cut of the body (the top part of the hitbox) is on the feet line
    const sink = (BOX.anchorY - HITBOX.y - HANG_SHOWN * HITBOX.h) * BOX.h * 2;
    const moved = named(calls, 'translate').find((c) => (c.args[0] as number) === 500);
    expect(moved?.args[1]).toBeCloseTo(400 + sink, 5);
  });

  it('draws the skin\'s own picture as it is, standing on the feet line, with nothing cut', () => {
    const calls = draw('hang', skin({ hang: { half: 40, top: 60 } }));
    expect(named(calls, 'clip')).toHaveLength(0);
    const moved = named(calls, 'translate').find((c) => (c.args[0] as number) === 500);
    expect(moved?.args[1]).toBe(400);
  });

  it('leaves out the shadow: there is nothing to cast one on the window', () => {
    for (const state of ['hang', 'peek', 'fall'] as const) expect(named(draw(state, skin()), 'ellipse'), state).toHaveLength(0);
    // a pet on its feet has one
    expect(named(draw('idle', skin()), 'ellipse').length).toBeGreaterThan(0);
  });

  it('does nothing of the kind for the other poses', () => {
    for (const state of ['idle', 'walk', 'peek', 'sit'] as const) expect(named(draw(state, skin()), 'clip'), state).toHaveLength(0);
  });
});

describe('drawing a pet that hides behind a wall', () => {
  it('draws nothing beyond the wall: to the right of it when the pet is to the left of it, and the other way round', () => {
    for (const [side, wall] of [[1, 700], [-1, 300]] as const) {
      const calls = draw('peek', skin(), { wall, wallSide: side });
      const [x, y, w, h] = named(calls, 'rect')[0]!.args as number[];
      expect(named(calls, 'clip')).toHaveLength(1);
      // the edge of what is drawn is the wall itself, and the rest is on the side of the pet
      if (side === 1) expect(x! + w!).toBe(wall);
      else expect(x).toBe(wall);
      expect(y! + h! / 2).toBe(400);
    }
  });

  it('cuts nothing when the pet does not hide', () => {
    expect(named(draw('peek', skin(), { wall: null }), 'clip')).toHaveLength(0);
    expect(named(draw('idle', skin(), { wall: 700 }), 'clip')).toHaveLength(0);
  });
});
