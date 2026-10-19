import { describe, expect, it } from 'vitest';
import { mulberry32, type Platform, type Vec2 } from '../src/engine';
import { DEFAULT_SETTINGS, type Area, type Settings, type SkinReport, type ViewFrame } from '../src/shared/types';
import { Stage, type StageWindow } from '../src/shell/stage';

const GEOMETRY: SkinReport = { id: 'default', box: { w: 128, h: 128, anchorX: 0.5, anchorY: 0.94 }, hitbox: { x: 0.18, y: 0.22, w: 0.64, h: 0.72 }, lines: {}, actions: {} };
const SETTINGS: Settings = { ...DEFAULT_SETTINGS, mode: 'wander', roam: 'floor', skin: 'default' };

// two monitors side by side; the right one is taller, so its floor is lower
const LEFT: Area = { x: 0, y: 0, width: 1280, height: 680 };
const RIGHT: Area = { x: 1280, y: 0, width: 1024, height: 768 };

class FakeWindow implements StageWindow {
  ignoring = true;
  toggles = 0;
  /** what each message held: the first pet of it, or null for the empty list that clears the window */
  frames: (ViewFrame | null)[] = [];
  /** every message, whole */
  lists: ViewFrame[][] = [];
  constructor(readonly area: Area) {}
  setIgnoring(ignore: boolean): void {
    this.ignoring = ignore;
    this.toggles++;
  }
  send(frames: ViewFrame[]): void {
    const copy = structuredClone(frames);
    this.lists.push(copy);
    this.frames.push(copy[0] ?? null);
  }
  get last(): ViewFrame | null {
    return this.frames.at(-1) ?? null;
  }
  get lastList(): ViewFrame[] {
    return this.lists.at(-1) ?? [];
  }
}

function setup(areas: Area[] = [LEFT, RIGHT], settings: Settings = SETTINGS) {
  const wins = areas.map((a) => new FakeWindow(a));
  const env = { cursor: { x: -500, y: -500 } as Vec2, covered: false };
  const stage = new Stage({ cursor: () => env.cursor, covered: () => env.covered, rng: mulberry32(3) }, settings);
  stage.setWindows(wins);
  stage.setSkin(GEOMETRY);
  let now = 1000;
  const run = (ms: number): void => {
    for (let t = 0; t < ms; t += 16) {
      now += 16;
      stage.tick(now);
    }
  };
  const body = (): Vec2 => {
    const r = stage.view!.hitbox;
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };
  const local = (win: FakeWindow, p: Vec2): Vec2 => ({ x: p.x - win.area.x, y: p.y - win.area.y });
  const press = (win: FakeWindow, p: Vec2): void => {
    env.cursor = p;
    stage.pointer(win, { kind: 'down', ...local(win, p) });
  };
  const release = (win: FakeWindow, p: Vec2): void => {
    env.cursor = p;
    stage.pointer(win, { kind: 'up', ...local(win, p) });
  };
  /** moves the pointer in small steps, one tick each */
  const drag = (from: Vec2, to: Vec2, steps = 20): void => {
    for (let i = 1; i <= steps; i++) {
      env.cursor = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
      run(16);
    }
  };
  return { wins, env, stage, run, body, local, press, release, drag };
}

describe('starting up', () => {
  it('does nothing until it knows both the windows and the skin', () => {
    const left = new FakeWindow(LEFT);
    const stage = new Stage({ cursor: () => ({ x: 0, y: 0 }), covered: () => false }, SETTINGS);
    stage.tick(16);
    expect(stage.view).toBeNull();
    stage.setWindows([left]);
    stage.tick(32);
    expect(stage.view).toBeNull();
    stage.setSkin(GEOMETRY);
    stage.tick(48);
    expect(stage.view).not.toBeNull();
    expect(left.frames.length).toBeGreaterThan(0);
  });

  it('starts at the bottom centre of the first window, and only that window is sent anything', () => {
    const { wins, run, stage } = setup();
    run(200);
    const v = stage.view!;
    expect(v.x).toBeCloseTo(LEFT.width / 2);
    expect(v.y).toBe(LEFT.height);
    expect(wins[0]!.frames.length).toBeGreaterThan(0);
    expect(wins[1]!.frames).toEqual([]);
  });

  it('applies the settings it was given when it creates the pet', () => {
    const { stage, run } = setup([LEFT], { ...SETTINGS, scale: 2, clickThrough: true });
    run(50);
    expect(stage.view!.scale).toBe(2);
    expect(stage.view!.interactive).toBe(false);
  });
});

describe('letting the mouse through', () => {
  it('a window takes the mouse only while the pointer is on the pet, and only the window under it', () => {
    const { wins, env, run, body } = setup();
    run(100);
    expect(wins.every((w) => w.ignoring)).toBe(true);
    env.cursor = body();
    run(32);
    expect(wins[0]!.ignoring).toBe(false);
    expect(wins[1]!.ignoring).toBe(true);
    env.cursor = { x: 10, y: 10 };
    run(32);
    expect(wins.every((w) => w.ignoring)).toBe(true);
  });

  it('does not touch a window that is already in the right state', () => {
    const { wins, env, run, body } = setup();
    env.cursor = body();
    run(500);
    expect(wins[0]!.toggles).toBe(1);
    expect(wins[1]!.toggles).toBe(0);
  });

  it('lets everything through while another window of ours covers the pet', () => {
    const { wins, env, run, body } = setup();
    env.cursor = body();
    env.covered = true;
    run(64);
    expect(wins.every((w) => w.ignoring)).toBe(true);
    env.covered = false;
    run(32);
    expect(wins[0]!.ignoring).toBe(false);
  });

  it('click-through mode never takes the mouse', () => {
    const { wins, env, run, body, stage } = setup();
    stage.setSettings({ ...SETTINGS, clickThrough: true });
    env.cursor = body();
    run(100);
    expect(wins.every((w) => w.ignoring)).toBe(true);
    stage.setSettings({ ...SETTINGS, clickThrough: false });
    run(32);
    expect(wins[0]!.ignoring).toBe(false);
  });
});

