import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

/** The documents people read: they, and the notices built from them, are written in plain sentences. */
const DOCS = ['README.md', 'CHANGELOG.md', 'docs/PLAN.md', 'CLAUDE.md'];

/** Dashes, arrows, ellipsis characters and curly quotes: the marks that make a text look machine-written. */
const FANCY = /[‐-―←-⇿…‘’“”·]/u;

/** A sentence that ends in the spoken style ("해요.", "이에요.", "돼요?") instead of "다.". */
const SPOKEN_END = /(?:어|아|여|해|돼|와|워|예|에|네|죠|까|나)요[.!?](?=\s|\||$)/;

describe.each(DOCS)('%s', (file) => {
  const text = readFileSync(path.join(ROOT, file), 'utf8');

  it('has no dashes, arrows, ellipsis characters, curly quotes or middle dots', () => {
    const found = text.split('\n').flatMap((line, i) => (FANCY.test(line) ? [`${i + 1}: ${line.slice(0, 80)}`] : []));
    expect(found).toEqual([]);
  });

  it('ends its sentences with "다.", not in the spoken style', () => {
    const found = text.split('\n').flatMap((line, i) => (SPOKEN_END.test(line) ? [`${i + 1}: ${line.slice(0, 80)}`] : []));
    expect(found).toEqual([]);
  });
});
