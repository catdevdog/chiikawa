import type { PetState } from '../engine/types';

/** Which skin pose to try for each engine state, most specific first. `idle` is mandatory in every skin. */
const FALLBACKS: Record<PetState, string[]> = {
  idle: ['idle'],
  walk: ['walk', 'idle'],
  run: ['run', 'walk', 'idle'],
  sit: ['sit', 'idle'],
  sleep: ['sleep', 'idle'],
  held: ['held', 'surprised', 'idle'],
  fall: ['fall', 'surprised', 'idle'],
  land: ['land', 'idle'],
  surprised: ['surprised', 'idle'],
  happy: ['happy', 'idle'],
};

/** `overrides` is the manifest's optional `states` map (state -> pose name). */
export function resolvePose(
  state: PetState,
  available: ReadonlySet<string>,
  overrides?: Partial<Record<PetState, string>>,
): string {
  const wanted = overrides?.[state];
  if (wanted && available.has(wanted)) return wanted;
  return FALLBACKS[state].find((p) => available.has(p)) ?? 'idle';
}