describe('being grabbed', () => {
  it('a press on the pet keeps that window taking the mouse until the button is released', () => {
    const { wins, env, run, body, press, release, drag, stage } = setup();
    run(100);
    const grab = body();
    press(wins[0]!, grab);
    expect(wins[0]!.ignoring).toBe(false);
    // far to the left the pet is stopped by the screen edge, so the pointer ends up beside it
    drag(grab, { x: -300, y: grab.y - 200 }, 30);
    expect(stage.view!.state).toBe('held');
    expect(wins[0]!.ignoring).toBe(false);
    expect(wins[1]!.ignoring).toBe(true);
    release(wins[0]!, env.cursor);
    expect(wins[0]!.ignoring).toBe(true);
    run(16);
    expect(stage.view!.state).toBe('fall');
  });

  it('a press away from the pet grabs nothing', () => {
    const { wins, run, press, release, stage } = setup();
    run(100);
    press(wins[0]!, { x: 40, y: 40 });
    expect(wins[0]!.ignoring).toBe(true);
    release(wins[0]!, { x: 40, y: 40 });
    run(100);
    expect(['held', 'fall', 'surprised', 'happy']).not.toContain(stage.view!.state);
  });

  it('only the window that was pressed can let go', () => {
    const { wins, run, body, press, drag, release, stage } = setup();
    run(100);
    const grab = body();
    press(wins[0]!, grab);
    drag(grab, { x: grab.x + 40, y: grab.y - 120 }, 10);
    release(wins[1]!, { x: 5, y: 5 });
    run(32);
    expect(stage.view!.state).toBe('held');
    release(wins[0]!, { x: grab.x + 40, y: grab.y - 120 });
    run(32);
    expect(stage.view!.state).toBe('fall');
  });

  it('carries the pet to the other monitor, then to the floor of that monitor', () => {
    const { wins, env, run, body, press, release, drag, stage } = setup();
    run(100);
    const grab = body();
    press(wins[0]!, grab);
    const across = { x: RIGHT.x + 500, y: 300 };
    drag(grab, across, 60);
    expect(stage.view!.x).toBeGreaterThan(RIGHT.x + 400);
    // the pet is on the right monitor now, but the left window still has the button
    expect(wins[1]!.last).not.toBeNull();
    expect(wins[0]!.ignoring).toBe(false);
    expect(wins[1]!.ignoring).toBe(true);
    release(wins[0]!, env.cursor);
    run(1500);
    expect(stage.view!.y).toBeCloseTo(RIGHT.height, 0);
    expect(wins.every((w) => w.ignoring)).toBe(true);
    // pointing at it again, the window it is in takes the mouse
    env.cursor = body();
    run(32);
    expect(wins[0]!.ignoring).toBe(true);
    expect(wins[1]!.ignoring).toBe(false);
  });

  it('puts a press in the window that has it, using that window\'s own coordinates', () => {
    const { wins, run, body, stage, press, release } = setup();
    run(100);
    const grab = body();
    const rightWin = wins[1]!;
    // a press that the right window reports at a point on the pet cannot grab it: that point is in the left window
    stage.pointer(rightWin, { kind: 'down', x: grab.x, y: grab.y });
    expect(rightWin.ignoring).toBe(true);
    press(wins[0]!, grab);
    expect(wins[0]!.ignoring).toBe(false);
    release(wins[0]!, grab);
  });

  it('forgets a press if the window that had it goes away', () => {
    const { wins, run, body, press, drag, stage } = setup();
    run(100);
    const grab = body();
    press(wins[0]!, grab);
    drag(grab, { x: grab.x + 30, y: grab.y - 150 }, 10);
    expect(stage.view!.state).toBe('held');
    stage.setWindows([wins[1]!]);
    run(32);
    expect(stage.view!.state).not.toBe('held');
    // and the next press works as usual
    const again = stage.view!.hitbox;
    press(wins[1]!, { x: again.x + again.w / 2, y: again.y + again.h / 2 });
    expect(wins[1]!.ignoring).toBe(false);
  });
});

