import { describe, expect, it } from 'vitest';
import { Flock, MEET_DISTANCE, PAIR_COOLDOWN_MS, Pet, mulberry32, type Member, type PetOptions } from '../src/engine';
import { forPartner, parseLineList, parseLines, Speaker } from '../src/engine/speech';

const W = 1600;
const H = 720;

function pet(id: string, lines: ReturnType<typeof parseLines>, opts: Partial<PetOptions> = {}): Member {
  const p = new Pet({ world: { width: W, height: H }, rng: mulberry32(id.length * 7 + 1), mode: 'wander', config: { roam: 'floor', sleepAfterMs: 1e9 }, ...opts });
  p.setLines(lines);
  p.update(16);
  return { id, pet: p };
}

const words = (m: Member): string[] => m.pet.view.particles.filter((p) => p.kind === 'text').map((p) => p.text!);

/** runs the pets and the flock together, `ms` long */
function live(flock: Flock, members: Member[], ms: number, each?: (t: number) => void): void {
  for (let t = 0; t < ms; t += 16) {
    flock.step(16, members);
    for (const m of members) m.pet.update(16);
    each?.(t);
  }
}

/** puts a pet at a place by dragging it there (the engine has no other way to place one) */
function place(m: Member, x: number): void {
  const v = m.pet.view;
  const from = { x: v.hitbox.x + v.hitbox.w / 2, y: v.hitbox.y + v.hitbox.h / 2 };
  m.pet.pointerMove(from);
  m.pet.pointerDown(from);
  const to = { x: from.x + (x - v.x), y: from.y };
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    m.pet.pointerMove({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y });
    m.pet.update(16);
  }
  for (let i = 0; i < 20; i++) m.pet.update(16);
  m.pet.pointerUp(to);
  // the mouse is somewhere else from now on
  m.pet.pointerLeave();
  for (let i = 0; i < 80; i++) m.pet.update(16);
}

const LINES_A = parseLines({
  meet: [{ text: 'HI B', with: ['b'] }, { text: 'HI C', with: ['c'] }, 'HI ANYONE'],
  reply: [{ text: 'BACK TO B', with: 'b' }, 'BACK'],
});
const LINES_B = parseLines({ meet: ['B GREETS'], reply: [{ text: 'B ANSWERS A', with: ['a'] }, 'B ANSWERS'] });

describe('lines for a friend', () => {
  it('reads who a line is for, as one id or a list', () => {
    const l = parseLineList([{ text: 'x', with: 'chiikawa' }, { text: 'y', with: ['usagi', 'rakko', 'usagi', 5, '../x', ''] }, { text: 'z', with: [] }, { text: 'w', with: 7 }, 'plain']);
    expect(l.map((x) => x.with)).toEqual([['chiikawa'], ['usagi', 'rakko'], undefined, undefined, undefined]);
    expect(Object.keys(l[4]!)).not.toContain('with');
  });

  it('keeps meet and reply among the situations a skin can have lines for', () => {
    const lines = parseLines({ meet: ['a'], reply: [{ text: 'b', with: ['x'] }], elsewhere: ['c'] });
    expect(Object.keys(lines)).toEqual(['meet', 'reply']);
  });

  it('prefers the lines made for the friend, then the ones for anyone, and ignores lines for others', () => {
    const pool = parseLineList(['common', { text: 'for b', with: ['b'] }, { text: 'for c', with: ['c'] }]);
    expect(forPartner(pool, 'b').map((l) => l.text)).toEqual(['for b']);
    expect(forPartner(pool, 'c').map((l) => l.text)).toEqual(['for c']);
    expect(forPartner(pool, 'd').map((l) => l.text)).toEqual(['common']);
    expect(forPartner(pool).map((l) => l.text)).toEqual(['common']);
    expect(forPartner(parseLineList([{ text: 'only b', with: ['b'] }]), 'd')).toEqual([]);
    expect(forPartner(undefined, 'b')).toEqual([]);
  });

  it('is what the speaker says to a friend; a line for one friend is never said to another or to nobody', () => {
    const sp = new Speaker(() => 0);
    sp.setLines(LINES_A);
    expect(sp.pick('meet', 1000, false, 'b')!.text).toBe('HI B');
    expect(sp.pick('meet', 30_000, false, 'c')!.text).toBe('HI C');
    expect(sp.pick('meet', 60_000, false, 'zed')!.text).toBe('HI ANYONE');
    expect(sp.pick('meet', 90_000, false)!.text).toBe('HI ANYONE');
    const only = new Speaker(() => 0);
    only.setLines(parseLines({ meet: [{ text: 'just for b', with: ['b'] }] }));
    expect(only.pick('meet', 1000, false, 'c')).toBeNull();
    expect(only.pick('meet', 30_000, false)).toBeNull();
  });
});

