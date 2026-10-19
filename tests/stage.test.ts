import { describe, expect, it } from 'vitest';
import { mulberry32, type Vec2 } from '../src/engine';
import { DEFAULT_SETTINGS, type Area, type Settings, type SkinReport, type ViewFrame } from '../src/shared/types';
import { Stage, type StageWindow } from '../src/shell/stage';

const GEOMETRY: SkinReport = { box: { w: 128, h: 128, anchorX: 0.5, anchorY: 0.94 }, hitbox: { x: 0.18, y: 0.22, w: 0.64, h: 0.72 }, lines: {} };
const SETTINGS: Settings = { ...DEFAULT_SETTINGS, mode: 'wander', roam: 'floor', skin: 'default' };

// two monitors side by side; the right one is taller, so its floor is lower
const LEFT: Area = { x: 0, y: 0, width: 1280, height: 680 };
const RIGHT: Area = { x: 1280, y: 0, width: 1024, height: 768 };

class FakeWindow implements StageWindow {
  ignoring = true;
  toggles = 0;
  frames: (ViewFrame | null)[] = [];
  constructor(readonly area: Area) {}
  setIgnoring(ignore: boolean): void {
    this.ignoring = ignore;
    this.toggles++;
  }
  send(frame: ViewFrame | null): void {
    this.frames.push(frame ? structuredClone(frame) : null);
  }
  get last(): ViewFrame | null {
    return this.frames.at(-1) ?? null;
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
    stage.setSkin({ box: { w: 256, h: 256, anchorX: 0.5, anchorY: 0.9 }, hitbox: { x: 0.2, y: 0.2, w: 0.6, h: 0.75 }, lines: {} });
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