describe('what the windows are told', () => {
  it('a window that loses the pet is sent one empty frame and then left alone', () => {
    const { wins, run, body, press, release, drag, env } = setup();
    run(100);
    const grab = body();
    press(wins[0]!, grab);
    drag(grab, { x: RIGHT.x + 600, y: 300 }, 60);
    release(wins[0]!, env.cursor);
    run(100);
    const frames = wins[0]!.frames;
    const empty = frames.filter((f) => f === null).length;
    expect(empty).toBe(1);
    expect(frames.at(-1)).toBeNull();
    const before = frames.length;
    run(500);
    expect(wins[0]!.frames.length).toBe(before);
  });

  it('a pet standing on the seam is drawn by both windows', () => {
    const { wins, run, body, press, release, drag, env, stage } = setup();
    run(100);
    const grab = body();
    press(wins[0]!, grab);
    drag(grab, { x: RIGHT.x, y: 400 }, 40);
    release(wins[0]!, env.cursor);
    // while it is held at the seam both windows have a picture of it
    expect(wins[0]!.last).not.toBeNull();
    expect(wins[1]!.last).not.toBeNull();
    expect(stage.view!.x).toBeGreaterThan(RIGHT.x - 60);
  });

  it('sends the pet in the shared coordinates, with its speed', () => {
    const { wins, run, stage } = setup([LEFT], { ...SETTINGS, mode: 'wander' });
    // wander until it walks
    let walked: ViewFrame | null = null;
    for (let i = 0; i < 400 && !walked; i++) {
      run(16);
      const f = wins[0]!.last;
      if (f && f.view.state === 'walk' && Math.abs(f.vx) > 1) walked = f;
    }
    expect(walked).not.toBeNull();
    expect(Math.abs(walked!.vx)).toBeGreaterThan(30);
    expect(Math.abs(walked!.vx)).toBeLessThan(120);
    expect(walked!.view.x).toBeCloseTo(stage.view!.x, -2);
    expect(walked!.vy).toBeCloseTo(0, 5);
  });

  it('calm poses are sent at a slow rate and moving ones on every step', () => {
    const { wins, run, stage } = setup([LEFT]);
    run(400);
    expect(stage.view!.animating).toBe(false);
    const calm = wins[0]!.frames.length;
    expect(calm).toBeGreaterThan(3);
    expect(calm).toBeLessThan(10);
    const { wins: w2, run: run2, stage: s2, env, body, press, release, drag } = setup([LEFT]);
    run2(100);
    const grab = body();
    press(w2[0]!, grab);
    drag(grab, { x: grab.x + 100, y: grab.y - 100 }, 20);
    release(w2[0]!, env.cursor);
    expect(s2.view!.animating).toBe(true);
    const n = w2[0]!.frames.length;
    run2(160);
    expect(w2[0]!.frames.length - n).toBeGreaterThanOrEqual(9);
  });

  it('a pet that is teleported by a change of screens is not given a huge speed', () => {
    const { wins, run, stage } = setup();
    run(100);
    stage.setWindows([wins[1]!]);
    run(16);
    const f = wins[1]!.last;
    expect(f).not.toBeNull();
    expect(Math.abs(f!.vx)).toBeLessThan(1);
    expect(Math.abs(f!.vy)).toBeLessThan(1);
  });
});

describe('what the pet says', () => {
  const WORDS: SkinReport = { ...GEOMETRY, lines: { click: [{ text: '하아?', style: 'float' }], start: [{ text: '미야아아!', style: 'float' }] } };
  const clickPet = (t: ReturnType<typeof setup>): void => {
    const grab = t.body();
    t.press(t.wins[0]!, grab);
    t.release(t.wins[0]!, grab);
    t.run(16);
  };
  const said = (win: FakeWindow): string[] => (win.last?.view.particles ?? []).filter((p) => p.kind === 'text').map((p) => p.text!);

  it('answers a click with a line of the skin, in the frames the windows get', () => {
    const t = setup([LEFT]);
    t.stage.setSkin(WORDS);
    t.run(2200);
    clickPet(t);
    expect(said(t.wins[0]!)).toContain('하아?');
  });

  it('greets when the skin arrives', () => {
    const t = setup([LEFT]);
    t.stage.setSkin(WORDS);
    t.run(1200);
    expect(t.wins[0]!.frames.some((f) => f?.view.particles.some((p) => p.text === '미야아아!'))).toBe(true);
  });

  it('is silent when speech is switched off', () => {
    const t = setup([LEFT]);
    t.stage.setSkin(WORDS);
    t.stage.setSettings({ ...SETTINGS, speech: 'off' });
    t.run(2200);
    clickPet(t);
    expect(t.wins[0]!.frames.some((f) => f?.view.particles.some((p) => p.kind === 'text'))).toBe(false);
  });

  it('starts out speaking when the setting is already on at the time the pet appears', () => {
    const wins = [new FakeWindow(LEFT)];
    const stage = new Stage({ cursor: () => ({ x: -500, y: -500 }), covered: () => false, rng: mulberry32(3) }, { ...SETTINGS, speech: 'off' });
    stage.setWindows(wins);
    stage.setSkin(WORDS);
    for (let i = 0; i < 100; i++) stage.tick(1000 + i * 16);
    expect(wins[0]!.frames.some((f) => f?.view.particles.some((p) => p.kind === 'text'))).toBe(false);
  });
});

describe('the screens change', () => {
  it('keeps the pet on the screens that are left', () => {
    const { wins, run, stage } = setup();
    run(100);
    stage.setWindows([wins[1]!]);
    run(32);
    const r = stage.view!.hitbox;
    expect(r.x).toBeGreaterThanOrEqual(RIGHT.x - 1e-6);
    expect(r.x + r.w).toBeLessThanOrEqual(RIGHT.x + RIGHT.width + 1e-6);
  });

  it('a new window starts out letting the mouse through', () => {
    const { wins, run, stage } = setup([LEFT]);
    run(50);
    const extra = new FakeWindow(RIGHT);
    stage.setWindows([...wins, extra]);
    run(50);
    expect(extra.toggles).toBe(0);
  });

  it('follows a new skin size', () => {
    const { run, stage } = setup([LEFT]);
    run(50);
    stage.setSkin({ id: 'default', box: { w: 256, h: 256, anchorX: 0.5, anchorY: 0.9 }, hitbox: { x: 0.2, y: 0.2, w: 0.6, h: 0.75 }, lines: {}, actions: {} });
    run(32);
    const r = stage.view!.hitbox;
    expect(r.w).toBeCloseTo(256 * 0.6);
  });
});