describe('a friend to go and see', () => {
  it('changes nothing for a pet with no friends: the same walk, the same random numbers', () => {
    const lone = new Pet({ world: { width: W, height: H }, rng: mulberry32(5), mode: 'wander' });
    const told = new Pet({ world: { width: W, height: H }, rng: mulberry32(5), mode: 'wander' });
    told.setPeers([]);
    const trail = (p: Pet) => {
      const out: number[] = [];
      for (let t = 0; t < 40_000; t += 16) {
        p.update(16);
        out.push(Math.round(p.view.x));
      }
      return out;
    };
    expect(trail(told)).toEqual(trail(lone));
  });

  it('walks over to stand beside a friend now and then', () => {
    const a = pet('a', {}, { rng: mulberry32(3) });
    const b = pet('b', {});
    place(a, 150);
    place(b, 1450);
    const flock = new Flock(mulberry32(1));
    let closest = Infinity;
    live(flock, [a, b], 120_000, () => {
      closest = Math.min(closest, Math.abs(a.pet.view.x - b.pet.view.x));
    });
    expect(closest).toBeLessThan(MEET_DISTANCE * 1.2);
  });

  it('keeps every pet on the screen', () => {
    const members = ['a', 'b', 'c'].map((id) => pet(id, {}, { rng: mulberry32(id.charCodeAt(0)) }));
    const flock = new Flock(mulberry32(9));
    live(flock, members, 60_000, () => {
      for (const m of members) {
        const hb = m.pet.view.hitbox;
        expect(hb.x).toBeGreaterThanOrEqual(-1e-6);
        expect(hb.x + hb.w).toBeLessThanOrEqual(W + 1e-6);
      }
    });
  });
});

