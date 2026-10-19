import { describe, expect, it } from 'vitest';
import type { PetState } from '../src/engine';
import { resolvePose } from '../src/renderer/poses';

const has = (...names: string[]) => new Set(names);

describe('resolvePose', () => {
  it('uses the exact pose when the skin has it', () => {
    expect(resolvePose('happy', has('idle', 'happy'))).toBe('happy');
    expect(resolvePose('walk', has('idle', 'walk'))).toBe('walk');
  });

  it('falls back through related poses and finally idle', () => {
    expect(resolvePose('walk', has('idle'))).toBe('idle');
    expect(resolvePose('run', has('idle', 'walk'))).toBe('walk');
    expect(resolvePose('held', has('idle', 'surprised'))).toBe('surprised');
    expect(resolvePose('fall', has('idle', 'surprised'))).toBe('surprised');
    expect(resolvePose('sleep', has('idle', 'happy'))).toBe('idle');
  });

  it('lets the manifest override a state, but only to a pose that exists', () => {
    expect(resolvePose('sit', has('idle', 'sleep'), { sit: 'sleep' })).toBe('sleep');
    expect(resolvePose('sit', has('idle'), { sit: 'sleep' })).toBe('idle');
  });

  it('always resolves every state when idle exists', () => {
    const states: PetState[] = ['idle', 'walk', 'run', 'sit', 'sleep', 'held', 'fall', 'land', 'surprised', 'happy'];
    for (const s of states) expect(resolvePose(s, has('idle'))).toBe('idle');
  });
});