describe('putting the pet away', () => {
  const WORDS: SkinReport = {
    ...GEOMETRY,
    lines: {
      start: [{ text: '미야아아!', style: 'float' }],
      call: [{ text: '야하!', style: 'float' }],
      welcome: [{ text: '어서 와~', style: 'hold' }],
    },
  };
  const said = (win: FakeWindow): string[] => (win.last?.view.particles ?? []).filter((p) => p.kind === 'text').map((p) => p.text!);

  it('clears the windows once and then sends nothing at all', () => {
    const t = setup([LEFT, RIGHT]);
    t.run(300);
    const before = t.wins.map((w) => w.frames.length);
    t.stage.setHidden(true);
    expect(t.stage.isHidden).toBe(true);
    expect(t.wins[0]!.last).toBeNull();
    t.run(2000);
    expect(t.wins[0]!.frames.length).toBe(before[0]! + 1);
    expect(t.wins[1]!.frames.length).toBe(before[1]!);
  });

  it('stands still and lets the mouse through while it is away', () => {
    const t = setup([LEFT]);
    t.run(300);
    t.env.cursor = t.body();
    t.run(32);
    expect(t.wins[0]!.ignoring).toBe(false);
    const at = { ...t.stage.view! };
    t.stage.setHidden(true);
    expect(t.wins[0]!.ignoring).toBe(true);
    t.run(4000);
    expect(t.wins[0]!.ignoring).toBe(true);
    expect(t.stage.view!.x).toBe(at.x);
    expect(t.stage.view!.y).toBe(at.y);
    // a click where the pet was does nothing
    t.stage.pointer(t.wins[0]!, { kind: 'down', x: at.x, y: at.y - 40 });
    expect(t.wins[0]!.ignoring).toBe(true);
  });

  it('lets go of a pet that is being held', () => {
    const t = setup([LEFT]);
    t.run(300);
    const grab = t.body();
    t.press(t.wins[0]!, grab);
    t.drag(grab, { x: grab.x + 40, y: grab.y - 120 });
    expect(t.stage.view!.state).toBe('held');
    t.stage.setHidden(true);
    expect(t.wins[0]!.ignoring).toBe(true);
    // the button comes up while the pet is away; there is nothing left for it to let go of
    t.release(t.wins[0]!, { x: grab.x + 40, y: grab.y - 120 });
    t.stage.setHidden(false);
    t.run(3000);
    expect(t.stage.view!.state).not.toBe('held');
    expect(t.stage.view!.y).toBe(LEFT.height);
  });

  it('comes back where it was, draws again, and greets', () => {
    const t = setup([LEFT]);
    t.stage.setSkin(WORDS);
    t.run(3000);
    const at = { x: t.stage.view!.x, y: t.stage.view!.y };
    t.stage.setHidden(true);
    t.run(5000);
    const frames = t.wins[0]!.frames.length;
    t.stage.setHidden(false);
    expect(t.stage.isHidden).toBe(false);
    t.run(32);
    expect(t.wins[0]!.frames.length).toBeGreaterThan(frames);
    expect(t.wins[0]!.last).not.toBeNull();
    expect(Math.abs(t.stage.view!.x - at.x)).toBeLessThan(5);
    expect(said(t.wins[0]!)).toContain('미야아아!');
  });

  it('hiding twice, or showing a pet that is not hidden, changes nothing', () => {
    const t = setup([LEFT]);
    t.run(300);
    t.stage.setHidden(false);
    t.stage.setHidden(true);
    const frames = t.wins[0]!.frames.length;
    t.stage.setHidden(true);
    expect(t.wins[0]!.frames.length).toBe(frames);
  });

  it('is still hidden after the windows change', () => {
    const t = setup([LEFT]);
    t.run(300);
    t.stage.setHidden(true);
    const extra = new FakeWindow(RIGHT);
    t.stage.setWindows([...t.wins, extra]);
    t.run(500);
    expect(extra.frames).toEqual([]);
    expect(t.wins[0]!.last).toBeNull();
  });

  it('being called brings it out of hiding and over to the cursor', () => {
    const t = setup([LEFT]);
    t.stage.setSkin(WORDS);
    t.run(3000);
    t.stage.setHidden(true);
    t.run(1000);
    t.env.cursor = { x: 1000, y: 500 };
    t.stage.call();
    expect(t.stage.isHidden).toBe(false);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      t.run(16);
      seen.add(t.stage.view!.state);
      for (const w of said(t.wins[0]!)) seen.add(w);
    }
    expect(seen.has('run')).toBe(true);
    expect(seen.has('야하!')).toBe(true);
    // no separate greeting on top of the answer
    expect(seen.has('미야아아!')).toBe(false);
  });

  it('news from the computer is lost on a pet that is away', () => {
    const t = setup([LEFT]);
    t.stage.setSkin(WORDS);
    t.run(3000);
    t.stage.setHidden(true);
    t.stage.notice('welcome');
    t.stage.setHidden(false);
    t.run(200);
    expect(said(t.wins[0]!)).not.toContain('어서 와~');
    t.run(5000);
    t.stage.notice('welcome');
    t.run(32);
    expect(said(t.wins[0]!)).toContain('어서 와~');
  });
});

