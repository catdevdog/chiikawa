import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The way the windows of the system are read (src/shell/win32.ts) leans on a handful of ways of calling a C function
 * through koffi: a struct that the call fills in, a number that the call writes through a pointer, a buffer that it
 * fills with text, and a callback that gets integers. Windows is the only place that code runs, but the same ways of
 * calling work with the C library of Linux, so they are checked here against that.
 */
const nodeRequire = createRequire(import.meta.url);

function load() {
  try {
    const koffi = nodeRequire('koffi');
    return { koffi, libc: koffi.load('libc.so.6') };
  } catch {
    return null;
  }
}

const k = process.platform === 'linux' ? load() : null;

describe.skipIf(!k)('calling C functions with koffi', () => {
  it('lets a call fill in a struct that is handed over as an empty object', () => {
    k!.koffi.struct('Timeval', { sec: 'int64_t', usec: 'int64_t' });
    const gettimeofday = k!.libc.func('int gettimeofday(_Out_ Timeval *tv, void *tz)');
    const tv: { sec?: number | bigint; usec?: number | bigint } = {};
    expect(gettimeofday(tv, null)).toBe(0);
    expect(Number(tv.sec)).toBeGreaterThan(1_600_000_000);
  });

  it('lets a call write a number through a pointer into a single-element array', () => {
    const getresuid = k!.libc.func('int getresuid(_Out_ uint32_t *r, _Out_ uint32_t *e, _Out_ uint32_t *s)');
    const r = [999];
    const e = [999];
    const s = [999];
    expect(getresuid(r, e, s)).toBe(0);
    expect(r[0]).toBe(process.getuid!());
    expect(e[0]).toBe(process.geteuid!());
  });

  it('lets a call fill a buffer with text', () => {
    const gethostname = k!.libc.func('int gethostname(_Out_ uint8_t *name, size_t len)');
    const buf = Buffer.alloc(256);
    expect(gethostname(buf, buf.length)).toBe(0);
    expect(buf.toString('utf8', 0, buf.indexOf(0))).toBe(os.hostname());
  });

  it('hands a callback integers by value, and a function written in place of the callback is called', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'koffi-'));
    try {
      writeFileSync(path.join(dir, 'a.txt'), 'a');
      writeFileSync(path.join(dir, 'b.txt'), 'b');
      k!.koffi.proto('int Visit(const char *path, intptr_t stat, int flag)');
      const ftw = k!.libc.func('int ftw(const char *dir, Visit *fn, int open)');
      const seen: { path: string; flag: number; stat: unknown }[] = [];
      const ret = ftw(
        dir,
        (p: string, stat: unknown, flag: number) => {
          seen.push({ path: p, flag, stat });
          return 0;
        },
        8,
      );
      expect(ret).toBe(0);
      const files = seen.filter((s) => s.path.endsWith('.txt'));
      expect(files.map((s) => path.basename(s.path)).sort()).toEqual(['a.txt', 'b.txt']);
      // the flag is a plain number (FTW_F is 0), and the pointer that was declared as an integer arrives as one
      for (const f of files) {
        expect(f.flag).toBe(0);
        expect(['number', 'bigint']).toContain(typeof f.stat);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stops asking when the callback says to', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'koffi-'));
    try {
      writeFileSync(path.join(dir, 'a.txt'), 'a');
      writeFileSync(path.join(dir, 'b.txt'), 'b');
      const ftw = k!.libc.func('int ftw(const char *dir, Visit *fn, int open)');
      let calls = 0;
      ftw(dir, () => ++calls && 1, 8);
      expect(calls).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