describe('Flock', () => {
  const two = () => {
    const a = pet('a', LINES_A);
    const b = pet('b', LINES_B);
    place(a, 700);
    place(b, 700 + 120);
    return [a, b] as const;
  };

  it('has two pets that come close greet each other: the first with its words for that friend, the second answering a moment later', () => {
    const [a, b] = two();
    const flock = new Flock(mulberry32(2));
    const said: Record<string, string[]> = { a: [], b: [] };
    let firstReply = Infinity;
    let firstGreeting = Infinity;
    live(flock, [a, b], 4000, (t) => {
      for (const w of words(a)) if (!said.a!.includes(w)) said.a!.push(w);
      for (const w of words(b)) if (!said.b!.includes(w)) said.b!.push(w);
      if (words(a).concat(words(b)).some((w) => /HI|GREETS/.test(w)) && firstGreeting === Infinity) firstGreeting = t;
      if (words(a).concat(words(b)).some((w) => /BACK|ANSWER/.test(w)) && firstReply === Infinity) firstReply = t;
    });
    const all = [...said.a!, ...said.b!];
    expect(all.some((w) => w === 'HI B' || w === 'B GREETS')).toBe(true);
    expect(all.some((w) => w === 'BACK TO B' || w === 'B ANSWERS A')).toBe(true);
    // never the words for anyone when there are words for this friend
    expect(all).not.toContain('HI ANYONE');
    expect(all).not.toContain('HI C');
    expect(firstReply - firstGreeting).toBeGreaterThanOrEqual(900);
    expect(firstReply - firstGreeting).toBeLessThan(2500);
  });

  it('turns both to face each other and stops them', () => {
    const [a, b] = two();
    const flock = new Flock(mulberry32(2));
    live(flock, [a, b], 600);
    expect(a.pet.view.facing).toBe(1);
    expect(b.pet.view.facing).toBe(-1);
    expect(['idle', 'sit']).toContain(a.pet.view.state);
    expect(['idle', 'sit']).toContain(b.pet.view.state);
  });

  it('lets the one that walked up do the greeting', () => {
    for (const mover of ['a', 'b']) {
      const a = pet('a', parseLines({ meet: ['A GREETS'], reply: ['A REPLIES'] }));
      const b = pet('b', parseLines({ meet: ['B GREETS'], reply: ['B REPLIES'] }));
      place(a, 600);
      place(b, 1000);
      const walker = mover === 'a' ? a : b;
      const still = mover === 'a' ? b : a;
      // the other one is busy standing and the walker walks towards it
      still.pet.setCursor({ x: -5000, y: -5000 });
      const peer = { id: still.id, x: still.pet.view.x, y: still.pet.view.y, state: still.pet.view.state };
      walker.pet.setPeers([peer]);
      const seen = new Set<string>();
      const flock = new Flock(mulberry32(4));
      live(flock, [a, b], 90_000, () => {
        for (const w of [...words(a), ...words(b)]) seen.add(w);
      });
      expect(seen.has('A GREETS') || seen.has('B GREETS')).toBe(true);
    }
  });

  it('does not greet again until a while has passed', () => {
    const [a, b] = two();
    const flock = new Flock(mulberry32(2));
    let greetings = 0;
    let was = false;
    live(flock, [a, b], 40_000, () => {
      const now = words(a).concat(words(b)).some((w) => /HI B|B GREETS/.test(w));
      if (now && !was) greetings++;
      was = now;
    });
    expect(greetings).toBe(1);
    // after the cooldown, if they are still near each other, they do
    expect(PAIR_COOLDOWN_MS).toBeGreaterThan(40_000);
  });

  it('does not greet when the friends are far apart', () => {
    const a = pet('a', LINES_A);
    const b = pet('b', LINES_B);
    place(a, 100);
    place(b, 1500);
    const flock = new Flock(mulberry32(2));
    const saw: string[] = [];
    // keep them apart: no peers to visit
    live(flock, [a, b], 3000, () => saw.push(...words(a), ...words(b)));
    expect(saw.filter((w) => /HI|GREETS|BACK|ANSWER/.test(w))).toEqual([]);
  });

  it('leaves out a pet that is asleep, picked up or busy', () => {
    const a = pet('a', LINES_A);
    const b = pet('b', LINES_B, { config: { roam: 'floor', sleepAfterMs: 500 } });
    place(a, 700);
    place(b, 800);
    b.pet.setCursor({ x: 10, y: 10 });
    for (let i = 0; i < 1500 && b.pet.view.state !== 'sleep'; i++) b.pet.update(16);
    expect(b.pet.view.state).toBe('sleep');
    const flock = new Flock(mulberry32(2));
    const saw: string[] = [];
    // the flock and a only: b is asleep and stays that way
    for (let t = 0; t < 2000; t += 16) {
      flock.step(16, [a, b]);
      a.pet.update(16);
      saw.push(...words(a), ...words(b));
    }
    expect(saw).toEqual([]);
    expect(b.pet.view.state).toBe('sleep');
  });

  it('forgets the replies of a pet that has left', () => {
    const [a, b] = two();
    const flock = new Flock(mulberry32(2));
    flock.step(16, [a, b]);
    expect(() => {
      for (let t = 0; t < 3000; t += 16) {
        flock.step(16, [a]);
        a.pet.update(16);
      }
    }).not.toThrow();
    expect(words(b).concat(words(a)).filter((w) => /BACK|ANSWER/.test(w))).toEqual([]);
  });

  it('is told nothing about friends when a pet is alone', () => {
    const a = pet('a', LINES_A);
    const flock = new Flock(mulberry32(2));
    expect(() => live(flock, [a], 2000)).not.toThrow();
  });
});

