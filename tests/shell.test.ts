import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSkinId } from '../src/shared/ids';
import { sanitizeSettings } from '../src/shared/sanitize';
import { DEFAULT_SETTINGS } from '../src/shared/types';
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
    const s = sanitizeSettings({ mode: 'attach', roam: 'floor', skin: 'my-skin', scale: 99, clickThrough: true, autoStart: true });
    expect(s).toEqual({ mode: 'attach', roam: 'floor', skin: 'my-skin', scale: 4, clickThrough: true, autoStart: true });
    expect(sanitizeSettings({ scale: 0.01 }).scale).toBe(0.25);
  });
});
