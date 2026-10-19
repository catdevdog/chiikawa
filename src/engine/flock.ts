import type { Pet } from './pet';
import type { Peer } from './types';
import { dist } from './vec';

/** One of the pets that live together, and the name the others know it by (its skin). */
export interface Member {
  id: string;
  pet: Pet;
}

/** How close (feet to feet, at scale 1) two friends have to come to notice each other. */
export const MEET_DISTANCE = 170;
/** The same two friends greet each other at most this often. */
export const PAIR_COOLDOWN_MS = 75_000;
/** The one that is greeted answers after this long, and a little longer by chance. */
const REPLY_DELAY_MS = 1100;
const REPLY_JITTER_MS = 600;

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
const moving = (p: Pet): boolean => p.view.state === 'walk' || p.view.state === 'run';

/**
 * How several pets get on. Each is told who else lives here, so that it goes to stand beside a friend now and then;
 * when two come close to each other the one that came greets the other, which turns to it and answers a moment later.
 * The same pair does not greet again for a while.
 */
export class Flock {
  private clock = 0;
  private met = new Map<string, number>();
  private replies: { at: number; from: Member; to: Member }[] = [];

  constructor(private readonly rng: () => number) {}

  /** Moves things on by `dt` ms for the pets that are on the screens now. */
  step(dt: number, members: readonly Member[]): void {
    this.clock += dt;
    if (members.length < 2) {
      this.replies = [];
      for (const m of members) m.pet.setPeers([]);
      return;
    }
    const ids = new Set(members.map((m) => m.id));
    this.replies = this.replies.filter((r) => ids.has(r.from.id) && ids.has(r.to.id));
    const peers: Peer[] = members.map((m) => ({ id: m.id, x: m.pet.view.x, y: m.pet.view.y, state: m.pet.view.state }));
    members.forEach((m, i) => m.pet.setPeers(peers.filter((_, j) => j !== i)));

    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) this.consider(members[i]!, members[j]!);
    }

    const due = this.replies.filter((r) => r.at <= this.clock);
    this.replies = this.replies.filter((r) => r.at > this.clock);
    for (const r of due) {
      if (!r.to.pet.meetable) continue;
      r.to.pet.meet(r.from.id, { x: r.from.pet.view.x, y: r.from.pet.view.y }, 'reply');
    }
  }

  /** Two pets: close enough, both free, not met lately? Then one greets. */
  private consider(a: Member, b: Member): void {
    const va = a.pet.view;
    const vb = b.pet.view;
    if (dist({ x: va.x, y: va.y }, { x: vb.x, y: vb.y }) > MEET_DISTANCE * Math.max(va.scale, vb.scale)) return;
    if (!a.pet.meetable || !b.pet.meetable) return;
    const key = pairKey(a.id, b.id);
    if (this.clock - (this.met.get(key) ?? -Infinity) < PAIR_COOLDOWN_MS) return;
    this.met.set(key, this.clock);
    // the one that walked up does the greeting; if neither (or both) did, it is by chance
    const [from, to] = moving(a.pet) !== moving(b.pet) ? (moving(a.pet) ? [a, b] : [b, a]) : this.rng() < 0.5 ? [a, b] : [b, a];
    from.pet.meet(to.id, { x: to.pet.view.x, y: to.pet.view.y }, 'greet');
    to.pet.meet(from.id, { x: from.pet.view.x, y: from.pet.view.y }, 'listen');
    this.replies.push({ at: this.clock + REPLY_DELAY_MS + this.rng() * REPLY_JITTER_MS, from, to });
  }
}
