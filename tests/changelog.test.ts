import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { announcement, compareVersions, headline, parseChangelog, summarize } from '../src/shared/changelog';

const ROOT = path.resolve(__dirname, '..');
const SAMPLE = `# 바뀐 점

머리말에 있는 - 줄은 어느 버전의 것도 아니에요.
- 머리말 줄

## 0.3.2

- 펫 부르기 — 트레이 메뉴나 단축키로 불러요
- 잠깐 숨기기

## 0.3.1
* 앱이 스스로 업데이트

## 설명
- 이 줄은 버전의 것이 아니에요

## v0.3.0

- 말하는 캐릭터 — 자세히
`;

describe('parseChangelog', () => {
  it('reads a heading per version and the bullets under it', () => {
    expect(parseChangelog(SAMPLE)).toEqual([
      { version: '0.3.2', changes: ['펫 부르기 — 트레이 메뉴나 단축키로 불러요', '잠깐 숨기기'] },
      { version: '0.3.1', changes: ['앱이 스스로 업데이트'] },
      { version: '0.3.0', changes: ['말하는 캐릭터 — 자세히'] },
    ]);
  });

  it('copes with windows line ends and with nothing at all', () => {
    expect(parseChangelog('## 1.0.0\r\n- 하나\r\n')).toEqual([{ version: '1.0.0', changes: ['하나'] }]);
    expect(parseChangelog('')).toEqual([]);
    expect(parseChangelog('아무 말이나')).toEqual([]);
  });
});

describe('compareVersions', () => {
  it('compares number by number, not letter by letter', () => {
    expect(compareVersions('0.3.2', '0.3.1')).toBeGreaterThan(0);
    expect(compareVersions('0.3.1', '0.3.2')).toBeLessThan(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.3.2', '0.3.2')).toBe(0);
  });
});

describe('announcement', () => {
  const entries = parseChangelog(SAMPLE);
  const versions = (o: Parameters<typeof announcement>[1]) => announcement(entries, o).map((e) => e.version);

  it('tells the changes since the version last seen, newest first', () => {
    expect(versions({ current: '0.3.2', seen: '0.3.0', returning: true })).toEqual(['0.3.2', '0.3.1']);
    expect(versions({ current: '0.3.2', seen: '0.3.1', returning: true })).toEqual(['0.3.2']);
  });

  it('tells nothing when the version has not changed, or has gone back', () => {
    expect(versions({ current: '0.3.2', seen: '0.3.2', returning: true })).toEqual([]);
    expect(versions({ current: '0.3.1', seen: '0.3.2', returning: true })).toEqual([]);
  });

  it('does not tell what is newer than the app itself', () => {
    expect(versions({ current: '0.3.1', seen: '0.3.0', returning: true })).toEqual(['0.3.1']);
  });

  it('on a first run says nothing; on an app that ran before it was recorded, only the current version', () => {
    expect(versions({ current: '0.3.2', seen: null, returning: false })).toEqual([]);
    expect(versions({ current: '0.3.2', seen: null, returning: true })).toEqual(['0.3.2']);
  });

  it('has nothing to tell about a version nobody wrote anything for', () => {
    expect(versions({ current: '0.4.0', seen: '0.3.2', returning: true })).toEqual([]);
    expect(versions({ current: '0.4.0', seen: null, returning: true })).toEqual([]);
  });
});

describe('summarize', () => {
  it('lists the headlines, newest first', () => {
    const entries = parseChangelog(SAMPLE).slice(0, 2);
    expect(headline('펫 부르기 — 트레이 메뉴나 단축키로 불러요')).toBe('펫 부르기');
    expect(summarize(entries)).toBe('· 펫 부르기\n· 잠깐 숨기기\n· 앱이 스스로 업데이트');
  });

  it('says how many more there are instead of running long', () => {
    const many = [{ version: '1.0.0', changes: ['가', '나', '다', '라', '마', '바'] }];
    expect(summarize(many, 4)).toBe('· 가\n· 나\n· 다\n… 외 3가지');
    expect(summarize([{ version: '1.0.0', changes: ['가', '나', '다', '라'] }], 4)).toBe('· 가\n· 나\n· 다\n· 라');
  });
});

describe('CHANGELOG.md of this repository', () => {
  const text = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const entries = parseChangelog(text);
  const version = (JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

  it('says what the version in package.json changed (write it before bumping the version)', () => {
    const entry = entries.find((e) => e.version === version);
    expect(entry, `CHANGELOG.md has no "## ${version}" entry`).toBeTruthy();
    expect(entry!.changes.length).toBeGreaterThan(0);
  });

  it('lists the versions newest first, each once, with a headline for every change', () => {
    const versions = entries.map((e) => e.version);
    expect(versions).toEqual([...new Set(versions)]);
    expect([...versions].sort((a, b) => compareVersions(b, a))).toEqual(versions);
    for (const e of entries) for (const c of e.changes) expect(headline(c).length, `${e.version}: ${c}`).toBeGreaterThan(0);
  });

  it('keeps the headlines short enough for a notification', () => {
    const entry = entries.find((e) => e.version === version)!;
    for (const c of entry.changes) expect([...headline(c)].length, c).toBeLessThanOrEqual(24);
  });
});

describe('scripts/release-notes.mjs', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'release-notes.mjs'), ...args], { encoding: 'utf8' });

  it('prints the changes of a version as the body of its release', () => {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'release-notes.mjs'), '0.3.1'], { encoding: 'utf8' });
    expect(out).toContain('## 바뀐 점');
    expect(out).toContain('- 앱이 스스로 업데이트');
    expect(out).not.toContain('말하는 캐릭터');
  });

  it('accepts a tag name too', () => {
    expect(run('v0.3.1').stdout).toContain('- 앱이 스스로 업데이트');
  });

  it('refuses a version with nothing written about it, so a release cannot go out empty', () => {
    const r = run('9.9.9');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('9.9.9');
    expect(run('not-a-version').status).toBe(2);
  });
});
