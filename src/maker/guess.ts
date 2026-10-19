import type { PoseState } from '../engine/types';

// ASCII keywords must not sit inside a longer word (letters on both sides); `_`, `-`, digits and dots are fine.
const word = (...words: string[]): string => words.map((w) => `(?<![a-z])${w}(?![a-z])`).join('|');

const RULES: [PoseState, RegExp][] = [
  ['sleep', new RegExp(`${word('sleep', 'sleeping', 'zzz', 'nap', 'asleep')}|잠|수면|寝|ねむ|ねる`, 'i')],
  ['surprised', new RegExp(`${word('surprised', 'surprise', 'shock', 'shocked', 'startled', 'wow')}|놀|びっくり|驚`, 'i')],
  ['happy', new RegExp(`${word('happy', 'joy', 'smile', 'glad', 'cheer', 'dance', 'love')}|기쁨|기뻐|좋아|행복|웃|嬉|うれ|やった`, 'i')],
  ['held', new RegExp(`${word('held', 'hold', 'drag', 'hang', 'hanging', 'carry', 'grab')}|들려|들기|잡|매달|持|つかま`, 'i')],
  ['fall', new RegExp(`${word('fall', 'falling', 'drop')}|떨어|落`, 'i')],
  ['land', new RegExp(`${word('land', 'landing')}|착지|着地`, 'i')],
  ['run', new RegExp(`${word('run', 'running', 'dash')}|달리|뛰|走|はし`, 'i')],
  ['walk', new RegExp(`${word('walk', 'walking', 'step')}|걷|歩|あるく`, 'i')],
  ['sit', new RegExp(`${word('sit', 'sitting', 'rest')}|앉|座|すわ`, 'i')],
  ['idle', new RegExp(`${word('idle', 'stand', 'standing', 'default', 'normal', 'basic', 'base')}|기본|대기|通常|待機`, 'i')],
];

/** Guesses which pose an image is for from its file name, or null when nothing matches. */
export function guessPose(filename: string): PoseState | null {
  const name = filename.replace(/\.[^.]+$/, '');
  for (const [pose, re] of RULES) if (re.test(name)) return pose;
  return null;
}

/** A folder-safe skin id from a display name; empty when the name has no ASCII letters or digits. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
