import { describe, expect, it } from 'vitest';
import { Pet, mulberry32, type Platform } from '../src/engine';

const W = 1280;
const H = 1024;

describe.each(['floor', 'free'] as const)('fuzz: windows coming and going (%s)', (roam) => {
  it('never leaves a pet with nowhere to be, in the air where it should not be, or off the screen', () => {
    const problems: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = mulberry32(seed * 977);
      const pet = new Pet({ world: { width: W, height: H }, rng: mulberry32(seed), mode: 'wander', config: { roam, sleepAfterMs: 20_000 } });
      let platforms: Platform[] = [];
      const randomWindow = (i: number): Platform => {
        const x0 = Math.floor(rnd() * 900);
        return { id: `w${i}`, x0, x1: x0 + 150 + Math.floor(rnd() * 500), y: 300 + Math.floor(rnd() * 650), ax: x0 };
      };
      for (let t = 0; t < 150_000; t += 16) {
        // now and then the windows change: new ones, moved ones, gone ones
        if (t % 400 === 0 && rnd() < 0.25) {
          const r = rnd();
          if (r < 0.3 || platforms.length === 0) platforms = [...platforms, randomWindow(Math.floor(t / 400))].slice(-4);
          else if (r < 0.6) platforms = platforms.filter((_, i) => i !== Math.floor(rnd() * platforms.length));
          else {
            const i = Math.floor(rnd() * platforms.length);
            const p = platforms[i]!;
            const dx = Math.floor((rnd() - 0.5) * 200);
            const dy = Math.floor((rnd() - 0.5) * 120);
            platforms = platforms.map((q, j) => (j === i ? { ...q, x0: q.x0 + dx, x1: q.x1 + dx, ax: q.ax + dx, y: p.y + dy } : q));
          }
          pet.setPlatforms(platforms);
        }
        // and now and then somebody picks the pet up and puts it down somewhere
        if (t % 2000 === 0 && rnd() < 0.2) {
          const h = pet.view.hitbox;
          const from = { x: h.x + h.w / 2, y: h.y + h.h / 2 };
          const to = { x: Math.max(60, Math.min(W - 60, from.x + (rnd() - 0.5) * 900)), y: 100 + rnd() * 700 };
          pet.pointerMove(from);
          pet.pointerDown(from);
          for (let i = 1; i <= 10; i++) {
            pet.pointerMove({ x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 });
            pet.update(16);
          }
          for (let i = 0; i < 8; i++) pet.update(16);
          pet.pointerUp(to);
          pet.pointerLeave();
        }
        pet.update(16);
        const v = pet.view;
        if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) problems.push(`seed ${seed}: not finite at ${t}`);
        if (v.y > H + 0.01) problems.push(`seed ${seed}: below the floor (${v.y}) at ${t}`);
      }
      // all windows go away: a pet that walks along floors must come to rest on the floor (one that may float stays wherever it is)
      platforms = [];
      pet.setPlatforms([]);
      for (let t = 0; t < 8000; t += 16) pet.update(16);
      if (pet.view.state === 'fall') problems.push(`seed ${seed}: still falling`);
      if (roam === 'floor' && Math.abs(pet.view.y - H) > 0.01) problems.push(`seed ${seed}: stuck at y=${pet.view.y} state=${pet.view.state} x=${pet.view.x}`);
      if (pet.perched !== null) problems.push(`seed ${seed}: still on a window that is gone`);
    }
    expect(problems).toEqual([]);
  }, 120_000);
});
