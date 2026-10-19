import {
  DEFAULT_CONFIG,
  type ActionDef,
  type Actions,
  type ActionTrigger,
  type Line,
  type Lines,
  type Mode,
  type NoticeEvent,
  type Particle,
  type ParticleKind,
  type Peer,
  type PetConfig,
  type PetState,
  type PetView,
  type Platform,
  type Rect,
  type Roam,
  type SayEvent,
  type SpeechLevel,
  type Vec2,
} from './types';
import { planHop } from './perch';
import { Region, type Reach } from './region';
import { Speaker, textWidth } from './speech';
import { clamp, dist, inEllipse, mulberry32 } from './vec';

const MAX_DT = 50;
const DRAG_THRESHOLD = 6;
const SURPRISED_MS = 450;
const HAPPY_MS = 1400;
const LAND_MS = 380;
const CURSOR_ACTIVE_MS = 3500;
const CURSOR_JITTER = 6;
const WAKE_DISTANCE = 60;
const FLEE_RADIUS = 260;
const FLEE_COOLDOWN_MS = 4000;
const FLEE_DISTANCE = 340;
const ATTACH_OFFSET = { dx: 18, dy: 14 };
const CLICK_WINDOW_MS = 1200;
const HOVER_TIMEOUT_MS = 1500;
const RUB_WINDOW_MS = 1200;
const RUB_REVERSALS = 4;
const RUB_MIN_STEP = 4;
const MAX_PARTICLES = 24;
/** a pet called from farther than this (or from another screen) drops in at the cursor instead of running over */
const CALL_FAR = 900;
/** a called pet that has not arrived by now drops in; if it still has not arrived this long after, it stops trying */
const CALL_DROP_MS = 6000;
const CALL_GIVE_UP_MS = 6000;
/** how likely the pet is to do one of its actions each time it decides what to do next, and in previews and tests */
const ACTION_CHANCE = 0.12;
const ACTION_CHATTY_CHANCE = 0.5;
/** with friends about: how often a new place to walk to is a friend, and how far from it the pet stops */
const VISIT_CHANCE = 0.45;
const VISIT_GAP = 100;
/** a pet counts as standing on a window until its feet are this far past the end of it */
const PERCH_SLACK = 6;
/** a pet that lands, or walks about, on a window keeps this far from the ends of it */
const PERCH_MARGIN = 14;
/** hopping up onto a window: how far above the feet its top may be, how far to the side the nearest place on it may be, and how high above the top the feet rise */
const HOP_RISE = 230;
const HOP_REACH = 320;
const HOP_CLEARANCE = 46;
/** each time a pet on the floor (or on a window) decides what to do next: how likely it hops up onto a window in reach */
const HOP_CHANCE = 0.3;
/** a pet on a window: how likely its next walk stays on the window */
const STAY_CHANCE = 0.8;
/** a pet that may roam the whole screen: how likely a new place to go to is the top of a window (when there is one) */
const WINDOW_VISIT_CHANCE = 0.35;
/** how fast a pet follows the window it stands on when that moves (time constant, ms) */
const CARRY_MS = 90;

export interface PetOptions {
  /** one screen from the origin; its bottom edge is the floor */
  world: { width: number; height: number };
  /** several screens (their work areas, in one coordinate space); the first is where the pet starts. Replaces `world`. */
  region?: Rect[];
  /** where the feet start, along the bottom of the first screen (the middle by default) */
  x?: number;
  config?: Partial<PetConfig>;
  mode?: Mode;
  rng?: () => number;
  /** previews and tests: speak in every situation and much more often */
  chatty?: boolean;
}

type Holder = 'user' | 'cursor';

export class Pet {
  mode: Mode;
  /** Mutated in place on every update; read it, do not keep it. */
  readonly view: PetView;

  private cfg: PetConfig;
  private region: Region;
  private rng: () => number;
  private speaker: Speaker;
  /** ms until the pet talks to itself; ms until it greets; which screen the feet are on (-2: not known yet) */
  private murmurIn = 0;
  private greetIn: number | null = null;
  private screen = -2;

  private time = 0;
  private state: PetState = 'idle';
  private stateMs = 0;
  /** feet position */
  private pos: Vec2;
  private vel: Vec2 = { x: 0, y: 0 };
  private facing: 1 | -1 = 1;
  private target: Vec2 | null = null;
  private decideIn = 1200;
  private gait = 0;
  private swing = 0;
  private swingVel = 0;
  private prevX: number;
  private bounces = 0;
  private fleeDir: Vec2 | null = null;
  private lastFleeAt = -Infinity;
  private holder: Holder | null = null;
  /** called by the user and on the way to the cursor; how long that has taken, and whether it has dropped in already */
  private summoned = false;
  private summonMs = 0;
  private summonDropped = false;
  /** what the skin has the pet do now and then; which one it is doing, and which it did last */
  private actions: Actions = {};
  private act: { name: string; def: ActionDef } | null = null;
  private lastAct: string | null = null;
  /** may it start an action of its own accord (asked for, or for a situation, it always does) */
  private tricks = true;
  /** the other pets on the same screens */
  private peers: readonly Peer[] = [];
  /** the tops of the windows that can be stood on */
  private platforms: readonly Platform[] = [];
  /** the window the feet are on (null: the floor of the screens, or the air) */
  private perch: string | null = null;
  /** how much of the last move of that window the pet has still to follow */
  private carry: Vec2 = { x: 0, y: 0 };
  /** the window a hop is aimed at, while the pet is in the air for it */
  private hop: string | null = null;

  private cursor: Vec2 | null = null;
  private prevCursor: Vec2 | null = null;
  private lastActiveCursor: Vec2 | null = null;
  private cursorVel: Vec2 = { x: 0, y: 0 };
  private cursorSpeed = 0;
  private cursorIdleMs = 0;
  private sleepCursor: Vec2 | null = null;
  private interactionIdleMs = 0;

  private interactive = true;
  private press: Vec2 | null = null;
  private dragging = false;
  private grab: Vec2 = { x: 0, y: 0 };
  private samples: { p: Vec2; t: number }[] = [];
  private hover = false;
  private hoverAt = -Infinity;
  private clicks: number[] = [];
  private rub = { dir: 0, lastX: 0, reversals: 0, since: -Infinity, lastMove: -Infinity };
  private heartIn = 0;
  private zIn = 0;
  private particles: Particle[] = [];