describe('Flock, with stand-ins for the pets', () => {
  type Call = { who: string; partner: string; role: string };
  const calls: Call[] = [];
  interface Fake {
    view: { x: number; y: number; scale: number; state: string };
    meetable: boolean;
    peers: string[];
    setPeers(p: { id: string }[]): void;
    meet(partner: string, at: { x: number; y: number }, role: string): void;
  }
  const fake = (id: string, x: number, state = 'idle', scale = 1): Member & { fake: Fake } => {
    const f: Fake = {
      view: { x, y: 500, scale, state },
      meetable: true,
      peers: [],
      setPeers(p) {
        f.peers = p.map((q) => q.id);
      },
      meet(partner, _at, role) {
        calls.push({ who: id, partner, role });
      },
    };
    return { id, pet: f as unknown as Pet, fake: f };
  };
  const run = (flock: Flock, members: Member[], ms: number): void => {
    for (let t = 0; t < ms; t += 16) flock.step(16, members);
  };
  const reset = () => void (calls.length = 0);

  it('tells every pet who else is there', () => {
    reset();
    const [a, b, c] = [fake('a', 0), fake('b', 800), fake('c', 1500)];
    new Flock(() => 0.9).step(16, [a, b, c]);
    expect([a.fake.peers, b.fake.peers, c.fake.peers]).toEqual([['b', 'c'], ['a', 'c'], ['a', 'b']]);
    new Flock(() => 0.9).step(16, [a]);
    expect(a.fake.peers).toEqual([]);
  });

  it('has the one that walked up do the greeting, and the other only listen and then answer', () => {
    for (const [moverIsA] of [[true], [false]] as const) {
      reset();
      const a = fake('a', 700, moverIsA ? 'walk' : 'idle');
      const b = fake('b', 800, moverIsA ? 'idle' : 'run');
      run(new Flock(() => 0.99), [a, b], 2000);
      const greeter = moverIsA ? 'a' : 'b';
      const other = moverIsA ? 'b' : 'a';
      expect(calls).toEqual([
        { who: greeter, partner: other, role: 'greet' },
        { who: other, partner: greeter, role: 'listen' },
        { who: other, partner: greeter, role: 'reply' },
      ]);
    }
  });

  it('leaves it to chance when neither (or both) walked up', () => {
    for (const [roll, first] of [[0.1, 'a'], [0.9, 'b']] as const) {
      reset();
      const a = fake('a', 700);
      const b = fake('b', 800);
      run(new Flock(() => roll), [a, b], 100);
      expect(calls[0]).toMatchObject({ who: first, role: 'greet' });
    }
  });

  it('answers after about a second, and not at all if the pet is busy by then', () => {
    reset();
    const a = fake('a', 700);
    const b = fake('b', 800);
    const flock = new Flock(() => 0.5);
    flock.step(16, [a, b]);
    run(flock, [a, b], 1000);
    expect(calls.map((c) => c.role)).toEqual(['greet', 'listen']);
    run(flock, [a, b], 800);
    expect(calls.map((c) => c.role)).toEqual(['greet', 'listen', 'reply']);

    reset();
    const c = fake('c', 700);
    const d = fake('d', 800);
    const other = new Flock(() => 0.5);
    other.step(16, [c, d]);
    // the one that was greeted is picked up before it can answer
    c.fake.meetable = false;
    d.fake.meetable = false;
    run(other, [c, d], 3000);
    expect(calls.map((x) => x.role)).toEqual(['greet', 'listen']);
  });

  it('greets again only after the cooldown', () => {
    reset();
    const a = fake('a', 700);
    const b = fake('b', 800);
    const flock = new Flock(() => 0.5);
    run(flock, [a, b], PAIR_COOLDOWN_MS - 2000);
    expect(calls.filter((c) => c.role === 'greet')).toHaveLength(1);
    run(flock, [a, b], 4000);
    expect(calls.filter((c) => c.role === 'greet')).toHaveLength(2);
  });

  it('notices friends at a distance that grows with the size of the pets', () => {
    reset();
    const a = fake('a', 700);
    const b = fake('b', 700 + MEET_DISTANCE + 30);
    run(new Flock(() => 0.5), [a, b], 200);
    expect(calls).toEqual([]);
    const c = fake('c', 700, 'idle', 2);
    const d = fake('d', 700 + MEET_DISTANCE + 30, 'idle', 2);
    run(new Flock(() => 0.5), [c, d], 200);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('does not greet when one of them is not free', () => {
    reset();
    const a = fake('a', 700);
    const b = fake('b', 800);
    b.fake.meetable = false;
    run(new Flock(() => 0.5), [a, b], 500);
    expect(calls).toEqual([]);
  });

  it('keeps a cooldown for each pair: three friends standing together all greet each other', () => {
    reset();
    const [a, b, c] = [fake('a', 700), fake('b', 780), fake('c', 860)];
    run(new Flock(() => 0.5), [a, b, c], 200);
    const pairs = new Set(calls.filter((x) => x.role === 'greet').map((x) => [x.who, x.partner].sort().join('')));
    expect([...pairs].sort()).toEqual(['ab', 'ac', 'bc']);
  });
});
