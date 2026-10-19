import { Flock, Pet } from '../engine';
import { nearestSide } from '../engine/peek';
import type { NoticeEvent, PetView, Platform, Rect, SayEvent, Vec2 } from '../engine/types';
import { clamp, mulberry32 } from '../engine/vec';
import { bodyOf, fitTo } from '../shared/body';
import { MAX_FRIENDS, type Area, type PointerReport, type Settings, type SkinReport, type ViewFrame } from '../shared/types';

/** One overlay window, as the stage sees it. */
export interface StageWindow {
  /** the part of the shared screen space the window covers */
  readonly area: Area;
  /** Lets the mouse through (true) or makes the window take it (false). */
  setIgnoring(ignore: boolean): void;
  /** The pets that are in this window, as seen from the shared space (none: nothing to draw here). */
  send(frames: ViewFrame[]): void;
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
/** Friends start this far apart, to either side of the middle. */
const FRIEND_SPACING = 260;

const rectOf = (a: Area): Rect => ({ x: a.x, y: a.y, w: a.width, h: a.height });
const contains = (a: Area, p: Vec2): boolean => p.x >= a.x && p.x < a.x + a.width && p.y >= a.y && p.y < a.y + a.height;
const overlaps = (a: Area, b: Area): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

interface WindowState {
  ignoring: boolean;
  /** the pets (by id) this window was last told about */
  present: Set<string>;
}

/** One pet that lives on the screens: its skin, and what its windows need to know to draw it between two frames. */
interface Member {
  id: string;
  pet: Pet;
  skin: SkinReport;
  from: Vec2 | null;
  v: Vec2;
  sent: { state: string; facing: number; interactive: boolean; scale: number; particles: number };
  sentAt: number;
}

/**
 * The pets' whole life, in one place for all monitors: they are simulated here, in the shared screen space, and
 * every overlay window just draws what it is told. The first pet is the main character (the one the mode and the
 * mouse are about); the others are its friends, who go about on their own and meet each other. The stage also
 * decides which window lets the mouse through.
 */
export class Stage {
  /** the main character first, then its friends */
  private members: Member[] = [];
  /** the skin of every character the overlays have loaded */
  private reports = new Map<string, SkinReport>();
  private settings: Settings;
  private windows = new Map<StageWindow, WindowState>();
  private pressed: { win: StageWindow; member: Member } | null = null;
  /** the windows of other programs the pets may stand on (their uncovered top edges) */
  private platforms: readonly Platform[] = [];
  /** put away for a while: nothing moves, nothing is drawn, the mouse goes through */
  private hidden = false;
  private last = Number.NaN;
  private lastCursor: Vec2 = { x: Number.NaN, y: Number.NaN };
  private readonly flock: Flock;

  constructor(
    private readonly deps: StageDeps,
    settings: Settings,
  ) {
    this.settings = settings;
    this.flock = new Flock(deps.rng ?? mulberry32(Date.now() ^ 0x5bd1e995));
  }

  /** The main character's current look, or null before it exists. For tests and diagnostics. */
  get view(): PetView | null {
    return this.members[0]?.pet.view ?? null;
  }

  /** Everyone's current look, by skin id. For tests and diagnostics. */
  get views(): { id: string; view: PetView }[] {
    return this.members.map((m) => ({ id: m.id, view: m.pet.view }));
  }

  /** The pets that are hiding at a wall (on the way to it or waiting), by skin id. For tests and diagnostics. */
  get hiding(): string[] {
    return this.members.filter((m) => m.pet.peeking).map((m) => m.id);
  }

  /** How big each pet looks (by its picture), the scale it is drawn at, and what that makes of it on screen. For tests and diagnostics. */
  get sizes(): { id: string; body: number; scale: number; looks: number }[] {
    return this.members.map((m) => {
      const body = bodyOf(m.skin);
      return { id: m.id, body, scale: m.pet.view.scale, looks: body * m.pet.view.scale };
    });
  }

  /** Makes the main character say something for a situation, as if it had just happened (for tests and diagnostics). */
  say(event: SayEvent): void {
    this.members[0]?.pet.say(event);
  }

  get isHidden(): boolean {
    return this.hidden;
  }

  /** Puts the pets away, or brings them back where they were (with a greeting). They do not live on while hidden. */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (hidden) this.putAway();
    else {
      this.resume();
      for (const m of this.members) if (!m.pet.peeking) m.pet.say('start');
    }
  }