  constructor(opts: PetOptions) {
    const base = DEFAULT_CONFIG;
    this.cfg = {
      ...base,
      ...opts.config,
      sprite: { ...base.sprite, ...opts.config?.sprite },
      hitbox: { ...base.hitbox, ...opts.config?.hitbox },
    };
    this.region = new Region(opts.region ?? [{ x: 0, y: 0, w: opts.world.width, h: opts.world.height }]);
    this.mode = opts.mode ?? 'auto';
    this.rng = opts.rng ?? mulberry32(Date.now());
    this.speaker = new Speaker(() => this.rng());
    this.speaker.chatty = !!opts.chatty;
    const home = this.region.rects[0]!;
    this.pos = { x: opts.x ?? home.x + home.w / 2, y: home.y + home.h };
    this.prevX = this.pos.x;
    this.view = {
      x: 0, y: 0, facing: 1, state: 'idle', t: 0, sx: 1, sy: 1, rot: 0, lift: 0, pivot: 'feet',
      scale: this.cfg.scale, particles: this.particles, hitbox: { x: 0, y: 0, w: 0, h: 0 },
      interactive: true, animating: false, action: null,
    };
    if (this.mode === 'attach') this.startHold();
    this.syncView();
  }

  // --- configuration -------------------------------------------------------

  setWorld(width: number, height: number): void {
    this.setRegion([{ x: 0, y: 0, w: width, h: height }]);
  }

  /** Replaces the screens the pet lives on (a monitor came or went, or the work area changed). */
  setRegion(rects: Rect[]): void {
    this.region = new Region(rects);
    this.pos = this.clampFeet(this.pos);
    if (this.target) this.target = this.clampFeet(this.target);
    // the screens are numbered anew: not a trip from one to another
    this.screen = -2;
  }

  /**
   * `scale` is how big the pet is drawn. The words above it use `textScale` (default: the same), so that friends drawn at
   * different scales to look equally big still speak in letters of the same size.
   */
  setScale(scale: number, textScale: number = scale): void {
    this.cfg.scale = scale;
    this.cfg.textScale = textScale;
    this.pos = this.clampFeet(this.pos);
  }

  setRoam(roam: Roam): void {
    this.cfg.roam = roam;
  }

  /**
   * The windows the pet may stand on, as they are now (their uncovered top edges). A pet on one goes along when the
   * window moves, and when the window goes away a pet that walks along a floor falls (one that roams the whole
   * screen stays where it is, in the air, as it always may).
   */
  setPlatforms(list: readonly Platform[]): void {
    const before = this.perch === null ? undefined : this.platforms.find((p) => p.id === this.perch);
    this.platforms = list;
    if (this.perch === null) return;
    const now = list.find((p) => p.id === this.perch);
    if (!before || !now) {
      // the window is gone: the next step finds nothing under the feet
      this.carry = { x: 0, y: 0 };
      return;
    }
    this.carry.x += now.ax - before.ax;
    this.carry.y += now.y - before.y;
  }

  /** Is the pet standing on a window? (For tests and diagnostics: the window's id.) */
  get perched(): string | null {
    return this.standingOn()?.id ?? null;
  }

  /** Called when a skin changes the sprite box. */
  setSprite(sprite: PetConfig['sprite'], hitbox: Rect): void {
    this.cfg.sprite = { ...sprite };
    this.cfg.hitbox = { ...hitbox };
    this.pos = this.clampFeet(this.pos);
  }

