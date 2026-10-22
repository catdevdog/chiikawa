import { describe, expect, it } from 'vitest';
import { mulberry32, type Vec2 } from '../src/engine';
import { windowOf } from '../src/engine/perch';
import { DEFAULT_SETTINGS, type Area, type Settings, type SkinReport, type ViewFrame } from '../src/shared/types';
import { platformsFrom, sidesFrom, type WindowBox } from '../src/shell/perch';
import { Stage, type StageWindow } from '../src/shell/stage';

/**
 * The stage with windows of other programs coming, going, moving and being minimized while pets are picked up, put down beside
 * their edges, clicked and called, in the settings of somebody who has just installed it and in others. What must hold all the
 * time: nothing throws, every number the pets report is a number, and a pet never stays at the side of a window that is no longer
 * there (or on top of one) for longer than a moment.
 */

const SCREEN: Area = { x: 0, y: 0, width: 1280, height: 680 };
const SKINS = ['usagi', 'hachiware', 'chiikawa'];
const say = (text: string) => [{ text, style: 'float' as const }, { text: `${text} ${text}`, style: 'hold' as const }];
const skin = (id: string): SkinReport => ({
  id,
  box: { w: 128, h: 128, anchorX: 0.5, anchorY: 0.94 },
  hitbox: { x: 0.18, y: 0.22, w: 0.64, h: 0.72 },
  lines: { start: say(id), click: say('click'), idle: say('idle'), peek: say('peek'), found: say('found'), call: say('call'), meet: say('meet'), reply: say('reply'), sit: say('sit'), wake: say('wake') },
  actions: { wave: { pose: 'wave', ms: 2000, weight: 1, motion: 'bounce', on: ['welcome'], lines: say('wave') } },
});

class Screen implements StageWindow {
  ignoring = true;
  last: ViewFrame[] = [];
  constructor(readonly area: Area) {}
  setIgnoring(ignore: boolean): void {
    this.ignoring = ignore;
  }
  send(frames: ViewFrame[]): void {
    this.last = frames;
  }
}

interface Case {
  name: string;
  settings: Partial<Settings>;
}

const CASES: Case[] = [
  { name: 'a pet that walks along a floor', settings: { roam: 'floor', mode: 'wander', speech: 'off', tricks: false } },
  { name: 'the settings of a new install (the whole screen, automatic, words, tricks), alone', settings: { roam: 'free', mode: 'auto', speech: 'all', tricks: true } },
  { name: 'the settings of a new install, with two friends', settings: { roam: 'free', mode: 'auto', speech: 'all', tricks: true, friends: ['hachiware', 'chiikawa'] } },
  { name: 'a pet that walks along a floor, with a friend, and the experiment of looking for attention on', settings: { roam: 'floor', mode: 'follow', speech: 'reactions', tricks: true, friends: ['chiikawa'], attention: true } },
];

/** what a run did, besides what went wrong: that a run which never put a pet at a window shows nothing is told by these */
interface Outcome {
  problems: string[];
  /** how many times a pet took to the side of a window, and how many times it let go of one */
  attached: number;
  letGo: number;
  /** how many steps a pet stood on a window */
  standing: number;
}