  /**
   * Everyone hides behind the wall nearest to `origin` (the main character by default): the outer edge of the screens
   * on its side. They all run to it and each takes a place of its own up the wall, the nearest to it at the bottom.
   * False when there is nobody to hide, or nowhere.
   */
  hideAtWall(origin?: string): boolean {
    if (this.hidden) return false;
    const from = this.members.find((m) => m.id === origin) ?? this.members[0];
    if (!from) return false;
    return this.peekAll(from);
  }

  /** Everyone that hides comes out, as if one of them had been found. */
  findAll(): void {
    this.seekAll(null);
  }

  /** The user calls the pets: out of hiding if need be, and over to the cursor. */
  call(): void {
    if (this.hidden) {
      this.hidden = false;
      this.resume();
    }
    for (const m of this.members) m.pet.call();
  }

  /** Does any of the characters on screen have actions to show? */
  get hasActions(): boolean {
    return this.members.some((m) => m.pet.hasActions);
  }

  /**
   * The user asks to see a trick. With a name it is the main character's action of that name; without, every
   * character that has any does one. False when there was none to do, or the pets are away.
   */
  perform(name?: string): boolean {
    if (this.hidden) return false;
    if (name !== undefined) return this.members[0]?.pet.perform(name) ?? false;
    let did = false;
    for (const m of this.members) did = m.pet.perform() || did;
    return did;
  }

  /** Something happened on the computer. Pets that are put away have nothing to show for it. */
  notice(event: NoticeEvent): void {
    if (this.hidden) return;
    for (const m of this.members) m.pet.notice(event);
  }

  /** The windows of other programs the pets may stand on, as they are now (none: the pets stay on the floor, and any that stand on one fall). */
  setPlatforms(list: readonly Platform[]): void {
    this.platforms = list;
    for (const m of this.members) m.pet.setPlatforms(list);
  }

  /** The places to stand that the pets were told about. For tests and diagnostics. */
  get platformList(): readonly Platform[] {
    return this.platforms;
  }

  /** The window each pet stands on right now (null: none), by skin id. For tests and diagnostics. */
  get perches(): { id: string; on: string | null }[] {
    return this.members.map((m) => ({ id: m.id, on: m.pet.perched }));
  }

  /** Which windows are up. Their areas are the screens the pets may be on; the first is where they start. */
  setWindows(windows: readonly StageWindow[]): void {
    const next = new Map<StageWindow, WindowState>();
    // a new window starts out letting the mouse through
    for (const w of windows) next.set(w, this.windows.get(w) ?? { ignoring: true, present: new Set() });
    this.windows = next;
    if (this.pressed && !next.has(this.pressed.win)) {
      this.pressed.member.pet.cancelPointer();
      this.pressed = null;
    }
    // with no window at all (every monitor is gone for a moment) the pets keep the screens they had
    if (windows.length > 0) for (const m of this.members) m.pet.setRegion(windows.map((w) => rectOf(w.area)));
    this.sync();
  }

  /** A skin on screen changed (or was loaded for the first time). */
  setSkin(skin: SkinReport): void {
    this.reports.set(skin.id, skin);
    this.sync();
    const m = this.members.find((x) => x.id === skin.id);
    if (m) this.dress(m, skin);
    this.refit();
  }

  setSettings(s: Settings): void {
    this.settings = s;
    this.sync();
    this.members.forEach((m, i) => this.apply(m, i === 0));
    if (this.pressed && !this.pressed.member.pet.pressed) this.pressed = null;
  }

  /**
   * A mouse button went down or up in `win`. A press is placed by the window's own coordinates (they are exact for
   * the click) and goes to the pet in front at that point; a release is placed by the pointer itself, which is right
   * even when the window lost the pointer.
   */
  pointer(win: StageWindow, e: PointerReport): void {
    if (this.members.length === 0 || this.hidden || !this.windows.has(win)) return;
    const c = this.deps.cursor();
    if (e.kind === 'down') {
      if (this.pressed) return;
      const at = { x: win.area.x + e.x, y: win.area.y + e.y };
      const member = this.frontAt(at);
      if (!member) return;
      member.pet.pointerDown(at);
      this.pressed = member.pet.pressed ? { win, member } : null;
    } else if (this.pressed?.win === win) {
      const { member } = this.pressed;
      member.pet.pointerUp(c);
      this.pressed = null;
      this.answerClick(member);
    }
    this.captureMouse(c);
  }

