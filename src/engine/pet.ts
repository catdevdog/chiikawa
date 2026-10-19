import {
  DEFAULT_CONFIG,
  type Line,
  type Lines,
  type Mode,
  type NoticeEvent,
  type Particle,
  type ParticleKind,
  type PetConfig,
  type PetState,
  type PetView,
  type Rect,
  type Roam,
  type SayEvent,
  type SpeechLevel,
  type Vec2,
} from './types';
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

export interface PetOptions {
  /** one screen from the origin; its bottom edge is the floor */
  world: { width: number; height: number };
  /** several screens (their work areas, in one coordinate space); the first is where the pet starts. Replaces `world`. */
  region?: Rect[];
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
    this.pos = { x: home.x + home.w / 2, y: home.y + home.h };
    this.prevX = this.pos.x;
    this.view = {
      x: 0, y: 0, facing: 1, state: 'idle', t: 0, sx: 1, sy: 1, rot: 0, lift: 0, pivot: 'feet',
      scale: this.cfg.scale, particles: this.particles, hitbox: { x: 0, y: 0, w: 0, h: 0 },
      interactive: true, animating: false,
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

  setScale(scale: number): void {
    this.cfg.scale = scale;
    this.pos = this.clampFeet(this.pos);
  }

  setRoam(roam: Roam): void {
    this.cfg.roam = roam;
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

  /** Says something for a situation, if the skin has words for it and it is not too soon. */
  say(event: SayEvent): void {
    const holding = this.particles.some((p) => p.kind === 'text' && p.style === 'hold' && p.age < p.life - 400);
    const line = this.speaker.pick(event, this.time, holding);
    if (line) this.spawnText(line);
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
      this.react(event === 'welcome' || event === 'plug' ? 'happy' : 'surprised');
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
    if (this.cfg.roam === 'floor' && this.pos.y < this.region.floor(this.pos, this.reach()) - 1) {
      this.startFall(0, 0);
      return;
    }
    if (this.summoned) {
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
    if (eff === 'follow') this.stepFollow(dt);
    else this.stepWander(dt);
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
      this.react('happy');
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
    this.vel.x *= Math.max(0, 1 - 1.5 * s);
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
    this.pos.y += this.vel.y * s;
    if (this.pos.y < ceilY) {
      this.pos.y = ceilY;
      this.vel.y = Math.abs(this.vel.y) * 0.3;
    }
    if (this.pos.y >= floorY) {
      this.pos.y = floorY;
      if (this.vel.y > this.k(700) && this.bounces < 1) {
        this.vel.y = -this.vel.y * 0.3;
        this.vel.x *= 0.7;
        this.bounces++;
      } else {
        const airtime = this.stateMs;
        this.vel = { x: 0, y: 0 };
        this.enter('land');
        if (airtime > 450) this.say('land');
      }
    }
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

  private startFall(vx: number, vy: number): void {
    this.vel = { x: vx, y: vy };
    this.bounces = 0;
    this.target = null;
    this.holder = null;
    this.enter('fall', true);
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
    const s = this.cfg.scale;
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
    const s = this.cfg.scale;
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
  }
}
