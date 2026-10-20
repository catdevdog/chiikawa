import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSkinId } from '../src/shared/ids';
import { sanitizeSettings } from '../src/shared/sanitize';
import { skinTitle } from '../src/shared/skin-name';
import { sortSkins } from '../src/shared/skin-order';
import { DEFAULT_SETTINGS, MAX_FRIENDS } from '../src/shared/types';
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
    const s = sanitizeSettings({ mode: 'attach', roam: 'floor', skin: 'my-skin', scale: 99, clickThrough: true, autoStart: true, autoUpdate: false, monitor: '2528732444', speech: 'reactions', tricks: false, friends: ['usagi', 'rakko'], windows: false });
    expect(s).toEqual({ mode: 'attach', roam: 'floor', skin: 'my-skin', scale: 4, clickThrough: true, autoStart: true, autoUpdate: false, monitor: '2528732444', speech: 'reactions', tricks: false, friends: ['usagi', 'rakko'], windows: false });
    expect(sanitizeSettings({ scale: 0.01 }).scale).toBe(0.25);
  });

  it('checks for updates unless that was switched off', () => {
    expect(sanitizeSettings({}).autoUpdate).toBe(true);
    expect(sanitizeSettings({ autoUpdate: false }).autoUpdate).toBe(false);
    expect(sanitizeSettings({ autoUpdate: true }).autoUpdate).toBe(true);
    // anything else is not a choice; the default (on) applies
    for (const autoUpdate of ['no', 0, null, [], {}]) expect(sanitizeSettings({ autoUpdate }).autoUpdate).toBe(true);
  });

  it('does tricks on its own unless that was switched off', () => {
    expect(sanitizeSettings({}).tricks).toBe(true);
    expect(sanitizeSettings({ tricks: false }).tricks).toBe(false);
    for (const tricks of ['no', 0, null, [], {}]) expect(sanitizeSettings({ tricks }).tricks).toBe(true);
  });

  it('goes about the windows of other programs unless that was switched off', () => {
    expect(sanitizeSettings({}).windows).toBe(true);
    expect(sanitizeSettings({ windows: false }).windows).toBe(false);
    expect(sanitizeSettings({ windows: true }).windows).toBe(true);
    // anything else is not a choice; the default (on) applies
    for (const windows of ['no', 0, null, [], {}]) expect(sanitizeSettings({ windows }).windows).toBe(true);
    // the setting of the version that had this as an experiment (off unless asked for) is not carried over
    expect(sanitizeSettings({ perch: false }).windows).toBe(true);
  });

  it('keeps a list of friends that are skins, each once, without the main character, up to the limit', () => {
    expect(sanitizeSettings({}).friends).toEqual([]);
    expect(sanitizeSettings({ skin: 'usagi', friends: ['hachiware', 'usagi', 'chiikawa', 'hachiware', 'rakko'] }).friends).toEqual(['hachiware', 'chiikawa', 'rakko']);
    expect(sanitizeSettings({ friends: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }).friends).toHaveLength(MAX_FRIENDS);
    for (const friends of ['usagi', 5, null, {}, [7, '../x', '', null, ['usagi']]]) expect(sanitizeSettings({ friends }).friends, JSON.stringify(friends)).toEqual([]);
    // the list is judged against the main character that is kept, not the one that was asked for
    expect(sanitizeSettings({ skin: '../x', friends: ['usagi'] }).friends).toEqual([]);
    expect(sanitizeSettings({ skin: '../x', friends: [DEFAULT_SETTINGS.skin, 'rakko'] }).friends).toEqual(['rakko']);
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
  const report = { id: 'usagi', box: { w: 128, h: 140, anchorX: 0.5, anchorY: 0.94 }, hitbox: { x: 0.18, y: 0.22, w: 0.64, h: 0.72 } };

  it('accepts a skin report and keeps its numbers', () => {
    expect(parseSkinReport(report)).toEqual({ ...report, lines: {}, actions: {} });
  });

  it('carries how big the character looks, when that is a size, and leaves it out otherwise', () => {
    expect(parseSkinReport({ ...report, body: 104.5 })!.body).toBe(104.5);
    expect(parseSkinReport({ ...report, body: 1e9 })!.body).toBe(2048);
    expect(parseSkinReport({ ...report, body: 0.1 })!.body).toBe(4);
    for (const body of [undefined, null, 'big', Number.NaN]) expect(parseSkinReport({ ...report, body }), String(body)).not.toHaveProperty('body');
  });

  it('carries how the skin\'s picture for hiding meets the wall: all four numbers, or none', () => {
    const peek = { edge: 63, reach: 61, top: 84, bottom: 3 };
    expect(parseSkinReport({ ...report, peek })!.peek).toEqual(peek);
    // out-of-range numbers are pulled in
    expect(parseSkinReport({ ...report, peek: { ...peek, reach: 1e6 } })!.peek!.reach).toBe(2048);
    for (const bad of [undefined, null, 5, 'x', {}, { ...peek, edge: 'a' }, { edge: 1, reach: 1, top: 1 }, { ...peek, top: Number.NaN }]) {
      expect(parseSkinReport({ ...report, peek: bad }), JSON.stringify(bad)).not.toHaveProperty('peek');
    }
  });

  it('carries how the skin\'s picture for looking over the edge of a window stands on it: both numbers, or none', () => {
    const hang = { half: 61, top: 84 };
    expect(parseSkinReport({ ...report, hang })!.hang).toEqual(hang);
    expect(parseSkinReport({ ...report, hang: { ...hang, top: 1e6 } })!.hang!.top).toBe(2048);
    for (const bad of [undefined, null, 5, 'x', {}, { half: 1 }, { ...hang, half: 'a' }, { ...hang, top: Number.NaN }]) {
      expect(parseSkinReport({ ...report, hang: bad }), JSON.stringify(bad)).not.toHaveProperty('hang');
    }
  });

  it('says which skin it is about, and refuses a name that cannot be a skin', () => {
    expect(parseSkinReport({ ...report, id: 'my-skin_2' })!.id).toBe('my-skin_2');
    for (const id of [undefined, null, 5, '', '..', '../x', 'a/b', 'a\\b', ['usagi']]) expect(parseSkinReport({ ...report, id }), String(id)).toBeNull();
  });

  it('pulls numbers that are out of range back into it', () => {
    const g = parseSkinReport({ id: 'x', box: { w: 99999, h: 1, anchorX: -3, anchorY: 4 }, hitbox: { x: 2, y: -1, w: 0, h: 9 } })!;
    expect(g.box).toEqual({ w: 1024, h: 16, anchorX: 0, anchorY: 1 });
    expect(g.hitbox).toEqual({ x: 1, y: 0, w: 0.05, h: 1 });
  });

  it('refuses anything that is not numbers', () => {
    for (const bad of [null, 5, 'x', {}, { id: 'x', box: {}, hitbox: {} }, { ...report, box: { ...report.box, w: NaN } }, { ...report, hitbox: { ...report.hitbox, x: '0' } }, { id: 'x', box: report.box }]) {
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

describe('skinTitle', () => {
  const chiikawa = { name: 'Chiikawa', names: { ko: '치이카와' } };

  it('names a skin in the language of the app when it knows that name', () => {
    expect(skinTitle(chiikawa, 'ko', 'chiikawa')).toBe('치이카와');
  });

  it('falls back to the plain name, then to the folder', () => {
    expect(skinTitle(chiikawa, 'en', 'chiikawa')).toBe('Chiikawa');
    expect(skinTitle({ name: 'Mine' }, 'ko', 'mine')).toBe('Mine');
    expect(skinTitle({}, 'ko', 'mine')).toBe('mine');
    expect(skinTitle({ name: '   ', names: 'x' }, 'en', 'mine')).toBe('mine');
    expect(skinTitle({ name: 7 }, 'en', 'mine')).toBe('mine');
  });

  it('puts the Korean names of the bundled skins in Korean order', () => {
    const list = [
      { id: 'usagi', name: '우사기', builtin: true },
      { id: 'hachiware', name: '하치와레', builtin: true },
      { id: 'default', name: '스프라우트', builtin: true },
      { id: 'chiikawa', name: '치이카와', builtin: true },
      { id: 'rakko', name: '랏코', builtin: true },
    ];
    expect(sortSkins(list).map((s) => s.name)).toEqual(['랏코', '스프라우트', '우사기', '치이카와', '하치와레']);
  });
});

describe('sortSkins', () => {
  it('lists the bundled skins first and each group by name', () => {
    const list = [
      { id: 'mine', name: 'Zed', builtin: false },
      { id: 'usagi', name: 'Usagi', builtin: true },
      { id: 'default', name: 'Sprout', builtin: true },
      { id: 'chiikawa', name: 'Chiikawa', builtin: true },
      { id: 'abc', name: 'abc', builtin: false },
    ];
    expect(sortSkins(list).map((s) => s.id)).toEqual(['chiikawa', 'default', 'usagi', 'abc', 'mine']);
    // the input is left as it was
    expect(list[0]!.id).toBe('mine');
  });

  it('breaks a tie between equal names by id, so the order never depends on the folder listing', () => {
    const a = { id: 'a-copy', name: 'Same', builtin: false };
    const b = { id: 'b-copy', name: 'Same', builtin: false };
    expect(sortSkins([b, a]).map((s) => s.id)).toEqual(['a-copy', 'b-copy']);
  });
});
