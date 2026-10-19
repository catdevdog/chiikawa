import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSkinId } from '../src/shared/ids';
import { sanitizeSettings } from '../src/shared/sanitize';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import { parsePointer, parseSkinReport } from '../src/shared/validate';
import { safeJoin } from '../src/shell/safe-path';

describe('safeJoin', () => {
  const base = path.resolve('/srv/skins');

  it('joins normal relative paths', () => {
    expect(safeJoin(base, 'default/idle.svg')).toBe(path.join(base, 'default', 'idle.svg'));
  });

  it('never returns a path outside the base folder', () => {
    for (const rel of ['../etc/passwd', 'a/../../b', '../../..', '/../x', 'a/./../../x', '%2e%2e/x']) {
      const out = safeJoin(base, rel);
      expect(out === null || out === base || out.startsWith(base + path.sep)).toBe(true);
    }
  });

  it('rejects backslashes, drive letters and NUL bytes', () => {
    expect(safeJoin(base, 'a\\..\\..\\x')).toBeNull();
    expect(safeJoin(base, 'C:/Windows/system.ini')).toBeNull();
    expect(safeJoin(base, 'a\0b')).toBeNull();
  });
});

describe('isSkinId', () => {
  it('accepts folder-like ids', () => {
    for (const id of ['default', 'my-skin_1', 'v1.2', '.hidden']) expect(isSkinId(id)).toBe(true);
  });

  it('rejects empty, dot-only and path-like ids', () => {
    for (const id of ['', '.', '..', '...', '../x', 'a/b', 'a b', 'a\\b']) expect(isSkinId(id)).toBe(false);
    expect(isSkinId(42)).toBe(false);
    expect(isSkinId(undefined)).toBe(false);
  });
});

describe('sanitizeSettings', () => {
  it('returns defaults for garbage', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('x')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ mode: 'fly', roam: 3, skin: '../x', scale: 'big', clickThrough: 'yes' })).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and clamps the scale', () => {
    const s = sanitizeSettings({ mode: 'attach', roam: 'floor', skin: 'my-skin', scale: 99, clickThrough: true, autoStart: true, monitor: '2528732444', speech: 'reactions' });
    expect(s).toEqual({ mode: 'attach', roam: 'floor', skin: 'my-skin', scale: 4, clickThrough: true, autoStart: true, monitor: '2528732444', speech: 'reactions' });
    expect(sanitizeSettings({ scale: 0.01 }).scale).toBe(0.25);
  });

  it('accepts the three speech levels and nothing else', () => {
    for (const speech of ['all', 'reactions', 'off']) expect(sanitizeSettings({ speech }).speech).toBe(speech);
    for (const speech of ['loud', '', 1, null, true]) expect(sanitizeSettings({ speech }).speech).toBe(DEFAULT_SETTINGS.speech);
  });

  it('accepts a monitor choice of all, primary or a numeric id and nothing else', () => {
    for (const monitor of ['all', 'primary', '1', '2528732444']) expect(sanitizeSettings({ monitor }).monitor).toBe(monitor);
    for (const monitor of ['', 'second', '-1', '1.5', '12345678901234567', 7, null, ['all']]) {
      expect(sanitizeSettings({ monitor }).monitor).toBe(DEFAULT_SETTINGS.monitor);
    }
  });
});

describe('what an overlay may report', () => {
  const report = { box: { w: 128, h: 140, anchorX: 0.5, anchorY: 0.94 }, hitbox: { x: 0.18, y: 0.22, w: 0.64, h: 0.72 } };

  it('accepts a skin report and keeps its numbers', () => {
    expect(parseSkinReport(report)).toEqual({ ...report, lines: {} });
  });

  it('pulls numbers that are out of range back into it', () => {
    const g = parseSkinReport({ box: { w: 99999, h: 1, anchorX: -3, anchorY: 4 }, hitbox: { x: 2, y: -1, w: 0, h: 9 } })!;
    expect(g.box).toEqual({ w: 1024, h: 16, anchorX: 0, anchorY: 1 });
    expect(g.hitbox).toEqual({ x: 1, y: 0, w: 0.05, h: 1 });
  });

  it('refuses anything that is not numbers', () => {
    for (const bad of [null, 5, 'x', {}, { box: {}, hitbox: {} }, { ...report, box: { ...report.box, w: NaN } }, { ...report, hitbox: { ...report.hitbox, x: '0' } }, { box: report.box }]) {
      expect(parseSkinReport(bad)).toBeNull();
    }
  });

  it('carries the lines of the skin, cleaned up', () => {
    const g = parseSkinReport({ ...report, lines: { click: ['하아?', '', 7, { text: '세 번이나… 놀자는 거야!?' }], dance: ['x'] } })!;
    expect(g.lines).toEqual({
      click: [
        { text: '하아?', style: 'float' },
        { text: '세 번이나… 놀자는 거야!?', style: 'hold' },
      ],
    });
  });

  it('bad lines do not spoil an otherwise good report', () => {
    for (const lines of ['click', 5, null, [], { click: 'nope' }]) expect(parseSkinReport({ ...report, lines })!.lines).toEqual({});
  });

  it('accepts a button going down or up at a finite point', () => {
    expect(parsePointer({ kind: 'down', x: 10.5, y: -3 })).toEqual({ kind: 'down', x: 10.5, y: -3 });
    expect(parsePointer({ kind: 'up', x: 0, y: 0, extra: 1 })).toEqual({ kind: 'up', x: 0, y: 0 });
  });

  it('refuses any other pointer message', () => {
    for (const bad of [null, 'down', {}, { kind: 'move', x: 1, y: 1 }, { kind: 'down', x: Infinity, y: 1 }, { kind: 'down', x: 1 }, { kind: 'up', x: '1', y: 2 }]) {
      expect(parsePointer(bad)).toBeNull();
    }
  });
});
