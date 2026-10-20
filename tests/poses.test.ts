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

  it('uses the picture for hiding when the skin has one, and the ordinary picture when it has not', () => {
    expect(resolvePose('peek', has('idle', 'peek'))).toBe('peek');
    expect(resolvePose('peek', has('idle', 'sleep'))).toBe('idle');
    // a skin may also say which of its pictures is the one
    expect(resolvePose('peek', has('idle', 'sleep'), { peek: 'sleep' })).toBe('sleep');
  });

  it('uses the picture for looking over the edge of a window when the skin has one, and the ordinary picture when it has not', () => {
    expect(resolvePose('hang', has('idle', 'hang'))).toBe('hang');
    expect(resolvePose('hang', has('idle', 'peek'))).toBe('idle');
    expect(resolvePose('hang', has('idle', 'sleep'), { hang: 'sleep' })).toBe('sleep');
  });

  it('always resolves every state when idle exists', () => {
    const states: PetState[] = ['idle', 'walk', 'run', 'sit', 'sleep', 'held', 'fall', 'land', 'surprised', 'happy', 'peek', 'hang'];
    for (const s of states) expect(resolvePose(s, has('idle'))).toBe('idle');
  });
});