  /** Advances the pets to `now` (ms) and sends what changed to the windows. */
  tick(now: number): void {
    if (this.members.length === 0 || this.hidden) return;
    const dt = Number.isNaN(this.last) ? 16 : now - this.last;
    this.last = now;
    const c = this.deps.cursor();
    const covered = this.deps.covered(c);

    // hover, rubbing and drags follow the polled pointer: the windows only report the buttons. Only the pet in
    // front (or the one being held) feels the pointer; the others are left alone by it.
    const moved = c.x !== this.lastCursor.x || c.y !== this.lastCursor.y;
    this.lastCursor = c;
    const front = this.pressed?.member ?? (covered ? null : this.frontAt(c));
    for (const m of this.members) {
      m.pet.setCursor(c);
      if (m.pet.pressed || (m === front && moved && !covered)) m.pet.pointerMove(c);
      if (covered || m !== front || !m.pet.isOver(c)) m.pet.pointerLeave();
    }
    // a pet that hides was picked up: that finds the others too
    for (const m of this.members) {
      if (m.pet.takeFound()) {
        this.seekAll(m);
        break;
      }
    }
    this.flock.step(
      dt,
      this.members.map((m) => ({ id: m.id, pet: m.pet })),
    );
    for (const m of this.members) m.pet.update(dt);
    if (this.pressed && !this.pressed.member.pet.pressed) this.pressed = null;

    for (const m of this.members) this.measure(m, dt);
    this.broadcast(now);
    this.captureMouse(c);
  }

  // --- internals -----------------------------------------------------------

  /** Three clicks on a pet send everyone to hide; a click on one that hides brings everyone out. */
  private answerClick(m: Member): void {
    if (m.pet.takeTriple()) this.peekAll(m);
    else if (m.pet.takeFound()) this.seekAll(m);
  }

  private peekAll(origin: Member): boolean {
    const areas = [...this.windows.keys()].map((w) => rectOf(w.area));
    const hiders = this.members.filter((m) => m.pet.mode !== 'attach');
    if (areas.length === 0 || hiders.length === 0) return false;
    // the wall is the outer edge of all the screens, on the side the clicked pet is nearer to
    const x0 = Math.min(...areas.map((r) => r.x));
    const x1 = Math.max(...areas.map((r) => r.x + r.w));
    const side = nearestSide(origin.pet.view.x, { x0, x1 });
    const x = side === 1 ? x1 : x0;
    // screens side by side with their edges at the wall share it; the one the pet is level with is where they hide
    const oy = origin.pet.view.y;
    const away = (r: Rect): number => Math.abs(clamp(oy, r.y, r.y + r.h) - oy);
    const rect = areas.filter((r) => (side === 1 ? r.x + r.w : r.x) === x).reduce((best, r) => (away(r) < away(best) ? r : best));
    const floorY = rect.y + rect.h;
    // from the floor up, the one nearest to the wall first; each place is as high as the tallest of them, so that none covers another
    const order = [...hiders].sort((a, b) => Math.abs(a.pet.view.x - x) - Math.abs(b.pet.view.x - x));
    const height = (m: Member): number => (m.pet.peekLayout.top + m.pet.peekLayout.bottom) * m.pet.view.scale;
    const unit = Math.max(...order.map(height)) * 1.08;
    order.forEach((m, i) => {
      const top = m.pet.peekLayout.top * m.pet.view.scale;
      m.pet.hideAt({ x, side, floorY, y: Math.max(rect.y + top + 8, floorY - i * unit) });
    });
    return true;
  }

  /** The pets that hide come out; `found` is the one that was found and says so. */
  private seekAll(found: Member | null): void {
    for (const m of this.members) m.pet.unhide(m === found);
  }

  /** Clears every window and lets the mouse through; a pet in someone's hand is let go. */
  private putAway(): void {
    for (const m of this.members) m.pet.cancelPointer();
    this.pressed = null;
    for (const [win, st] of this.windows) {
      if (st.present.size > 0) win.send([]);
      st.present = new Set();
      if (!st.ignoring) {
        st.ignoring = true;
        win.setIgnoring(true);
      }
    }
  }

  /** Time stood still while the pets were away; the first step after it is an ordinary one. */
  private resume(): void {
    this.last = Number.NaN;
    for (const m of this.members) m.sent.state = '';
  }