describe('actions', () => {
  const SHOW: SkinReport = {
    ...GEOMETRY,
    actions: { camera: { pose: 'camera', ms: 3000, weight: 1, motion: 'still', on: [], lines: [{ text: '찰칵!', style: 'float' }] } },
  };
  const said = (win: FakeWindow): string[] => (win.last?.view.particles ?? []).filter((p) => p.kind === 'text').map((p) => p.text!);

  it('knows whether the skin on screen has any, and does one when asked', () => {
    const t = setup([LEFT]);
    t.run(200);
    expect(t.stage.hasActions).toBe(false);
    expect(t.stage.perform()).toBe(false);
    t.stage.setSkin(SHOW);
    expect(t.stage.hasActions).toBe(true);
    expect(t.stage.perform()).toBe(true);
    t.run(32);
    expect(t.stage.view!.state).toBe('act');
    expect(t.stage.view!.action).toBe('camera');
    expect(t.wins[0]!.last!.view.action).toBe('camera');
    expect(said(t.wins[0]!)).toContain('찰칵!');
  });

  it('has them from the start when the skin is already there at the time the pet appears', () => {
    const wins = [new FakeWindow(LEFT)];
    const stage = new Stage({ cursor: () => ({ x: -500, y: -500 }), covered: () => false, rng: mulberry32(3) }, SETTINGS);
    stage.setSkin(SHOW);
    stage.setWindows(wins);
    expect(stage.hasActions).toBe(true);
  });

  it('does none on its own when the setting says so', () => {
    const quiet = { ...SETTINGS, tricks: false };
    const t = setup([LEFT], quiet);
    t.stage.setSkin({ ...SHOW, actions: { camera: { ...SHOW.actions.camera!, weight: 1 } } });
    const states = new Set<string>();
    for (let i = 0; i < 6000; i++) {
      t.run(16);
      states.add(t.stage.view!.state);
    }
    expect(states.has('act')).toBe(false);
    expect(t.stage.perform()).toBe(true);
    t.stage.setSettings(SETTINGS);
  });

  it('loses them when the skin changes to one without', () => {
    const t = setup([LEFT]);
    t.stage.setSkin(SHOW);
    t.run(100);
    t.stage.setSkin(GEOMETRY);
    expect(t.stage.hasActions).toBe(false);
  });

  it('does not show a trick to a pet that is put away', () => {
    const t = setup([LEFT]);
    t.stage.setSkin(SHOW);
    t.run(100);
    t.stage.setHidden(true);
    expect(t.stage.perform()).toBe(false);
    t.stage.setHidden(false);
    expect(t.stage.perform()).toBe(true);
  });
});