function simulate(seed: number, extra: Partial<Settings>, ms: number): Outcome {
  const problems: string[] = [];
  const outcome: Outcome = { problems, attached: 0, letGo: 0, standing: 0 };
  const attachedBefore = new Map<string, string | null>();
  const rnd = mulberry32(seed * 7919 + 13);
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length) % list.length]!;

  const settings: Settings = { ...DEFAULT_SETTINGS, skin: 'usagi', windows: true, ...extra };
  const screen = new Screen(SCREEN);
  const env = { cursor: { x: 640, y: 300 } as Vec2 };
  const stage = new Stage(
    {
      cursor: () => env.cursor,
      covered: () => false,
      rng: mulberry32(seed),
      // the experiment moves the cursor: it is put where it is asked
      ...(settings.attention ? { setCursor: (p: Vec2) => void (env.cursor = { x: p.x, y: p.y }), cursorBusy: () => false } : {}),
    },
    settings,
  );
  stage.setWindows([screen]);
  for (const id of SKINS) stage.setSkin(skin(id));

  let now = 1000;
  let boxes: WindowBox[] = [];
  let nextId = 1;
  // how long (ms) a pet has been at the side of, or on, a window that the stage no longer knows
  const attachedToGone = new Map<string, number>();
  const standingOnGone = new Map<string, number>();

  const publish = (): void => {
    stage.setPlatforms(platformsFrom(boxes));
    stage.setSides(sidesFrom(boxes));
  };
  const randomBox = (): WindowBox => {
    const w = 200 + Math.floor(rnd() * 600);
    const h = 120 + Math.floor(rnd() * 380);
    return { id: String(1000 + nextId++), x: Math.floor(between(20, SCREEN.width - w - 20)), y: Math.floor(between(20, SCREEN.height - h - 20)), w, h };
  };

  const check = (): void => {
    for (const { id, view: v } of stage.views) {
      const numbers = [v.x, v.y, v.scale, v.hitbox.x, v.hitbox.y, v.hitbox.w, v.hitbox.h];
      if (!numbers.every(Number.isFinite)) problems.push(`seed ${seed}: ${id} has a number that is not one at ${now}: ${JSON.stringify(numbers)}`);
      if (v.y > SCREEN.height + 0.5) problems.push(`seed ${seed}: ${id} is below the floor (${v.y}) at ${now}`);
    }
    const sideOf = (window: string) => stage.sideList.some((s) => windowOf(s.id) === window);
    const topOf = (window: string) => stage.platformList.some((p) => windowOf(p.id) === window);
    for (const { id, at } of stage.attachments) {
      const before = attachedBefore.get(id) ?? null;
      if (at !== null && before === null) outcome.attached++;
      if (at === null && before !== null) outcome.letGo++;
      attachedBefore.set(id, at);
      const gone = at !== null && !sideOf(at);
      const was = attachedToGone.get(id) ?? 0;
      attachedToGone.set(id, gone ? was + 16 : 0);
      if (gone && was + 16 > 800) problems.push(`seed ${seed}: ${id} is still at the side of the window ${at}, which has been gone for ${was + 16} ms, at ${now}`);
    }
    for (const { id, on } of stage.perches) {
      if (on !== null) outcome.standing++;
      const gone = on !== null && !topOf(windowOf(on));
      const was = standingOnGone.get(id) ?? 0;
      standingOnGone.set(id, gone ? was + 16 : 0);
      if (gone && was + 16 > 800) problems.push(`seed ${seed}: ${id} still stands on the window ${on}, which has been gone for ${was + 16} ms, at ${now}`);
    }
  };

  const tick = (): void => {
    now += 16;
    try {
      stage.tick(now);
    } catch (err) {
      problems.push(`seed ${seed}: tick failed at ${now}: ${err instanceof Error ? err.stack : String(err)}`);
    }
    check();
  };
  const run = (span: number): void => {
    for (let t = 0; t < span && problems.length < 5; t += 16) tick();
  };

  const centre = (id: string): Vec2 | null => {
    const v = stage.views.find((x) => x.id === id)?.view;
    return v ? { x: v.hitbox.x + v.hitbox.w / 2, y: v.hitbox.y + v.hitbox.h / 2 } : null;
  };
  /** takes the pet by its body, carries it to (x, y) (its feet), and lets go: slowly, or as a throw */
  const carry = (id: string, x: number, y: number, fling: boolean): void => {
    const v = stage.views.find((q) => q.id === id)?.view;
    const from = centre(id);
    if (!v || !from) return;
    const to = { x: from.x + (x - v.x), y: from.y + (y - v.y) };
    env.cursor = from;
    run(16);
    stage.pointer(screen, { kind: 'down', x: from.x, y: from.y });
    for (let i = 1; i <= 16; i++) {
      env.cursor = { x: from.x + ((to.x - from.x) * i) / 16, y: from.y + ((to.y - from.y) * i) / 16 };
      run(16);
    }
    if (fling) {
      env.cursor = { x: to.x + 60, y: to.y };
      run(16);
      env.cursor = { x: to.x + 220, y: to.y };
      run(16);
    } else {
      run(220);
    }
    stage.pointer(screen, { kind: 'up', x: env.cursor.x, y: env.cursor.y });
  };

  const actions: (() => void)[] = [
    // the windows change: a new one, one gone (minimized, closed), one moved or resized, a different one in front
    () => {
      boxes = [randomBox(), ...boxes].slice(0, 5);
      publish();
    },
    () => {
      if (boxes.length > 0) boxes = boxes.filter((_, i) => i !== Math.floor(rnd() * boxes.length));
      publish();
    },
    () => {
      boxes = boxes.map((b) => (rnd() < 0.5 ? b : { ...b, x: Math.floor(b.x + between(-90, 90)), y: Math.floor(b.y + between(-60, 60)) }));
      publish();
    },
    () => {
      boxes = boxes.map((b) => (rnd() < 0.7 ? b : { ...b, w: Math.max(160, Math.floor(b.w + between(-150, 150))), h: Math.max(60, Math.floor(b.h + between(-120, 120))) }));
      publish();
    },
    () => {
      boxes = [...boxes].sort(() => rnd() - 0.5);
      publish();
    },
    // one flickers away and comes back at once
    () => {
      const before = boxes;
      boxes = boxes.slice(1);
      publish();
      run(between(16, 400));
      boxes = before;
      publish();
    },
    // somebody puts a pet down beside the edge of a window (or throws it, or puts it anywhere)
    () => {
      const b = pick(boxes.length > 0 ? boxes : [randomBox()]);
      const left = rnd() < 0.5;
      carry(pick(stage.views).id, left ? b.x - between(5, 40) : b.x + b.w + between(5, 40), between(b.y, b.y + b.h), rnd() < 0.15);
    },
    () => carry(pick(stage.views).id, between(60, SCREEN.width - 60), between(150, SCREEN.height), rnd() < 0.3),
    // clicks, three clicks, the call, the tricks, a notice
    () => {
      const at = centre(pick(stage.views).id);
      if (!at) return;
      env.cursor = at;
      run(16);
      stage.pointer(screen, { kind: 'down', x: at.x, y: at.y });
      stage.pointer(screen, { kind: 'up', x: at.x, y: at.y });
      if (rnd() < 0.3) {
        for (let i = 0; i < 2; i++) {
          stage.pointer(screen, { kind: 'down', x: at.x, y: at.y });
          stage.pointer(screen, { kind: 'up', x: at.x, y: at.y });
        }
      }
    },
    () => stage.call(),
    () => stage.perform(),
    () => stage.notice(pick(['welcome', 'plug', 'unplug', 'lowBattery'] as const)),
    () => stage.findAll(),
    () => stage.hideAtWall(),
    () => void stage.lookOver(),
    () => void stage.seekAttention(),
    // the mouse is moved about
    () => {
      env.cursor = { x: between(0, SCREEN.width), y: between(0, SCREEN.height) };
    },
    // the pets are put away and brought back
    () => {
      stage.setHidden(true);
      run(between(16, 300));
      stage.setHidden(false);
    },
  ];

  for (let elapsed = 0; elapsed < ms && problems.length < 5; ) {
    pick(actions)();
    const span = between(50, 700);
    run(span);
    elapsed += span;
  }
  return outcome;
}

describe.each(CASES)('fuzz: windows and pets at the stage ($name)', ({ settings }) => {
  it('never throws, never loses a number, and never keeps a pet at a window that is gone', () => {
    const problems: string[] = [];
    let attached = 0;
    let letGo = 0;
    let standing = 0;
    for (let seed = 1; seed <= 14; seed++) {
      const o = simulate(seed, settings, 60_000);
      problems.push(...o.problems);
      attached += o.attached;
      letGo += o.letGo;
      standing += o.standing;
    }
    expect(problems.slice(0, 8)).toEqual([]);
    // the runs did what they are for: pets hid at the sides of windows and let go of them, and stood on windows
    expect(attached, 'times a pet hid at the side of a window').toBeGreaterThan(20);
    expect(letGo, 'times a pet let go of the side of a window').toBeGreaterThan(10);
    expect(standing, 'steps a pet stood on a window').toBeGreaterThan(100);
  }, 120_000);
});