  /**
   * Makes the pets match the settings and the skins that are known: the main character is the skin that is chosen
   * (a new choice changes the clothes of the pet that is there, which stays where it is), and every friend that is
   * chosen and known is a pet of its own. Friends that are no longer chosen leave.
   */
  private sync(): void {
    if (this.windows.size === 0) return;
    const s = this.settings;
    const main = this.reports.get(s.skin);
    if (main) {
      if (this.members.length === 0) this.members.push(this.create(s.skin, main, null));
      else if (this.members[0]!.id !== s.skin) {
        this.members[0]!.id = s.skin;
        this.dress(this.members[0]!, main);
      }
    }
    if (this.members.length === 0) return;
    const mainId = this.members[0]!.id;
    const wanted = s.friends.filter((id) => id !== mainId && this.reports.has(id));
    const there = new Map(this.members.slice(1).map((m) => [m.id, m]));
    // where everybody stands, so that a newcomer does not come down on top of someone
    const standing = this.members.map((m) => m.pet.view.x);
    // the main character first, then the friends in the order they were chosen; the ones already here stay as they are
    const next = [this.members[0]!];
    for (const id of wanted) {
      let m = there.get(id);
      if (!m) {
        m = this.create(id, this.reports.get(id)!, standing);
        standing.push(m.pet.view.x);
      }
      next.push(m);
    }
    this.members = next;
    this.refit();
  }

  /**
   * How much larger or smaller than its skin draws it a pet is made. Alone, a pet is as big as its skin says. With
   * friends about, every pet looks as big as the main character does (by the area of the picture, since skins fill
   * their boxes differently), and the main character itself stays as it is.
   */
  private fit(m: Member): number {
    const main = this.members[0];
    if (!main || m === main || this.members.length < 2) return 1;
    return fitTo(bodyOf(main.skin), bodyOf(m.skin));
  }

  /** Sizes every pet again: after anyone came or went, a skin changed, or the size was chosen anew. */
  private refit(): void {
    const scale = this.settings.scale;
    for (const m of this.members) m.pet.setScale(scale * this.fit(m), scale);
  }

  /** The place for a friend that comes in: to either side of the middle of the first screen, the free one nearest it. */
  private startX(first: Rect, standing: readonly number[]): number {
    const middle = first.x + first.w / 2;
    let best = middle;
    let bestGap = -1;
    for (let slot = 1; slot <= 2 * MAX_FRIENDS + 1; slot++) {
      const side = slot % 2 === 1 ? 1 : -1;
      const x = clamp(middle + side * Math.ceil(slot / 2) * FRIEND_SPACING, first.x + 80, first.x + first.w - 80);
      const gap = Math.min(Infinity, ...standing.map((o) => Math.abs(o - x)));
      if (gap >= FRIEND_SPACING / 2) return x;
      // a small screen has no free place: take the one with the most room
      if (gap > bestGap) {
        best = x;
        bestGap = gap;
      }
    }
    return best;
  }

  /** A new pet. A friend (`standing` says where the others are) comes in at a free place; the main character (null) in the middle. */
  private create(id: string, skin: SkinReport, standing: readonly number[] | null): Member {
    const rects = [...this.windows.keys()].map((w) => rectOf(w.area));
    const first = rects[0]!;
    const s = this.settings;
    const pet = new Pet({
      world: { width: first.w, height: first.h },
      region: rects,
      mode: standing ? 'wander' : s.mode,
      rng: this.deps.rng ?? mulberry32(Date.now() + this.members.length * 7919 + (standing?.length ?? 0) * 104729),
      x: standing ? this.startX(first, standing) : undefined,
      config: { scale: s.scale, roam: s.roam, sprite: skin.box, hitbox: skin.hitbox, peek: skin.peek },
    });
    const m: Member = { id, pet, skin, from: null, v: { x: 0, y: 0 }, sent: { state: '', facing: 0, interactive: false, scale: 0, particles: 0 }, sentAt: -Infinity };
    pet.setSpeech(s.speech);
    pet.setTricks(s.tricks);
    pet.setLines(skin.lines);
    pet.setActions(skin.actions);
    pet.setInteractive(!s.clickThrough);
    pet.setPlatforms(this.platforms);
    return m;
  }

