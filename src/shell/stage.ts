import { Pet } from '../engine';
import type { PetView, Rect, Vec2 } from '../engine/types';
import { mulberry32, inEllipse } from '../engine/vec';
import type { Area, PointerReport, Settings, SkinGeometry, ViewFrame } from '../shared/types';

/** One overlay window, as the stage sees it. */
export interface StageWindow {
  /** the part of the shared screen space the window covers */
  readonly area: Area;
  /** Lets the mouse through (true) or makes the window take it (false). */
  setIgnoring(ignore: boolean): void;
  /** The pet as seen from the shared space; null once the pet has left this window. */
  send(frame: ViewFrame | null): void;
}

export interface StageDeps {
  /** where the mouse is, in the shared space */
  cursor(): Vec2;
  /** true while another window of ours is in front of the pet at this point, so the clicks must reach that window */
  covered(p: Vec2): boolean;
  rng?: () => number;
}

/** Calm poses (idle, sit, sleep) only need a slow refresh. */
const CALM_MS = 66;
/** A jump this long in one step is a teleport (the screens changed), not movement to draw towards. */
const TELEPORT = 240;

const rectOf = (a: Area): Rect => ({ x: a.x, y: a.y, w: a.width, h: a.height });
const contains = (a: Area, p: Vec2): boolean => p.x >= a.x && p.x < a.x + a.width && p.y >= a.y && p.y < a.y + a.height;
const overlaps = (a: Area, b: Area): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

interface WindowState {
  ignoring: boolean;
  hasPet: boolean;
}

/**
 * The pet's whole life, in one place for all monitors: it is simulated here, in the shared screen space, and
 * every overlay window just draws what it is told. The stage also decides which window lets the mouse through.
 */
export class Stage {
  private pet: Pet | null = null;
  private settings: Settings;
  private geometry: SkinGeometry | null = null;
  private windows = new Map<StageWindow, WindowState>();
  private pressed: StageWindow | null = null;
  private last = Number.NaN;
  private lastCursor: Vec2 = { x: Number.NaN, y: Number.NaN };
  private from: Vec2 | null = null;
  private v: Vec2 = { x: 0, y: 0 };
  private sentAt = -Infinity;
  private sent = { state: '', facing: 0, interactive: false, scale: 0, particles: 0 };

  constructor(
    private readonly deps: StageDeps,
    settings: Settings,
  ) {
    this.settings = settings;
  }

  /** The pet's current look, or null before it exists. For tests and diagnostics. */
  get view(): PetView | null {
    return this.pet?.view ?? null;
  }

  /** Which windows are up. Their areas are the screens the pet may be on; the first is where it starts. */
  setWindows(windows: readonly StageWindow[]): void {
    const next = new Map<StageWindow, WindowState>();
    // a new window starts out letting the mouse through
    for (const w of windows) next.set(w, this.windows.get(w) ?? { ignoring: true, hasPet: false });
    this.windows = next;
    if (this.pressed && !next.has(this.pressed)) {
      this.pressed = null;
      this.pet?.cancelPointer();
    }
    // with no window at all (every monitor is gone for a moment) the pet keeps the screens it had
    if (this.pet && windows.length > 0) this.pet.setRegion(windows.map((w) => rectOf(w.area)));
    else this.start();
  }

  /** The skin on screen changed (or was loaded for the first time). */
  setSkin(g: SkinGeometry): void {
    this.geometry = g;
    if (this.pet) this.pet.setSprite(g.box, g.hitbox);
    else this.start();
  }

  setSettings(s: Settings): void {
    this.settings = s;
    const pet = this.pet;
    if (!pet) return;
    pet.setMode(s.mode);
    pet.setScale(s.scale);
    pet.setRoam(s.roam);
    pet.setInteractive(!s.clickThrough);
    if (this.pressed && !pet.pressed) this.pressed = null;
  }

  /**
   * A mouse button went down or up in `win`. A press is placed by the window's own coordinates (they are exact for
   * the click); a release is placed by the pointer itself, which is right even when the window lost the pointer.
   */
  pointer(win: StageWindow, e: PointerReport): void {
    const pet = this.pet;
    if (!pet || !this.windows.has(win)) return;
    const c = this.deps.cursor();
    if (e.kind === 'down') {
      if (pet.pressed) return;
      pet.pointerDown({ x: win.area.x + e.x, y: win.area.y + e.y });
      this.pressed = pet.pressed ? win : null;
    } else if (this.pressed === win) {
      pet.pointerUp(c);
      this.pressed = null;
    }
    this.captureMouse(c);
  }