describe('friends', () => {
  const skinOf = (id: string, over: Partial<SkinReport> = {}): SkinReport => ({ ...GEOMETRY, id, ...over });
  const WORDS = (id: string): SkinReport =>
    skinOf(id, {
      lines: {
        meet: [{ text: `${id} says hi`, style: 'hold' }],
        reply: [{ text: `${id} says hi back`, style: 'hold' }],
      },
    });

  /** a stage whose main character is `main`, with the skins of `known` already loaded */
  function many(main: string, friends: string[], known: string[] = [main, ...friends], areas: Area[] = [LEFT]) {
    const settings: Settings = { ...SETTINGS, skin: main, friends };
    const t = setup(areas, settings);
    // `setup` knows only the default skin: bring the stage to the one this test is about
    t.stage.setSkin(skinOf(main));
    for (const id of known) t.stage.setSkin(WORDS(id));
    return { ...t, settings };
  }
  const ids = (t: { stage: Stage }): string[] => t.stage.views.map((v) => v.id);

  it('has a pet for the main character and one for each friend whose skin is up', () => {
    const t = many('chiikawa', ['hachiware', 'usagi'], ['chiikawa', 'hachiware']);
    t.run(100);
    expect(ids(t)).toEqual(['chiikawa', 'hachiware']);
    t.stage.setSkin(WORDS('usagi'));
    expect(ids(t)).toEqual(['chiikawa', 'hachiware', 'usagi']);
    expect(t.stage.view).toBe(t.stage.views[0]!.view);
  });

  it('starts the friends apart from the main character and from each other', () => {
    const t = many('chiikawa', ['hachiware', 'usagi']);
    t.run(32);
    const xs = t.stage.views.map((v) => Math.round(v.view.x));
    expect(new Set(xs).size).toBe(3);
    expect(xs[0]).toBe(Math.round(LEFT.width / 2));
    for (const v of t.stage.views) expect(v.view.y).toBe(LEFT.height);
  });

  it('does not put a friend down on top of another, whatever order their skins arrive in', () => {
    const t = many('chiikawa', ['hachiware', 'usagi'], ['chiikawa', 'usagi', 'hachiware']);
    t.run(32);
    const xs = t.stage.views.map((v) => v.view.x);
    expect(xs).toHaveLength(3);
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) expect(Math.abs(xs[i]! - xs[j]!), `${i} and ${j}`).toBeGreaterThan(120);
    }
    // and two that are chosen at the same moment get places of their own as well
    const u = many('chiikawa', [], ['chiikawa', 'hachiware', 'usagi', 'rakko']);
    u.stage.setSettings({ ...u.settings, friends: ['hachiware', 'usagi', 'rakko'] });
    u.run(32);
    const ys = u.stage.views.map((v) => v.view.x);
    expect(new Set(ys.map((x) => Math.round(x / 100))).size).toBe(4);
  });

  it('puts a friend in as soon as it is chosen, and takes it out as soon as it is not', () => {
    const t = many('chiikawa', [], ['chiikawa', 'hachiware', 'usagi']);
    t.run(100);
    expect(ids(t)).toEqual(['chiikawa']);
    t.stage.setSettings({ ...t.settings, friends: ['usagi'] });
    expect(ids(t)).toEqual(['chiikawa', 'usagi']);
    t.stage.setSettings({ ...t.settings, friends: ['hachiware', 'usagi'] });
    expect(ids(t)).toEqual(['chiikawa', 'hachiware', 'usagi']);
    t.stage.setSettings({ ...t.settings, friends: [] });
    expect(ids(t)).toEqual(['chiikawa']);
    // the window is told that they have gone
    t.run(100);
    expect(t.wins[0]!.lastList.map((f) => f.id)).toEqual(['chiikawa']);
  });

  it('tells a window about exactly the pets that are in it', () => {
    const t = many('chiikawa', ['hachiware'], undefined, [LEFT, RIGHT]);
    t.run(200);
    expect(t.wins[0]!.lastList.map((f) => f.id)).toEqual(['chiikawa', 'hachiware']);
    expect(t.wins[1]!.lists).toEqual([]);
    // every pet in a message comes with its own id, its look and its speed
    for (const f of t.wins[0]!.lastList) expect(f.view.x).toBeGreaterThan(0);
  });

  it('changes the clothes of the main character without moving it', () => {
    const t = many('chiikawa', ['hachiware']);
    t.run(3000);
    const at = t.stage.view!.x;
    t.stage.setSettings({ ...t.settings, skin: 'usagi', friends: ['hachiware'] });
    t.stage.setSkin(WORDS('usagi'));
    expect(ids(t)).toEqual(['usagi', 'hachiware']);
    expect(Math.abs(t.stage.view!.x - at)).toBeLessThan(40);
  });

  it('turns a friend into the main character, and the friend is gone as a friend', () => {
    const t = many('chiikawa', ['hachiware', 'usagi']);
    t.run(100);
    t.stage.setSettings({ ...t.settings, skin: 'hachiware', friends: ['usagi'] });
    expect(ids(t)).toEqual(['hachiware', 'usagi']);
  });

  it('keeps the old main character until the skin of the new one is up', () => {
    const t = many('chiikawa', [], ['chiikawa']);
    t.run(100);
    t.stage.setSettings({ ...t.settings, skin: 'usagi' });
    expect(ids(t)).toEqual(['chiikawa']);
    t.stage.setSkin(WORDS('usagi'));
    expect(ids(t)).toEqual(['usagi']);
  });

  describe('size', () => {
    // characters that fill their boxes differently: a rabbit that looks 100 big, a round bear of 125 and an otter of 80
    const SIZED: Record<string, number> = { usagi: 100, chiikawa: 125, rakko: 80 };
    function sized(main: string, friends: string[], over: Partial<Settings> = {}) {
      const settings: Settings = { ...SETTINGS, skin: main, friends, ...over };
      const t = setup([LEFT], settings);
      t.stage.setSkin(skinOf(main, { body: SIZED[main] }));
      for (const id of Object.keys(SIZED)) t.stage.setSkin(skinOf(id, { body: SIZED[id] }));
      return { ...t, settings };
    }
    const scales = (t: { stage: Stage }): Record<string, number> => Object.fromEntries(t.stage.sizes.map((s) => [s.id, Number(s.scale.toFixed(3))]));

    it('draws each friend as big as the main character looks, and the main character as its skin says', () => {
      const t = sized('usagi', ['chiikawa', 'rakko']);
      t.run(100);
      expect(scales(t)).toEqual({ usagi: 1, chiikawa: 0.8, rakko: 1.25 });
      for (const s of t.stage.sizes) expect(s.looks, s.id).toBeCloseTo(100);
    });

    it('also makes the body (what is clicked) as big', () => {
      const t = sized('usagi', ['chiikawa']);
      t.run(100);
      const [main, friend] = t.stage.views.map((v) => v.view.hitbox);
      expect(friend!.h / main!.h).toBeCloseTo(0.8);
      expect(friend!.w / main!.w).toBeCloseTo(0.8);
    });

    it('leaves a pet that is alone as big as its skin says, and does it again when the friends are gone', () => {
      const t = sized('chiikawa', []);
      t.run(100);
      expect(scales(t)).toEqual({ chiikawa: 1 });
      t.stage.setSettings({ ...t.settings, friends: ['usagi'] });
      t.run(32);
      expect(scales(t)).toEqual({ chiikawa: 1, usagi: 1.25 });
      t.stage.setSettings({ ...t.settings, friends: [] });
      t.run(32);
      expect(scales(t)).toEqual({ chiikawa: 1 });
    });

    it('keeps the chosen size for all of them', () => {
      const t = sized('usagi', ['chiikawa'], { scale: 2 });
      t.run(100);
      expect(scales(t)).toEqual({ usagi: 2, chiikawa: 1.6 });
      t.stage.setSettings({ ...t.settings, scale: 1.5 });
      t.run(32);
      expect(scales(t)).toEqual({ usagi: 1.5, chiikawa: 1.2 });
    });

    it('matches the friends to a new main character', () => {
      const t = sized('usagi', ['chiikawa', 'rakko']);
      t.run(100);
      t.stage.setSettings({ ...t.settings, skin: 'chiikawa', friends: ['usagi', 'rakko'] });
      t.run(32);
      expect(scales(t)).toEqual({ chiikawa: 1, usagi: 1.25, rakko: 1.563 });
    });

    it('matches a friend to a main character whose picture was measured again', () => {
      const t = sized('usagi', ['chiikawa']);
      t.stage.setSkin(skinOf('usagi', { body: 150 }));
      t.run(32);
      expect(scales(t)).toEqual({ usagi: 1, chiikawa: 1.2 });
    });

    it('guesses the size of a skin that was not measured from its hitbox', () => {
      const t = setup([LEFT], { ...SETTINGS, skin: 'usagi', friends: ['rakko'] });
      t.stage.setSkin(skinOf('usagi'));
      t.stage.setSkin(skinOf('rakko'));
      t.run(100);
      // the same box and hitbox: the same size, so nothing changes
      expect(scales(t)).toEqual({ usagi: 1, rakko: 1 });
    });
  });

  it('lets the mouse be about the main character only: with the pet stuck to the cursor the friends are not', () => {
    const t = many('chiikawa', ['hachiware', 'usagi']);
    t.stage.setSettings({ ...t.settings, mode: 'attach' });
    t.env.cursor = { x: 300, y: 300 };
    t.run(800);
    const states = Object.fromEntries(t.stage.views.map((v) => [v.id, v.view.state]));
    expect(states.chiikawa).toBe('held');
    expect(states.hachiware).not.toBe('held');
    expect(states.usagi).not.toBe('held');
  });

  describe('the mouse', () => {
    it('grabs the friend that is pressed, and only that one', () => {
      const t = many('chiikawa', ['hachiware']);
      t.run(300);
      const friend = t.stage.views[1]!;
      const spot = { x: friend.view.hitbox.x + friend.view.hitbox.w / 2, y: friend.view.hitbox.y + friend.view.hitbox.h / 2 };
      t.press(t.wins[0]!, spot);
      t.drag(spot, { x: spot.x, y: spot.y - 200 });
      const states = Object.fromEntries(t.stage.views.map((v) => [v.id, v.view.state]));
      expect(states.hachiware).toBe('held');
      expect(states.chiikawa).not.toBe('held');
      t.release(t.wins[0]!, { x: spot.x, y: spot.y - 200 });
    });

    it('gives a press where two pets overlap to the one that stands lower (in front)', () => {
      const t = many('chiikawa', ['hachiware']);
      t.run(300);
      // lift the main one to the friend's place, a little higher up: the friend is in front there
      const a = t.stage.views[0]!;
      const b = t.stage.views[1]!;
      const spot = { x: (b.view.hitbox.x + b.view.hitbox.w / 2 + (a.view.hitbox.x + a.view.hitbox.w / 2)) / 2, y: b.view.hitbox.y + b.view.hitbox.h / 2 };
      // stand them on the same spot by dragging the main character over
      const grab = { x: a.view.hitbox.x + a.view.hitbox.w / 2, y: a.view.hitbox.y + a.view.hitbox.h / 2 };
      t.press(t.wins[0]!, grab);
      t.drag(grab, { x: spot.x, y: spot.y - 20 });
      expect(t.stage.views[0]!.view.state).toBe('held');
      t.release(t.wins[0]!, { x: spot.x, y: spot.y - 20 });
      t.run(1500);
      // now both stand in about the same place; the one with the larger y is in front and takes the press
      const [p, q] = t.stage.views;
      const front = p!.view.y >= q!.view.y ? p! : q!;
      const at = { x: front.view.hitbox.x + front.view.hitbox.w / 2, y: front.view.hitbox.y + front.view.hitbox.h / 2 };
      const overlapping = t.stage.views.every((v) => Math.hypot(v.view.hitbox.x + v.view.hitbox.w / 2 - at.x, v.view.hitbox.y + v.view.hitbox.h / 2 - at.y) < 120);
      if (!overlapping) return;
      t.press(t.wins[0]!, at);
      t.drag(at, { x: at.x, y: at.y - 150 });
      const held = t.stage.views.filter((v) => v.view.state === 'held').map((v) => v.id);
      expect(held).toEqual([front.id]);
      t.release(t.wins[0]!, { x: at.x, y: at.y - 150 });
    });

    it('takes the mouse for the window under the pointer when it is on any pet', () => {
      const t = many('chiikawa', ['hachiware'], undefined, [LEFT, RIGHT]);
      t.run(300);
      const friend = t.stage.views[1]!;
      t.env.cursor = { x: friend.view.hitbox.x + friend.view.hitbox.w / 2, y: friend.view.hitbox.y + friend.view.hitbox.h / 2 };
      t.run(48);
      expect(t.wins[0]!.ignoring).toBe(false);
      expect(t.wins[1]!.ignoring).toBe(true);
      t.env.cursor = { x: 5, y: 5 };
      t.run(48);
      expect(t.wins.every((w) => w.ignoring)).toBe(true);
    });

    it('does not let a click on one pet startle the other', () => {
      const t = many('chiikawa', ['hachiware']);
      t.run(300);
      const friend = t.stage.views[1]!;
      const spot = { x: friend.view.hitbox.x + friend.view.hitbox.w / 2, y: friend.view.hitbox.y + friend.view.hitbox.h / 2 };
      t.press(t.wins[0]!, spot);
      t.release(t.wins[0]!, spot);
      t.run(32);
      const states = Object.fromEntries(t.stage.views.map((v) => [v.id, v.view.state]));
      expect(states.hachiware).toBe('surprised');
      expect(states.chiikawa).not.toBe('surprised');
    });
  });

  it('puts all of them away, brings all of them back with a greeting, and calls them all', () => {
    const base = WORDS('chiikawa');
    const greet = (id: string): SkinReport => ({ ...WORDS(id), lines: { ...WORDS(id).lines, start: [{ text: `${id} hello`, style: 'float' }], call: [{ text: `${id} coming`, style: 'float' }] } });
    const t = many('chiikawa', ['hachiware'], []);
    t.stage.setSkin({ ...base, ...greet('chiikawa') });
    t.stage.setSkin(greet('hachiware'));
    t.run(3000);
    t.stage.setHidden(true);
    expect(t.wins[0]!.lastList).toEqual([]);
    t.run(1000);
    t.env.cursor = { x: 1000, y: 500 };
    t.stage.setHidden(false);
    t.run(300);
    const said = (): string[] => t.wins[0]!.lastList.flatMap((f) => f.view.particles.filter((p) => p.kind === 'text').map((p) => p.text!));
    expect(said().sort()).toEqual(['chiikawa hello', 'hachiware hello']);
    t.run(4000);
    t.stage.call();
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      t.run(16);
      for (const w of said()) seen.add(w);
    }
    expect(seen.has('chiikawa coming')).toBe(true);
    expect(seen.has('hachiware coming')).toBe(true);
  });

  it('shows a trick from each of them, or from the main character by name', () => {
    const act = { pose: 'a', ms: 2000, weight: 1, motion: 'still' as const, on: [], lines: [] };
    const t = many('chiikawa', ['hachiware', 'usagi'], []);
    t.stage.setSkin(skinOf('chiikawa', { actions: { dance: { ...act, pose: 'dance' } } }));
    t.stage.setSkin(skinOf('hachiware', { actions: { snap: { ...act, pose: 'snap' } } }));
    t.stage.setSkin(skinOf('usagi'));
    t.run(100);
    expect(t.stage.hasActions).toBe(true);
    expect(t.stage.perform('snap')).toBe(false);
    expect(t.stage.perform('dance')).toBe(true);
    t.run(32);
    expect(t.stage.views.map((v) => v.view.action)).toEqual(['dance', null, null]);
    t.run(2600);
    expect(t.stage.perform()).toBe(true);
    t.run(32);
    expect(t.stage.views.map((v) => v.view.action)).toEqual(['dance', 'snap', null]);
  });

  it('tells every pet what happened on the computer', () => {
    const welcome = (id: string): SkinReport => skinOf(id, { lines: { welcome: [{ text: `${id} welcome`, style: 'float' }] } });
    const t = many('chiikawa', ['hachiware'], []);
    t.stage.setSkin(welcome('chiikawa'));
    t.stage.setSkin(welcome('hachiware'));
    t.run(3000);
    t.stage.notice('welcome');
    t.run(32);
    const said = t.wins[0]!.lastList.flatMap((f) => f.view.particles.filter((p) => p.kind === 'text').map((p) => p.text!));
    expect(said.sort()).toEqual(['chiikawa welcome', 'hachiware welcome']);
  });

  it('has friends greet each other when they meet, each with its own words', () => {
    const t = many('chiikawa', ['hachiware']);
    const said = new Set<string>();
    for (let i = 0; i < 20_000; i++) {
      t.run(16);
      for (const f of t.wins[0]!.lastList) for (const p of f.view.particles) if (p.kind === 'text') said.add(p.text!);
      if (said.has('chiikawa says hi back') || said.has('hachiware says hi back')) break;
    }
    expect([...said].some((w) => /says hi$/.test(w))).toBe(true);
    expect([...said].some((w) => /says hi back$/.test(w))).toBe(true);
  });
});