  /** The pet wears this skin (its size, its words and its actions). */
  private dress(m: Member, skin: SkinReport): void {
    m.skin = skin;
    m.pet.setSprite(skin.box, skin.hitbox, skin.peek);
    m.pet.setLines(skin.lines);
    m.pet.setActions(skin.actions);
  }

  private apply(m: Member, main: boolean): void {
    const s = this.settings;
    const pet = m.pet;
    // only the main character is about the mouse; its friends go about on their own
    pet.setMode(main ? s.mode : 'wander');
    pet.setScale(s.scale * this.fit(m), s.scale);
    pet.setRoam(s.roam);
    pet.setSpeech(s.speech);
    pet.setTricks(s.tricks);
    pet.setInteractive(!s.clickThrough);
  }

  /** The pet in front at a point (the one standing lowest on the screen, of those that are there), if any. */
  private frontAt(p: Vec2): Member | null {
    let best: Member | null = null;
    for (const m of this.members) {
      if (!m.pet.view.interactive || !m.pet.isOver(p)) continue;
      if (!best || m.pet.view.y > best.pet.view.y) best = m;
    }
    return best;
  }

  /** Feet speed over the last step, so a window can draw the pet between two frames. */
  private measure(m: Member, dt: number): void {
    const v = m.pet.view;
    const prev = m.from;
    m.from = { x: v.x, y: v.y };
    const s = Math.max(dt, 1) / 1000;
    if (!prev || Math.hypot(v.x - prev.x, v.y - prev.y) > TELEPORT) m.v = { x: 0, y: 0 };
    else m.v = { x: (v.x - prev.x) / s, y: (v.y - prev.y) / s };
  }

  /** Everything a pet may paint: its sprite box with room for swinging, hopping, hearts and z's, and any words. */
  private paintArea(m: Member): Area {
    const v = m.pet.view;
    const { box } = m.skin;
    const w = box.w * v.scale;
    const h = box.h * v.scale;
    const pad = Math.max(w, h) * 0.6 + 80;
    let x0 = v.x - box.anchorX * w - pad;
    let y0 = v.y - box.anchorY * h - pad;
    let x1 = x0 + w + 2 * pad;
    let y1 = y0 + h + 2 * pad;
    // a sentence can be much wider than the pet
    for (const p of v.particles) {
      if (p.kind !== 'text') continue;
      const half = (p.w ?? 0) / 2 + 12;
      const size = p.size ?? 16;
      x0 = Math.min(x0, p.x - half);
      x1 = Math.max(x1, p.x + half);
      y0 = Math.min(y0, p.y - size * 1.5);
      y1 = Math.max(y1, p.y + size);
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  private broadcast(now: number): void {
    const seen = this.members.map((m) => {
      const v = m.pet.view;
      const s = m.sent;
      const changed =
        v.state !== s.state || v.facing !== s.facing || v.interactive !== s.interactive || v.scale !== s.scale || v.particles.length !== s.particles;
      const due = v.animating || changed || now - m.sentAt >= CALM_MS;
      if (due) {
        m.sent = { state: v.state, facing: v.facing, interactive: v.interactive, scale: v.scale, particles: v.particles.length };
        m.sentAt = now;
      }
      const frame: ViewFrame = { id: m.id, view: v, vx: m.v.x, vy: m.v.y };
      return { id: m.id, due, paint: this.paintArea(m), frame };
    });
    for (const [win, st] of this.windows) {
      const here = seen.filter((e) => overlaps(e.paint, win.area));
      const present = new Set(here.map((e) => e.id));
      const changed = present.size !== st.present.size || [...present].some((id) => !st.present.has(id));
      // a window is told when a pet comes or goes (an empty list: nothing of ours is here now), and while any of them moves
      if (changed || here.some((e) => e.due)) win.send(here.map((e) => e.frame));
      st.present = present;
    }
  }

  /**
   * Exactly one window takes the mouse: the one a pet was grabbed in, or while nothing is held, the one under the
   * pointer when the pointer is on a pet. All the others let everything through.
   */
  private captureMouse(c: Vec2): void {
    if (this.members.length === 0) return;
    const covered = this.deps.covered(c);
    const onPet = !covered && this.members.some((m) => m.pet.view.interactive && m.pet.isOver(c));
    for (const [win, st] of this.windows) {
      const take = this.pressed ? win === this.pressed.win : onPet && contains(win.area, c);
      if (take === !st.ignoring) continue;
      st.ignoring = !take;
      win.setIgnoring(!take);
    }
  }
}