  /** Advances the pet to `now` (ms) and sends what changed to the windows. */
  tick(now: number): void {
    const pet = this.pet;
    if (!pet) return;
    const dt = Number.isNaN(this.last) ? 16 : now - this.last;
    this.last = now;
    const c = this.deps.cursor();
    const covered = this.deps.covered(c);

    pet.setCursor(c);
    // hover, rubbing and drags follow the polled pointer: the windows only report the buttons
    const moved = c.x !== this.lastCursor.x || c.y !== this.lastCursor.y;
    this.lastCursor = c;
    if (pet.pressed || (moved && !covered)) pet.pointerMove(c);
    if (covered || !pet.isOver(c)) pet.pointerLeave();
    pet.update(dt);
    if (this.pressed && !pet.pressed) this.pressed = null;

    this.measure(pet.view, dt);
    this.broadcast(pet.view, now);
    this.captureMouse(c);
  }

  // --- internals -----------------------------------------------------------

  private start(): void {
    const g = this.geometry;
    if (this.pet || !g || this.windows.size === 0) return;
    const rects = [...this.windows.keys()].map((w) => rectOf(w.area));
    const s = this.settings;
    this.pet = new Pet({
      world: { width: rects[0]!.w, height: rects[0]!.h },
      region: rects,
      mode: s.mode,
      rng: this.deps.rng ?? mulberry32(Date.now()),
      config: { scale: s.scale, roam: s.roam, sprite: g.box, hitbox: g.hitbox },
    });
    this.pet.setInteractive(!s.clickThrough);
  }

  /** Feet speed over the last step, so a window can draw the pet between two frames. */
  private measure(v: PetView, dt: number): void {
    const prev = this.from;
    this.from = { x: v.x, y: v.y };
    const s = Math.max(dt, 1) / 1000;
    if (!prev || Math.hypot(v.x - prev.x, v.y - prev.y) > TELEPORT) this.v = { x: 0, y: 0 };
    else this.v = { x: (v.x - prev.x) / s, y: (v.y - prev.y) / s };
  }

  /** Everything the pet may paint: its sprite box, with room for swinging, hopping and the hearts and z's. */
  private paintArea(v: PetView): Area {
    const { box } = this.geometry!;
    const w = box.w * v.scale;
    const h = box.h * v.scale;
    const pad = Math.max(w, h) * 0.6 + 80;
    return { x: v.x - box.anchorX * w - pad, y: v.y - box.anchorY * h - pad, width: w + 2 * pad, height: h + 2 * pad };
  }

  private broadcast(v: PetView, now: number): void {
    const s = this.sent;
    const changed =
      v.state !== s.state || v.facing !== s.facing || v.interactive !== s.interactive || v.scale !== s.scale || v.particles.length !== s.particles;
    const due = v.animating || changed || now - this.sentAt >= CALM_MS;
    if (due) {
      this.sent = { state: v.state, facing: v.facing, interactive: v.interactive, scale: v.scale, particles: v.particles.length };
      this.sentAt = now;
    }
    const paint = this.paintArea(v);
    const frame: ViewFrame = { view: v, vx: this.v.x, vy: this.v.y };
    for (const [win, st] of this.windows) {
      const here = overlaps(paint, win.area);
      if (here && (due || !st.hasPet)) win.send(frame);
      else if (!here && st.hasPet) win.send(null);
      st.hasPet = here;
    }
  }

  /**
   * Exactly one window takes the mouse: the one the pet was grabbed in, or while nothing is held, the one under
   * the pointer when the pointer is on the pet. All the others let everything through.
   */
  private captureMouse(c: Vec2): void {
    const pet = this.pet;
    if (!pet) return;
    const v = pet.view;
    const onPet = v.interactive && !this.deps.covered(c) && inEllipse(c, v.hitbox);
    for (const [win, st] of this.windows) {
      const take = this.pressed ? win === this.pressed : onPet && contains(win.area, c);
      if (take === !st.ignoring) continue;
      st.ignoring = !take;
      win.setIgnoring(!take);
    }
  }
}
