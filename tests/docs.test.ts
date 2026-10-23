import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { headline, parseChangelog } from '../src/shared/changelog';

const ROOT = path.resolve(__dirname, '..');

/** The documents people read: they, and the notices built from them, are written in plain sentences. */
const DOCS = ['README.md', 'CHANGELOG.md', 'docs/PLAN.md', 'docs/GUIDE.md', 'docs/SKINS.md', 'docs/DEVELOPMENT.md', 'CLAUDE.md'];

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

/** The README tells only what the app can do and what changed last; the rest lives in docs/. The last part is copied from CHANGELOG.md. */
describe('README.md, latest update', () => {
  const version = (JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
  const entry = parseChangelog(readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')).find((e) => e.version === version);
  const lines = readFileSync(path.join(ROOT, 'README.md'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === '## 최신 업데이트');
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  const section = start < 0 ? [] : lines.slice(start + 1, end < 0 ? undefined : end);

  it('has a "최신 업데이트" section', () => {
    expect(start).toBeGreaterThanOrEqual(0);
  });

  it('is about the version in package.json (change it when the version goes up)', () => {
    expect(section.find((l) => l.startsWith('### '))?.slice(4).trim()).toBe(version);
  });

  it('lists the first sentence of every change of that version in CHANGELOG.md, in the same order', () => {
    const listed = section.filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
    expect(listed).toEqual((entry?.changes ?? []).map(headline));
  });
});