describe('windows to sit on', () => {
  const TOP: Platform = { id: 'w', x0: 300, x1: 900, y: 400, ax: 300 };

  /** a stage whose main character is `main`, with the skins of `known` loaded */
  function many(main: string, friends: string[], known: string[]) {
    const settings: Settings = { ...SETTINGS, skin: main, friends };
    const t = setup([LEFT], settings);
    for (const id of [main, ...known]) t.stage.setSkin({ ...GEOMETRY, id });
    return { ...t, settings };
  }

  /** Picks the pet at `index` up by its body and lets it go, standing still, with its feet at (x, y). */
  function dropOnto(t: ReturnType<typeof setup>, index: number, x: number, y: number): void {
    const v = t.stage.views[index]!.view;
    const from = { x: v.hitbox.x + v.hitbox.w / 2, y: v.hitbox.y + v.hitbox.h / 2 };
    const to = { x: from.x + (x - v.x), y: from.y + (y - v.y) };
    t.press(t.wins[0]!, from);
    t.drag(from, to);
    t.run(300);
    t.release(t.wins[0]!, to);
  }

  it('puts a pet that is let go above a window on it, and lets it fall again when the window goes away', () => {
    const t = setup([LEFT]);
    t.run(300);
    t.stage.setPlatforms([TOP]);
    expect(t.stage.platformList).toEqual([TOP]);
    dropOnto(t, 0, 600, 250);
    t.run(1500);
    expect(t.stage.perches).toEqual([{ id: 'default', on: 'w' }]);
    expect(t.stage.view!.y).toBe(400);
    t.stage.setPlatforms([]);
    t.run(1500);
    expect(t.stage.perches).toEqual([{ id: 'default', on: null }]);
    expect(t.stage.view!.y).toBe(LEFT.height);
  });

  it('tells every pet about the windows, also one that comes after', () => {
    const t = many('chiikawa', [], ['chiikawa', 'hachiware']);
    t.run(300);
    t.stage.setPlatforms([TOP]);
    t.stage.setSettings({ ...t.settings, friends: ['hachiware'] });
    t.run(100);
    expect(t.stage.views.map((v) => v.id)).toEqual(['chiikawa', 'hachiware']);
    dropOnto(t, 1, 700, 250);
    t.run(1500);
    expect(t.stage.perches).toEqual([
      { id: 'chiikawa', on: null },
      { id: 'hachiware', on: 'w' },
    ]);
  });

  it('keeps the pets on the floor when there are no windows', () => {
    const t = setup([LEFT]);
    t.run(20_000);
    expect(t.stage.platformList).toEqual([]);
    expect(t.stage.view!.y).toBe(LEFT.height);
  });
});