  /** false makes the pet click-through (it still moves and animates). */
  setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) this.cancelPointer();
  }

  /** What the pet says, by situation (the skin's lines). A skin that speaks greets when it takes over. */
  setLines(lines: Lines | null): void {
    this.speaker.setLines(lines);
    if (this.speaker.any) {
      this.greetIn = 900;
      this.murmurIn = this.nextMurmur();
    }
  }

  setSpeech(level: SpeechLevel): void {
    this.speaker.setLevel(level);
  }

  /** What the skin has the pet do now and then (its pictures live in the skin; the engine only times it). */
  setActions(actions: Actions | null): void {
    this.actions = actions ?? {};
    // the skin changed under an action that is no longer there
    if (this.state === 'act' && !(this.act && this.actions[this.act.name])) this.settle();
  }

  get hasActions(): boolean {
    return Object.keys(this.actions).length > 0;
  }

  /** Whether the pet does its actions now and then on its own. */
  setTricks(on: boolean): void {
    this.tricks = on;
  }

  /**
   * Does one of the actions now, as if it had felt like it: `name`, or any one. False when there is none to do,
   * or the pet is in someone's hand or in the air.
   */
  perform(name?: string): boolean {
    if (this.holder || this.state === 'held' || this.state === 'fall' || this.state === 'land') return false;
    const pick = name ? (this.actions[name] ? ([name, this.actions[name]!] as const) : null) : this.pickAction(null);
    if (!pick) return false;
    this.summoned = false;
    if (this.state === 'sleep') this.rouse();
    this.startAction(pick[0], pick[1], false);
    return true;
  }

  /** Says something for a situation, if the skin has words for it and it is not too soon. `partner`: the friend it is for. */
  say(event: SayEvent, partner?: string): void {
    const holding = this.particles.some((p) => p.kind === 'text' && p.style === 'hold' && p.age < p.life - 400);
    const line = this.speaker.pick(event, this.time, holding, partner);
    if (line) this.spawnText(line);
  }

  /** The other pets that live on the same screens (their feet and what they are doing), kept up to date by whoever runs them. */
  setPeers(peers: readonly Peer[]): void {
    this.peers = peers;
  }

  /** Is the pet free to stop and greet a friend: on its feet and not busy with anything? */
  get meetable(): boolean {
    return (this.state === 'idle' || this.state === 'walk' || this.state === 'sit') && !this.summoned && !this.hover && this.press === null;
  }

  /**
   * Meets a friend at `at`: stops and turns to face it, and then greets it (`greet`), answers its greeting
   * (`reply`), or only listens (`listen`, for the one that is greeted and has not answered yet).
   */
  meet(partner: string, at: Vec2, role: 'greet' | 'reply' | 'listen'): void {
    this.target = null;
    if (this.state === 'walk' || this.state === 'run') this.enter('idle');
    this.facing = at.x >= this.pos.x ? 1 : -1;
    // stays a while with its friend before going on
    this.decideIn = Math.max(this.decideIn, 2500);
    if (role === 'greet') this.say('meet', partner);
    else if (role === 'reply') this.say('reply', partner);
  }

  /**
   * The user calls the pet. It wakes up and runs to the cursor, or drops in from above when that is far away or on
   * another screen, and answers when it gets there. A pet that hangs off the cursor just answers.
   */
  call(): void {
    // someone is dragging it right now; the cursor is busy
    if (this.holder === 'user') return;
    const c = this.cursor;
    if (this.holder === 'cursor' || !c) {
      this.say('call');
      return;
    }
    this.summoned = true;
    this.summonMs = 0;
    this.summonDropped = false;
    this.target = null;
    this.fleeDir = null;
    this.interactionIdleMs = 0;
    if (this.state === 'sleep') this.rouse();
    if (dist(this.pos, c) > this.k(CALL_FAR) || this.region.indexAt(this.pos) !== this.region.indexAt(c)) this.dropIn(c);
  }

  /** Something happened on the computer: the pet perks up (or is startled) and says so. */
  notice(event: NoticeEvent): void {
    // in someone's hand or in the air it can only say it
    if (this.state !== 'held' && this.state !== 'fall' && this.state !== 'land') {
      if (this.state === 'sleep') this.rouse();
      const act = this.pickAction(event);
      if (act) this.startAction(act[0], act[1], true);
      else this.react(event === 'welcome' || event === 'plug' ? 'happy' : 'surprised');
    }
    this.say(event);
  }

  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    const wasAttached = this.mode === 'attach';
    this.mode = mode;
    this.target = null;
    this.cancelPointer();
    if (mode === 'attach') this.startHold();
    else if (wasAttached) {
      this.holder = null;
      this.startFall(this.vel.x, this.vel.y);
    }
  }

  // --- input ---------------------------------------------------------------

  /** Global cursor position in overlay coordinates. */
  setCursor(p: Vec2): void {
    this.cursor = { x: p.x, y: p.y };
  }

  isOver(p: Vec2): boolean {
    return inEllipse(p, this.hitbox());
  }

  /** A button went down on the pet and has not come up yet (it may or may not have become a drag). */
  get pressed(): boolean {
    return this.press !== null;
  }

  pointerMove(p: Vec2): void {
    if (!this.canInteract()) return;
    if (this.press) {
      if (!this.dragging && dist(p, this.press) > DRAG_THRESHOLD) this.startDrag(this.press);
      if (this.dragging) this.dragTo(p);
      return;
    }
    const over = this.isOver(p);
    if (over && !this.hover) this.onHoverEnter(p);
    this.hover = over;
    if (over) {
      this.hoverAt = this.time;
      this.detectRub(p);
    }
  }

  pointerDown(p: Vec2): void {
    if (!this.canInteract() || !this.isOver(p)) return;
    this.press = { x: p.x, y: p.y };
    this.interactionIdleMs = 0;
  }

  pointerUp(p: Vec2): void {
    if (!this.press) return;
    const wasDrag = this.dragging;
    this.press = null;
    if (wasDrag) this.endDrag(p);
    else this.onClick();
  }

  pointerLeave(): void {
    this.hover = false;
  }

  // --- simulation ----------------------------------------------------------

  update(dtMs: number): void {
    const dt = clamp(dtMs, 0, MAX_DT);
    if (dt > 0) {
      this.time += dt;
      this.stateMs += dt;
      this.interactionIdleMs += dt;
      this.trackCursor(dt);
      this.stepParticles(dt);
      this.followPerch(dt);
      switch (this.state) {
        case 'held':
          this.stepHeld(dt);
          break;
        case 'fall':
          this.stepFall(dt);
          break;
        case 'land':
          if (this.stateMs >= LAND_MS) this.settle();
          break;
        case 'surprised':
          this.stepSurprised();
          break;
        case 'happy':
          this.stepHappy(dt);
          break;
        default:
          this.stepBehavior(dt);
      }
      if (this.state !== 'fall') this.pos = this.settleFeet(this.pos);
      this.stepSpeech(dt);
    }
    this.syncView();
  }

  hitbox(): Rect {
    const { sprite, hitbox } = this.cfg;
    const w = sprite.w * this.cfg.scale;
    const h = sprite.h * this.cfg.scale;
    const left = this.pos.x - sprite.anchorX * w;
    const top = this.pos.y - sprite.anchorY * h;
    return { x: left + hitbox.x * w, y: top + hitbox.y * h, w: hitbox.w * w, h: hitbox.h * h };
  }

  // --- behaviour -----------------------------------------------------------

  private effective(): Exclude<Mode, 'auto'> {
    if (this.mode !== 'auto') return this.mode;
    return this.cursor && this.cursorIdleMs < CURSOR_ACTIVE_MS ? 'follow' : 'wander';
  }

  private stepBehavior(dt: number): void {
    const perched = this.perch !== null;
    const on = this.standingOn();
    if (this.cfg.roam === 'floor' && this.pos.y < this.region.floor(this.pos, this.reach()) - 1 && !on) {
      // stepping off a window carries the walk on a little; anything else just drops
      this.startFall(perched && (this.state === 'walk' || this.state === 'run') ? this.vel.x * 0.5 : 0, 0);
      return;
    }
    // a window that was stood on is gone (or the pet has left it); a pet that roams the whole screen takes to a window it is at the top of
    if (perched && !on) this.leavePerch();
    else if (!perched && this.cfg.roam === 'free') this.adoptPerch();
    // an action that something else started (a situation, say) is finished before the pet goes on to the cursor
    if (this.summoned && this.state !== 'act') {
      this.stepSummon(dt);
      return;
    }
    if (this.state === 'sleep') {
      if (!this.shouldWake()) {
        this.zIn -= dt;
        if (this.zIn <= 0) {
          this.spawn('z');
          this.zIn = 1500;
        }
        return;
      }
      this.wake();
    }
    if (this.maybeSleep()) return;
    const eff = this.effective();
    if (eff === 'wander') this.maybeFlee();
    if (this.state === 'surprised') return;
    if (this.state === 'act') {
      this.stepAct(eff);
      return;
    }
    if (eff === 'follow') this.stepFollow(dt);
    else this.stepWander(dt);
  }

  /** Busy with an action: it goes on until it is over, unless the mouse calls the pet away. */
  private stepAct(eff: Exclude<Mode, 'auto'>): void {
    const c = this.cursor;
    const called = eff === 'follow' && c !== null && dist(this.center(), c) > this.k(this.cfg.followStart);
    if (called || !this.act || this.stateMs >= this.act.def.ms) this.settle();
  }

  /** A chance, when the pet has just decided what to do next, that it does one of its actions. */
  private maybeAct(): boolean {
    if (!this.tricks || !this.hasActions || (this.state !== 'idle' && this.state !== 'sit')) return false;
    if (this.rng() >= (this.speaker.chatty ? ACTION_CHATTY_CHANCE : ACTION_CHANCE)) return false;
    const pick = this.pickAction(null);
    if (!pick) return false;
    this.startAction(pick[0], pick[1], false);
    return true;
  }

  /** One of the actions, by weight and never the one just done (unless it is the only one): all of them, or those made for `trigger`. */
  private pickAction(trigger: ActionTrigger | null): readonly [string, ActionDef] | null {
    let pool = Object.entries(this.actions).filter(([, def]) => trigger === null || def.on.includes(trigger));
    if (pool.length > 1) pool = pool.filter(([name]) => name !== this.lastAct);
    if (pool.length === 0) return null;
    let at = this.rng() * pool.reduce((sum, [, def]) => sum + def.weight, 0);
    for (const entry of pool) {
      at -= entry[1].weight;
      if (at <= 0) return entry;
    }
    return pool[pool.length - 1]!;
  }

  /** `quiet`: something else is said for it (the situation that set it off), so the action says nothing of its own. */
  private startAction(name: string, def: ActionDef, quiet: boolean): void {
    this.act = { name, def };
    this.lastAct = name;
    this.target = null;
    this.fleeDir = null;
    this.vel = { x: 0, y: 0 };
    this.interactionIdleMs = 0;
    this.enter('act', true);
    if (quiet) return;
    const line = this.speaker.pickFrom(`action:${name}`, def.lines, this.time);
    if (line) this.spawnText(line);
  }

  /** On the way to a user who called: runs to the cursor, and answers when it is beside it. */
  private stepSummon(dt: number): void {
    const c = this.cursor;
    if (!c) {
      this.summoned = false;
      return;
    }
    this.summonMs += dt;
    const floor = this.cfg.roam === 'floor';
    const d = floor ? Math.abs(c.x - this.center().x) : dist(this.center(), c);
    const stop = this.k(this.cfg.followStop);
    const late = this.summonMs > (this.summonDropped ? CALL_GIVE_UP_MS : CALL_DROP_MS);
    if (late && !this.summonDropped) {
      this.dropIn(c);
      return;
    }
    if (d <= stop + 2 || late) {
      this.summoned = false;
      this.target = null;
      this.facing = c.x >= this.pos.x ? 1 : -1;
      const act = this.pickAction('call');
      if (act) this.startAction(act[0], act[1], true);
      else this.react('happy');
      this.say('call');
      return;
    }
    this.enter('run');
    this.moveToward(this.goalBeside(c, d, stop), this.k(this.cfg.runSpeed), dt);
  }

  /** Falls in from the top of the screen at the cursor, wherever the pet was. */
  private dropIn(c: Vec2): void {
    const at = this.clampFeet(c);
    this.pos = { x: at.x, y: this.region.ceiling(at, this.reach()) };
    this.summonDropped = true;
    this.summonMs = 0;
    this.startFall(0, 0);
  }

  /** Where the feet go to stand `stop` away from the cursor, on the side the pet is on. */
  private goalBeside(c: Vec2, d: number, stop: number): Vec2 {
    const floor = this.cfg.roam === 'floor';
    const center = this.center();
    const ux = floor ? Math.sign(center.x - c.x) || 1 : (center.x - c.x) / d;
    const uy = floor ? 0 : (center.y - c.y) / d;
    return this.clampFeet({
      x: c.x + ux * stop,
      y: floor ? this.pos.y : c.y + uy * stop + (this.pos.y - center.y),
    });
  }

  private stepWander(dt: number): void {
    const moving = this.state === 'walk' || this.state === 'run';
    if (moving && !this.target) this.enter('idle');
    if (moving && this.target) {
      if (this.moveToward(this.target, this.state === 'run' ? this.k(this.cfg.runSpeed) : this.k(this.cfg.walkSpeed), dt)) {
        this.target = null;
        this.enter('idle');
        this.decideIn = 900 + this.rng() * 2400;
      }
      return;
    }
    if (this.isHovered()) {
      this.decideIn = Math.max(this.decideIn, 600);
      return;
    }
    this.decideIn -= dt;
    if (this.decideIn > 0) return;
    if (this.maybeAct()) return;
    if (this.maybeHop()) return;
    const r = this.rng();
    if (r < 0.55) {
      this.target = this.pickTarget();
      this.enter('walk');
    } else if (r < 0.8) {
      this.enter('sit');
      this.decideIn = 2500 + this.rng() * 3500;
    } else {
      this.facing = this.facing === 1 ? -1 : 1;
      this.enter('idle');
      this.decideIn = 1200 + this.rng() * 1800;
    }
  }

  private stepFollow(dt: number): void {
    const c = this.cursor;
    if (!c) {
      this.stepWander(dt);
      return;
    }
    const floor = this.cfg.roam === 'floor';
    const center = this.center();
    const d = floor ? Math.abs(c.x - center.x) : dist(center, c);
    const moving = this.state === 'walk' || this.state === 'run';
    const start = this.k(this.cfg.followStart);
    const stop = this.k(this.cfg.followStop);
    if (d > start || (moving && d > stop + 2)) {
      const goal = this.goalBeside(c, d, stop);
      this.target = null;
      if (!moving) this.say('follow');
      this.enter(d > start * 2.2 ? 'run' : 'walk');
      this.moveToward(goal, this.state === 'run' ? this.k(this.cfg.runSpeed) : this.k(this.cfg.walkSpeed), dt);
      return;
    }
    if (moving) {
      this.enter('idle');
      this.decideIn = 1000;
    }
    if (Math.abs(c.x - this.pos.x) > 12) this.facing = c.x >= this.pos.x ? 1 : -1;
    if (this.state === 'idle' && this.cursorIdleMs > 3000) this.enter('sit');
    else if (this.state === 'sit' && this.cursorIdleMs < 400) this.enter('idle');
    else if (this.state === 'sit') this.keepCompany(dt);
  }

  /** Sitting beside a mouse that does not move (the user is busy): now and then a trick, for company. */
  private keepCompany(dt: number): void {
    if (!this.tricks || !this.hasActions) return;
    this.decideIn -= dt;
    if (this.decideIn > 0) return;
    this.decideIn = 5000 + this.rng() * 5000;
    this.maybeAct();
  }

  private stepHeld(dt: number): void {
    const s = dt / 1000;
    if (this.holder === 'cursor') this.stepAttach(s);
    const vx = (this.pos.x - this.prevX) / s;
    this.prevX = this.pos.x;
    const goal = clamp(vx * 0.0014, -0.6, 0.6);
    this.swingVel += (-120 * (this.swing - goal) - 9 * this.swingVel) * s;
    this.swing += this.swingVel * s;
  }

  /** Hangs the sprite just below-right of the cursor tip on a spring. */
  private stepAttach(s: number): void {
    const c = this.cursor;
    if (!c) return;
    const { sprite, scale } = this.cfg;
    const goal = this.clampFeet({
      x: c.x + ATTACH_OFFSET.dx * scale,
      y: c.y + ATTACH_OFFSET.dy * scale + sprite.anchorY * sprite.h * scale,
    });
    const k = 220;
    const damp = 2 * Math.sqrt(k) * 0.65;
    this.vel.x += (k * (goal.x - this.pos.x) - damp * this.vel.x) * s;
    this.vel.y += (k * (goal.y - this.pos.y) - damp * this.vel.y) * s;
    this.pos.x += this.vel.x * s;
    this.pos.y += this.vel.y * s;
    if (Math.abs(this.vel.x) > 40) this.facing = this.vel.x > 0 ? 1 : -1;
  }

  private stepFall(dt: number): void {
    const s = dt / 1000;
    const reach = this.reach();
    this.vel.y += this.k(this.cfg.gravity) * s;
    // a hop keeps its sideways speed all the way
    if (this.hop === null) this.vel.x *= Math.max(0, 1 - 1.5 * s);
    // sideways: an edge of the screens with no other screen behind it is a wall
    const nx = this.pos.x + this.vel.x * s;
    const stop = this.region.reachX(this.pos, nx, reach);
    if (stop !== nx) {
      this.vel.x = (nx < stop ? 1 : -1) * Math.abs(this.vel.x) * 0.4;
    }
    this.pos.x = stop;
    // up and down: the ceiling, and the floor of the screen(s) the body is over
    const floorY = this.region.floor(this.pos, reach);
    const ceilY = this.region.ceiling(this.pos, reach);
    const fromY = this.pos.y;
    this.pos.y += this.vel.y * s;
    if (this.pos.y < ceilY) {
      this.pos.y = ceilY;
      this.vel.y = Math.abs(this.vel.y) * 0.3;
    }
    const on = this.landingOn(fromY, floorY);
    if (on) {
      this.pos.y = on.y;
      this.perch = on.id;
      this.carry = { x: 0, y: 0 };
      this.touchDown();
    } else if (this.pos.y >= floorY) {
      this.pos.y = floorY;
      if (this.vel.y > this.k(700) && this.bounces < 1) {
        this.vel.y = -this.vel.y * 0.3;
        this.vel.x *= 0.7;
        this.bounces++;
      } else {
        this.touchDown();
      }
    }
  }

  /** The feet are on something: the pet comes to rest (and says so if it came a long way, unless it jumped there on purpose). */
  private touchDown(): void {
    const airtime = this.stateMs;
    const hopped = this.hop !== null;
    this.hop = null;
    this.vel = { x: 0, y: 0 };
    this.enter('land');
    if (airtime > 450 && !hopped) this.say('land');
  }

  /** The window the feet come down on in this step (they were at height `fromY` and are at `this.pos` now), if there is one. */
  private landingOn(fromY: number, floorY: number): Platform | null {
    const reach = this.reach();
    let best: Platform | null = null;
    for (const p of this.platforms) {
      // above the floor, and the feet went from above its top edge to below it
      if (p.y >= floorY - 1 || fromY > p.y + 0.5 || this.pos.y < p.y) continue;
      if (this.pos.x < p.x0 + PERCH_MARGIN || this.pos.x > p.x1 - PERCH_MARGIN) continue;
      if (best && p.y >= best.y) continue;
      if (!this.region.fits({ x: this.pos.x, y: p.y }, reach)) continue;
      best = p;
    }
    return best;
  }

  private stepSurprised(): void {
    if (this.stateMs < SURPRISED_MS) return;
    const dir = this.fleeDir;
    this.fleeDir = null;
    if (dir) {
      const far = this.k(FLEE_DISTANCE);
      const free = this.cfg.roam === 'free';
      this.target = this.clampFeet({ x: this.pos.x + dir.x * far, y: free ? this.pos.y + dir.y * far : this.pos.y });
      this.enter('run');
    } else {
      this.enter('idle');
      this.decideIn = 600;
    }
  }

  private stepHappy(dt: number): void {
    const rubbing = this.isRubbing();
    this.heartIn -= dt;
    if ((rubbing || this.stateMs < 800) && this.heartIn <= 0) {
      this.spawn('heart');
      this.heartIn = 220;
    }
    if (!rubbing && this.stateMs >= HAPPY_MS) this.settle();
  }

  // --- helpers: behaviour --------------------------------------------------

  private settle(): void {
    this.enter('idle');
    this.decideIn = 800;
  }

  private maybeSleep(): boolean {
    if (this.state !== 'idle' && this.state !== 'sit') return false;
    if (this.cursorIdleMs < this.cfg.sleepAfterMs || this.interactionIdleMs < this.cfg.sleepAfterMs) return false;
    this.target = null;
    this.sleepCursor = this.cursor ? { ...this.cursor } : null;
    this.zIn = 600;
    this.enter('sleep');
    return true;
  }

  private shouldWake(): boolean {
    if (!this.cursor) return false;
    if (!this.sleepCursor) {
      // the first cursor report seen while asleep is a reference point, not movement
      this.sleepCursor = { x: this.cursor.x, y: this.cursor.y };
      return false;
    }
    return dist(this.cursor, this.sleepCursor) > WAKE_DISTANCE;
  }

  private wake(): void {
    this.rouse();
    this.say('wake');
  }

  /** Gets up from sleep without a word. */
  private rouse(): void {
    this.sleepCursor = null;
    this.interactionIdleMs = 0;
    this.settle();
  }

  /** Startles when the cursor races toward the pet. Only used while wandering. */
  private maybeFlee(): void {
    if (!this.cursor || this.cursorSpeed < this.cfg.fleeSpeed) return;
    if (this.time - this.lastFleeAt < FLEE_COOLDOWN_MS) return;
    if (this.state === 'sleep') return;
    const c = this.center();
    const ax = c.x - this.cursor.x;
    const ay = c.y - this.cursor.y;
    const d = Math.hypot(ax, ay);
    if (d < 1 || d > this.k(FLEE_RADIUS)) return;
    if (this.cursorVel.x * ax + this.cursorVel.y * ay <= 0) return;
    this.lastFleeAt = this.time;
    this.target = null;
    this.fleeDir = { x: ax / d, y: ay / d };
    this.enter('surprised', true);
    this.say('flee');
  }

  private pickTarget(): Vec2 {
    const free = this.cfg.roam === 'free';
    const reach = this.reach();
    // on a window, mostly walk along it (the other walks go off its edge)
    const on = this.standingOn();
    if (on && this.rng() < STAY_CHANCE) {
      const span = this.span(on);
      if (span) return { x: span.lo + this.rng() * (span.hi - span.lo), y: this.pos.y };
    }
    // a pet that may go anywhere now and then goes and stands on the top of a window (no random numbers are used when there is none)
    if (free && this.platforms.length > 0) {
      const spans = this.platforms.filter((p) => p.id !== on?.id).flatMap((p) => {
        const span = this.span(p);
        return span ? [{ p, span }] : [];
      });
      if (spans.length > 0 && this.rng() < WINDOW_VISIT_CHANCE) {
        const { p, span } = spans[Math.floor(this.rng() * spans.length) % spans.length]!;
        return { x: span.lo + this.rng() * (span.hi - span.lo), y: p.y };
      }
    }
    // with friends about, often go and stand beside one (no random numbers are used when there is none)
    if (this.peers.length > 0 && this.rng() < VISIT_CHANCE) {
      const peer = this.peers[Math.floor(this.rng() * this.peers.length) % this.peers.length]!;
      const side = peer.x >= this.pos.x ? -1 : 1;
      return this.clampFeet({ x: peer.x + side * this.k(VISIT_GAP), y: free ? peer.y : this.pos.y });
    }
    let t: Vec2 = this.pos;
    for (let i = 0; i < 4 && dist(t, this.pos) < this.k(80); i++) t = this.region.pick(this.rng, reach, free);
    return t;
  }

  private moveToward(t: Vec2, speed: number, dt: number): boolean {
    // on the floor the pet only walks along it; where the floor steps up or down between screens, the screens decide
    const floor = this.cfg.roam === 'floor';
    const dx = t.x - this.pos.x;
    const dy = floor ? 0 : t.y - this.pos.y;
    const d = Math.hypot(dx, dy);
    const step = (speed * dt) / 1000;
    if (Math.abs(dx) > 1.5) this.facing = dx > 0 ? 1 : -1;
    this.gait += ((this.state === 'run' ? 3.4 : 2.0) * dt) / 1000;
    if (d <= step) {
      this.pos = { x: t.x, y: floor ? this.pos.y : t.y };
      this.vel = { x: 0, y: 0 };
      return true;
    }
    this.vel = { x: (dx / d) * speed, y: (dy / d) * speed };
    this.pos.x += (dx / d) * step;
    this.pos.y += (dy / d) * step;
    return false;
  }

  private startFall(vx: number, vy: number, hop: string | null = null): void {
    this.vel = { x: vx, y: vy };
    this.bounces = 0;
    this.target = null;
    this.holder = null;
    this.hop = hop;
    this.perch = null;
    this.carry = { x: 0, y: 0 };
    this.enter('fall', true);
  }

  // --- helpers: windows ----------------------------------------------------

  private leavePerch(): void {
    this.perch = null;
    this.hop = null;
    this.carry = { x: 0, y: 0 };
  }

  /** The window the feet are on right now; null on the floor, in the air, or when the window went away or moved off. */
  private standingOn(): Platform | null {
    if (this.perch === null) return null;
    const p = this.platforms.find((q) => q.id === this.perch);
    if (!p) return null;
    // where the feet will be once the window has been followed all the way
    const x = this.pos.x + this.carry.x;
    const y = this.pos.y + this.carry.y;
    if (Math.abs(y - p.y) > 2 || x < p.x0 - PERCH_SLACK || x > p.x1 + PERCH_SLACK) return null;
    return p;
  }

  /** The stretch of a window where the body fits on the screens, a margin in from its ends; null when that is too short for the pet. */
  private span(p: Platform): { lo: number; hi: number } | null {
    const reach = this.reach();
    const lo0 = p.x0 + PERCH_MARGIN;
    const hi0 = p.x1 - PERCH_MARGIN;
    if (hi0 - lo0 < this.k(24)) return null;
    const mid = { x: (lo0 + hi0) / 2, y: p.y };
    if (!this.region.fits(mid, reach)) return null;
    const lo = this.region.reachX(mid, lo0, reach);
    const hi = this.region.reachX(mid, hi0, reach);
    return hi - lo >= this.k(24) ? { lo, hi } : null;
  }

  /** A pet that roams the whole screen and has come to the top of a window is standing on it from now on (it goes along when the window moves). */
  private adoptPerch(): void {
    for (const p of this.platforms) {
      if (Math.abs(this.pos.y - p.y) <= 1.5 && this.pos.x >= p.x0 && this.pos.x <= p.x1) {
        this.perch = p.id;
        this.carry = { x: 0, y: 0 };
        return;
      }
    }
  }

  /** Goes along with the window under the feet when that has moved (smoothly, since the list of windows comes in steps). */
  private followPerch(dt: number): void {
    const c = this.carry;
    if (c.x === 0 && c.y === 0) return;
    const f = 1 - Math.exp(-dt / CARRY_MS);
    const dx = Math.abs(c.x) < 0.05 ? c.x : c.x * f;
    const dy = Math.abs(c.y) < 0.05 ? c.y : c.y * f;
    this.pos.x += dx;
    this.pos.y += dy;
    c.x -= dx;
    c.y -= dy;
  }

  /** With a window a little above within reach, now and then jumps up onto it (no random numbers are used when there is none). */
  private maybeHop(): boolean {
    if (this.cfg.roam !== 'floor' || this.platforms.length === 0) return false;
    const options: { p: Platform; x: number }[] = [];
    for (const p of this.platforms) {
      if (p.id === this.perch) continue;
      const rise = this.pos.y - p.y;
      if (rise < this.k(30) || rise > this.k(HOP_RISE)) continue;
      const span = this.span(p);
      if (!span) continue;
      const x = clamp(this.pos.x, span.lo, span.hi);
      if (Math.abs(x - this.pos.x) > this.k(HOP_REACH)) continue;
      options.push({ p, x });
    }
    if (options.length === 0 || this.rng() >= HOP_CHANCE) return false;
    const { p, x } = options[Math.floor(this.rng() * options.length) % options.length]!;
    const plan = planHop(this.pos, { x, y: p.y }, this.k(this.cfg.gravity), this.k(HOP_CLEARANCE));
    if (Math.abs(x - this.pos.x) > 2) this.facing = x > this.pos.x ? 1 : -1;
    this.startFall(plan.vx, plan.vy, p.id);
    return true;
  }

  private startHold(): void {
    this.holder = 'cursor';
    this.summoned = false;
    this.dragging = false;
    this.press = null;
    this.swing = 0;
    this.swingVel = 0;
    this.prevX = this.pos.x;
    this.vel = { x: 0, y: 0 };
    this.enter('held', true);
    if (this.mode === 'attach') this.say('attach');
  }

  private react(s: 'surprised' | 'happy'): void {
    this.target = null;
    this.fleeDir = null;
    this.sleepCursor = null;
    this.interactionIdleMs = 0;
    if (s === 'happy') this.heartIn = 0;
    this.enter(s, true);
  }

  private enter(s: PetState, force = false): void {
    if (this.state !== s || force) {
      const before = this.state;
      this.state = s;
      this.stateMs = 0;
      if (s === 'held') this.leavePerch();
      if (before !== s && (s === 'sit' || s === 'sleep')) this.say(s);
      // every walk or run starts at the beginning of its step, so a skin's own walk cycle (which also starts
      // at the beginning of the state) stays in step with the hop
      if (s === 'walk' || s === 'run') this.gait = 0;
    }
  }

  // --- helpers: pointer ----------------------------------------------------

  private canInteract(): boolean {
    return this.interactive && this.mode !== 'attach';
  }

  /** Forgets a press in progress; a pet being dragged is let go. */
  cancelPointer(): void {
    if (this.dragging) {
      this.dragging = false;
      this.startFall(0, 0);
    }
    this.press = null;
    this.hover = false;
  }

  private onHoverEnter(p: Vec2): void {
    this.facing = p.x >= this.pos.x ? 1 : -1;
    if (this.state === 'sleep') {
      this.react('surprised');
      this.say('wake');
    } else {
      if (this.state === 'walk') {
        // stop so it can be petted instead of walking out from under the pointer
        this.target = null;
        this.enter('idle');
      }
      this.say('hover');
    }
  }

  /** Hover counts only while pointer events keep arriving, so a lost event cannot freeze the pet. */
  private isHovered(): boolean {
    return this.hover && this.time - this.hoverAt < HOVER_TIMEOUT_MS;
  }

  private isRubbing(): boolean {
    return this.isHovered() && this.time - this.rub.lastMove < 450;
  }

  private detectRub(p: Vec2): void {
    const r = this.rub;
    const dx = p.x - r.lastX;
    if (Math.abs(dx) < RUB_MIN_STEP) return;
    r.lastX = p.x;
    const dir = dx > 0 ? 1 : -1;
    if (this.time - r.since > RUB_WINDOW_MS) {
      r.reversals = 0;
      r.since = this.time;
      r.dir = dir;
    } else if (dir !== r.dir) {
      r.reversals++;
      r.dir = dir;
    }
    r.lastMove = this.time;
    if (r.reversals >= RUB_REVERSALS && this.state !== 'happy' && this.state !== 'fall') {
      this.react('happy');
      this.say('rub');
    }
  }

  private onClick(): void {
    if (this.state === 'fall') return;
    this.clicks = this.clicks.filter((t) => this.time - t < CLICK_WINDOW_MS);
    this.clicks.push(this.time);
    if (this.clicks.length >= 3) {
      this.clicks = [];
      this.react('happy');
      for (let i = 0; i < 4; i++) this.spawn('heart');
      this.say('triple');
    } else {
      this.react('surprised');
      this.say('click');
    }
  }

  /** `from` is where the button went down, so the pet stays glued to the point that was grabbed. */
  private startDrag(from: Vec2): void {
    this.dragging = true;
    this.holder = 'user';
    this.summoned = false;
    this.grab = { x: this.pos.x - from.x, y: this.pos.y - from.y };
    this.samples = [{ p: { x: from.x, y: from.y }, t: this.time }];
    this.target = null;
    this.fleeDir = null;
    this.sleepCursor = null;
    this.swing = 0;
    this.swingVel = 0;
    this.prevX = this.pos.x;
    this.interactionIdleMs = 0;
    this.enter('held', true);
    this.say('pickup');
  }

  private dragTo(p: Vec2): void {
    this.pos = this.clampFeet({ x: p.x + this.grab.x, y: p.y + this.grab.y });
    this.samples.push({ p: { x: p.x, y: p.y }, t: this.time });
    while (this.samples.length > 1 && this.time - this.samples[0]!.t > 100) this.samples.shift();
    this.interactionIdleMs = 0;
  }

  private endDrag(p: Vec2): void {
    this.dragging = false;
    this.holder = null;
    const first = this.samples[0];
    let vx = 0;
    let vy = 0;
    if (first) {
      const span = this.time - first.t;
      if (span >= 16) {
        vx = ((p.x - first.p.x) / span) * 1000;
        vy = ((p.y - first.p.y) / span) * 1000;
      }
    }
    const m = Math.hypot(vx, vy);
    const max = this.k(2200);
    if (m > max) {
      vx = (vx / m) * max;
      vy = (vy / m) * max;
    }
    this.startFall(vx * 0.8, vy * 0.8);
    // let go a hair above the floor is not a throw
    const high = this.region.floor(this.pos, this.reach()) - this.pos.y;
    if (high > this.k(40) || Math.hypot(vx, vy) > this.k(300)) this.say('throw');
  }

  // --- helpers: cursor, particles, geometry --------------------------------

  private trackCursor(dt: number): void {
    const c = this.cursor;
    if (!c) {
      this.cursorIdleMs += dt;
      return;
    }
    if (!this.lastActiveCursor || dist(c, this.lastActiveCursor) > CURSOR_JITTER) {
      this.lastActiveCursor = { x: c.x, y: c.y };
      this.cursorIdleMs = 0;
    } else {
      this.cursorIdleMs += dt;
    }
    if (this.prevCursor) {
      const vx = ((c.x - this.prevCursor.x) / dt) * 1000;
      const vy = ((c.y - this.prevCursor.y) / dt) * 1000;
      this.cursorVel.x += (vx - this.cursorVel.x) * 0.4;
      this.cursorVel.y += (vy - this.cursorVel.y) * 0.4;
      this.cursorSpeed = Math.hypot(this.cursorVel.x, this.cursorVel.y);
    }
    this.prevCursor = { x: c.x, y: c.y };
  }

  private stepParticles(dt: number): void {
    if (this.particles.length === 0) return;
    const s = dt / 1000;
    for (const p of this.particles) {
      p.age += dt;
      if (p.kind === 'text') {
        this.stepText(p, dt);
        continue;
      }
      p.x += p.vx * s;
      p.y += p.vy * s;
      if (p.kind === 'z') p.vx = Math.sin(p.age / 300) * 14;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    this.view.particles = this.particles;
  }

  private spawn(kind: ParticleKind): void {
    if (this.particles.filter((q) => q.kind !== 'text').length >= MAX_PARTICLES) return;
    const { w, h } = this.size();
    const r = this.rng;
    const p: Particle =
      kind === 'heart'
        ? { kind, x: this.pos.x + (r() - 0.5) * w * 0.5, y: this.pos.y - h * 0.78, vx: (r() - 0.5) * 30, vy: -50 - r() * 30, age: 0, life: 1000 }
        : { kind, x: this.pos.x + this.facing * w * 0.22, y: this.pos.y - h * 0.72, vx: 10, vy: -26, age: 0, life: 1800 };
    this.particles.push(p);
    this.view.particles = this.particles;
  }

  // --- helpers: speech -------------------------------------------------------

  private nextMurmur(): number {
    return this.speaker.chatty ? 5_000 + this.rng() * 5_000 : 50_000 + this.rng() * 70_000;
  }

  /** Greeting, trips from one screen to another, and the pet talking to itself when it has been left alone. */
  private stepSpeech(dt: number): void {
    if (this.greetIn !== null) {
      this.greetIn -= dt;
      if (this.greetIn <= 0) {
        this.greetIn = null;
        this.say('start');
      }
    }
    const at = this.region.indexAt(this.pos);
    if (this.screen === -2) this.screen = at;
    else if (at >= 0 && at !== this.screen) {
      const from = this.screen;
      this.screen = at;
      if (from >= 0) this.say('cross');
    }
    if (this.speaker.any && (this.state === 'idle' || this.state === 'sit') && !this.isHovered() && this.interactionIdleMs > 6000) {
      this.murmurIn -= dt;
      if (this.murmurIn <= 0) {
        this.murmurIn = this.nextMurmur();
        this.say('idle');
      }
    }
  }

  /** Keeps words of width `w` centred on `x` but inside the screen the pet is on. */
  private textX(x: number, w: number): number {
    const r = this.region.rects[Math.max(0, this.region.indexAt(this.pos))]!;
    const half = w / 2 + 4;
    return r.w > 2 * half ? clamp(x, r.x + half, r.x + r.w - half) : r.x + r.w / 2;
  }

  /** Words above the head. Sounds drift up and fade like the z's; sentences stay a while, following the pet. */
  private spawnText(line: Line): void {
    const s = this.cfg.textScale ?? this.cfg.scale;
    const held = line.style === 'hold';
    const size = (held ? 15 : 17) * s;
    const w = textWidth(line.text, size);
    const dy = -(this.reach().top + size * 0.9 + 4 * s);
    const x = this.textX(this.pos.x, w);
    const life = held ? clamp(1400 + [...line.text].length * 110, 1800, 4800) : 1500;
    // words never pile up: whatever is still up fades out now
    for (const q of this.particles) if (q.kind === 'text') q.age = Math.max(q.age, q.life - 220);
    this.particles.push({
      kind: 'text',
      text: line.text,
      style: line.style,
      size,
      w,
      x,
      y: this.pos.y + dy,
      vx: 0,
      vy: held ? 0 : -34 * s,
      age: 0,
      life,
      dx: x - this.pos.x,
      dy,
    });
    this.view.particles = this.particles;
  }

  private stepText(p: Particle, dt: number): void {
    const s = this.cfg.textScale ?? this.cfg.scale;
    if (p.style === 'hold') {
      // eases to the spot above the head, drifting up a little as it fades
      const rise = clamp(p.age / p.life, 0, 1) ** 3 * 12 * s;
      const tx = this.textX(this.pos.x + (p.dx ?? 0), p.w ?? 0);
      const ty = this.pos.y + (p.dy ?? 0) - rise;
      const k = 1 - Math.exp(-dt / 55);
      p.x += (tx - p.x) * k;
      p.y += (ty - p.y) * k;
    } else {
      p.vx = Math.sin(p.age / 280 + (p.dx ?? 0)) * 9 * s;
      p.x += (p.vx * dt) / 1000;
      p.y += (p.vy * dt) / 1000;
    }
  }

  private k(v: number): number {
    return v * this.cfg.scale;
  }

  private size(): { w: number; h: number } {
    return { w: this.cfg.sprite.w * this.cfg.scale, h: this.cfg.sprite.h * this.cfg.scale };
  }

  private center(): Vec2 {
    return { x: this.pos.x, y: this.pos.y - this.size().h * 0.45 };
  }

  /** How far the body (hitbox) reaches from the feet: it has to stay on the screens. */
  private reach(): Reach {
    const { sprite, hitbox } = this.cfg;
    const { w, h } = this.size();
    return {
      left: (sprite.anchorX - hitbox.x) * w,
      right: (hitbox.x + hitbox.w - sprite.anchorX) * w,
      top: (sprite.anchorY - hitbox.y) * h,
    };
  }

  private clampFeet(p: Vec2): Vec2 {
    return this.region.clamp(p, this.reach());
  }

  /**
   * Keeps the feet on the screens after a move. A pet walking along a floor that meets a step to another
   * screen's floor goes up or down the step at the same x, instead of being held back at the edge.
   */
  private settleFeet(p: Vec2): Vec2 {
    const reach = this.reach();
    if (this.region.fits(p, reach)) return p;
    const walking = this.cfg.roam === 'floor' && (this.state === 'walk' || this.state === 'run');
    return (walking && this.region.nearestY(p, reach)) || this.region.clamp(p, reach);
  }

  // --- animation -----------------------------------------------------------

  private syncView(): void {
    const v = this.view;
    const t = this.stateMs / 1000;
    const s = this.cfg.scale;
    let sx = 1;
    let sy = 1;
    let rot = 0;
    let lift = 0;
    let pivot: 'feet' | 'top' = 'feet';
    const breathe = Math.sin((t * 2 * Math.PI) / 2.4);

    switch (this.state) {
      case 'idle':
        sy = 1 + 0.02 * breathe;
        sx = 1 - 0.012 * breathe;
        break;
      case 'sit':
        sy = 0.93 + 0.012 * breathe;
        sx = 1.04 - 0.008 * breathe;
        break;
      case 'sleep': {
        const slow = Math.sin((t * 2 * Math.PI) / 3.6);
        sy = 0.9 + 0.03 * slow;
        sx = 1.06 - 0.02 * slow;
        rot = 0.04;
        break;
      }
      case 'walk':
      case 'run': {
        const run = this.state === 'run';
        const phase = this.gait % 1;
        const hop = Math.abs(Math.sin(Math.PI * phase));
        lift = hop * (run ? 12 : 8) * s;
        rot = Math.sin(2 * Math.PI * phase) * (run ? 0.08 : 0.05);
        sy = 1 + (hop - 0.5) * 0.05;
        sx = 1 - (hop - 0.5) * 0.04;
        break;
      }
      case 'held':
        pivot = 'top';
        rot = this.swing;
        sy = 1.04;
        sx = 0.97;
        break;
      case 'fall':
        sy = 1 + clamp(Math.abs(this.vel.y) / this.k(2400), 0, 1) * 0.14;
        sx = 1 - (sy - 1) * 0.7;
        break;
      case 'land': {
        const a = Math.exp(-t * 9) * Math.cos(t * 26);
        sy = 1 - 0.22 * a;
        sx = 1 + 0.16 * a;
        break;
      }
      case 'surprised': {
        const pop = Math.exp(-t * 8);
        sx = sy = 1 + 0.16 * pop;
        lift = 14 * s * Math.sin(Math.PI * clamp(t / 0.4, 0, 1));
        break;
      }
      case 'happy': {
        const hop = Math.abs(Math.sin(Math.PI * ((t * 1.7) % 1)));
        lift = hop * 10 * s;
        sy = 1 + (hop - 0.5) * 0.05;
        sx = 1 - (hop - 0.5) * 0.04;
        break;
      }
      case 'act': {
        // 'off': the picture moves by itself
        const motion = this.act?.def.motion ?? 'still';
        if (motion === 'bounce') {
          const hop = Math.abs(Math.sin(Math.PI * ((t * 1.5) % 1)));
          lift = hop * 9 * s;
          sy = 1 + (hop - 0.5) * 0.05;
          sx = 1 - (hop - 0.5) * 0.04;
        } else if (motion === 'sway') {
          rot = Math.sin((t * 2 * Math.PI) / 1.2) * 0.07;
          sy = 1 + 0.012 * breathe;
        } else if (motion === 'still') {
          sy = 1 + 0.02 * breathe;
          sx = 1 - 0.012 * breathe;
        }
        break;
      }
    }

    v.x = this.pos.x;
    v.y = this.pos.y;
    v.facing = this.facing;
    v.state = this.state;
    v.t = t;
    v.sx = sx;
    v.sy = sy;
    v.rot = rot;
    v.lift = lift;
    v.pivot = pivot;
    v.scale = s;
    v.particles = this.particles;
    v.hitbox = this.hitbox();
    v.interactive = this.canInteract();
    v.animating = this.particles.length > 0 || !(this.state === 'idle' || this.state === 'sit' || this.state === 'sleep');
    v.action = this.state === 'act' ? (this.act?.def.pose ?? null) : null;
  }
}
