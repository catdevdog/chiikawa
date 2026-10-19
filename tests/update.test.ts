import { describe, expect, it } from 'vitest';
import {
  hasUninstaller,
  UpdateController,
  updateMenuItem,
  updateMode,
  type UpdaterEvents,
  type UpdaterPort,
  type UpdateState,
  type UpdateStrings,
} from '../src/shared/update';

describe('what kind of build this is', () => {
  it('updates itself only when it is an installed Windows build', () => {
    expect(updateMode({ packaged: true, platform: 'win32', installed: true })).toBe('auto');
  });

  it('only points at the releases page when it is packaged but not installed (the portable zip) or not Windows', () => {
    expect(updateMode({ packaged: true, platform: 'win32', installed: false })).toBe('link');
    expect(updateMode({ packaged: true, platform: 'linux', installed: true })).toBe('link');
    expect(updateMode({ packaged: true, platform: 'darwin', installed: true })).toBe('link');
  });

  it('does nothing in a development run', () => {
    for (const platform of ['win32', 'linux', 'darwin']) expect(updateMode({ packaged: false, platform, installed: true })).toBe('off');
  });

  it('tells an installation from the portable zip by the uninstaller beside the app', () => {
    expect(hasUninstaller(['Desktop Buddy.exe', 'Uninstall Desktop Buddy.exe', 'resources', 'locales'])).toBe(true);
    expect(hasUninstaller(['uninstall desktop buddy.EXE'])).toBe(true);
    expect(hasUninstaller(['Desktop Buddy.exe', 'resources', 'locales', 'chrome_100_percent.pak'])).toBe(false);
    expect(hasUninstaller(['Uninstaller.exe', 'uninstall.txt', 'Uninstall'])).toBe(false);
    expect(hasUninstaller([])).toBe(false);
  });
});

/** A hand-run clock: timers only fire when the test says so. */
function fakeTimers() {
  const pending = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  return {
    set: (fn: () => void, ms: number) => {
      pending.set(next, { fn, ms });
      return next++;
    },
    clear: (h: unknown) => void pending.delete(h as number),
    /** runs the oldest timer and returns the delay it was set with, or null when none is waiting */
    fire(): number | null {
      const first = [...pending.entries()][0];
      if (!first) return null;
      pending.delete(first[0]);
      first[1].fn();
      return first[1].ms;
    },
    get waiting() {
      return pending.size;
    },
  };
}

/** What the controller sees of the real updater; each look runs `script`, which plays the updater's events. */
function setup(script: (e: UpdaterEvents) => void | Promise<void> = (e) => e.notAvailable(), opts: { firstCheckMs?: number; intervalMs?: number } = {}) {
  const timers = fakeTimers();
  const states: UpdateState[] = [];
  const ready: string[] = [];
  const logs: string[] = [];
  const calls = { checks: 0, installs: 0 };
  let events!: UpdaterEvents;
  const port: UpdaterPort = {
    listen: (e) => (events = e),
    check: async () => {
      calls.checks++;
      await script(events);
    },
    install: () => void calls.installs++,
  };
  const controller = new UpdateController({
    port,
    onChange: (s) => states.push(s),
    onReady: (v) => ready.push(v),
    log: (level, message) => logs.push(`${level}: ${message}`),
    timers,
    ...opts,
  });
  const kinds = (): string[] => states.map((s) => s.kind);
  return { controller, timers, states, kinds, ready, logs, calls, events: () => events };
}

/** lets the promise of a look finish */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('the update controller', () => {
  it('starts idle and looks at nothing until it is asked', () => {
    const t = setup();
    expect(t.controller.state).toEqual({ kind: 'idle' });
    expect(t.calls.checks).toBe(0);
    expect(t.timers.waiting).toBe(0);
  });

  it('follows a look that finds nothing new', async () => {
    const t = setup((e) => {
      e.checking();
      e.notAvailable();
    });
    t.controller.checkNow();
    await settle();
    expect(t.kinds()).toEqual(['checking', 'upToDate']);
  });

  it('follows a download from the first byte to ready, and announces the version once', async () => {
    const t = setup((e) => {
      e.checking();
      e.available('1.2.3');
      for (const p of [0.4, 3, 7.9, 12, 49.9, 50, 99.6]) e.progress(p);
      e.downloaded('1.2.3');
    });
    t.controller.checkNow();
    await settle();
    expect(t.states).toEqual([
      { kind: 'checking' },
      { kind: 'downloading', version: '1.2.3', percent: 0 },
      // the menu is redrawn in steps of 5 %, not for every chunk
      { kind: 'downloading', version: '1.2.3', percent: 5 },
      { kind: 'downloading', version: '1.2.3', percent: 10 },
      { kind: 'downloading', version: '1.2.3', percent: 45 },
      { kind: 'downloading', version: '1.2.3', percent: 50 },
      { kind: 'downloading', version: '1.2.3', percent: 95 },
      { kind: 'ready', version: '1.2.3' },
    ]);
    expect(t.ready).toEqual(['1.2.3']);
  });

  it('ignores progress that is not a number, and progress when nothing is downloading', async () => {
    const t = setup();
    t.events().progress(50);
    expect(t.states).toEqual([]);
    t.events().available('2.0.0');
    t.events().progress(NaN);
    t.events().progress(-20);
    t.events().progress(500);
    expect(t.states.map((s) => (s.kind === 'downloading' ? s.percent : s.kind))).toEqual([0, 100]);
  });

  it('does not look again while a look is under way, a download is coming in, or the new version is ready', async () => {
    let finish!: () => void;
    const t = setup(
      (e) =>
        new Promise<void>((resolve) => {
          e.checking();
          finish = () => {
            e.available('3.0.0');
            resolve();
          };
        }),
    );
    t.controller.checkNow();
    t.controller.checkNow();
    expect(t.calls.checks).toBe(1);
    finish();
    await settle();
    expect(t.controller.state.kind).toBe('downloading');
    t.controller.checkNow();
    expect(t.calls.checks).toBe(1);
    t.events().downloaded('3.0.0');
    t.controller.checkNow();
    expect(t.calls.checks).toBe(1);
    expect(t.controller.state).toEqual({ kind: 'ready', version: '3.0.0' });
  });

  it('lets the user look again after the last look is over', async () => {
    const t = setup((e) => e.notAvailable());
    t.controller.checkNow();
    await settle();
    t.controller.checkNow();
    await settle();
    expect(t.calls.checks).toBe(2);
    expect(t.kinds()).toEqual(['checking', 'upToDate', 'checking', 'upToDate']);
  });

  it('shows a failure the user asked for once, however many times the updater reports it', async () => {
    const t = setup(async (e) => {
      e.checking();
      e.error('net::ERR_INTERNET_DISCONNECTED');
      throw new Error('net::ERR_INTERNET_DISCONNECTED');
    });
    t.controller.checkNow();
    await settle();
    expect(t.kinds()).toEqual(['checking', 'failed']);
    expect(t.logs.some((l) => l.includes('ERR_INTERNET_DISCONNECTED'))).toBe(true);
    // asking again is allowed, and a good answer clears the failure
    const t2 = setup((e) => e.notAvailable());
    t2.controller.checkNow();
    await settle();
    expect(t2.controller.state.kind).toBe('upToDate');
  });

  it('can be asked again after a failure', async () => {
    let fail = true;
    const t = setup((e) => {
      if (fail) throw new Error('offline');
      e.notAvailable();
    });
    t.controller.checkNow();
    await settle();
    expect(t.controller.state.kind).toBe('failed');
    fail = false;
    t.controller.checkNow();
    await settle();
    expect(t.controller.state.kind).toBe('upToDate');
  });

  it('stays quiet when a look nobody asked for fails', async () => {
    const t = setup(() => {
      throw new Error('offline');
    }, { firstCheckMs: 1000 });
    t.controller.setBackground(true);
    t.timers.fire();
    await settle();
    expect(t.kinds()).toEqual(['checking', 'idle']);
    expect(t.controller.state.kind).not.toBe('failed');
    expect(t.logs.some((l) => l.includes('offline'))).toBe(true);
  });

  it('shows a failed download as a failure only when the user started that look', async () => {
    const manual = setup((e) => {
      e.available('1.0.1');
      e.error('download failed');
    });
    manual.controller.checkNow();
    await settle();
    expect(manual.controller.state.kind).toBe('failed');
    const quiet = setup((e) => {
      e.available('1.0.1');
      e.error('download failed');
    }, { firstCheckMs: 10 });
    quiet.controller.setBackground(true);
    quiet.timers.fire();
    await settle();
    expect(quiet.controller.state.kind).toBe('idle');
  });

  it('returns to idle when the updater has nothing to look at and says nothing', async () => {
    const t = setup(() => {});
    t.controller.checkNow();
    await settle();
    expect(t.kinds()).toEqual(['checking', 'idle']);
  });

  it('ignores an error that arrives when nothing was going on', () => {
    const t = setup();
    t.events().error('stray');
    expect(t.states).toEqual([]);
    expect(t.logs).toEqual(['warn: update error: stray']);
  });

  it('looks soon after start and then at a steady pace, and stops when told to', async () => {
    const t = setup((e) => e.notAvailable(), { firstCheckMs: 30_000, intervalMs: 21_600_000 });
    t.controller.setBackground(true);
    t.controller.setBackground(true); // twice is still one timer
    expect(t.timers.waiting).toBe(1);
    expect(t.timers.fire()).toBe(30_000);
    await settle();
    expect(t.calls.checks).toBe(1);
    expect(t.timers.fire()).toBe(21_600_000);
    await settle();
    expect(t.timers.fire()).toBe(21_600_000);
    await settle();
    expect(t.calls.checks).toBe(3);
    t.controller.setBackground(false);
    expect(t.timers.waiting).toBe(0);
    expect(t.timers.fire()).toBeNull();
    // and it can be switched on again
    t.controller.setBackground(true);
    expect(t.timers.waiting).toBe(1);
  });

  it('keeps the timer going while a version waits to be installed, without looking again', async () => {
    const t = setup((e) => {
      e.available('4.0.0');
      e.downloaded('4.0.0');
    }, { firstCheckMs: 5, intervalMs: 7 });
    t.controller.setBackground(true);
    t.timers.fire();
    await settle();
    expect(t.controller.state).toEqual({ kind: 'ready', version: '4.0.0' });
    t.timers.fire();
    await settle();
    expect(t.calls.checks).toBe(1);
  });

  it('announces each downloaded version once', () => {
    const t = setup();
    t.events().downloaded('1.0.1');
    t.events().downloaded('1.0.1');
    t.events().downloaded('1.0.2');
    expect(t.ready).toEqual(['1.0.1', '1.0.2']);
  });

  it('installs only what has been downloaded, and only through the updater', () => {
    const t = setup();
    expect(t.controller.installNow()).toBe(false);
    t.events().available('1.0.1');
    expect(t.controller.installNow()).toBe(false);
    expect(t.calls.installs).toBe(0);
    t.events().downloaded('1.0.1');
    expect(t.controller.installNow()).toBe(true);
    expect(t.calls.installs).toBe(1);
  });

  it('stops its timer when it is disposed', () => {
    const t = setup();
    t.controller.setBackground(true);
    t.controller.dispose();
    expect(t.timers.waiting).toBe(0);
  });
});

describe('the tray entry', () => {
  const s: UpdateStrings = {
    updateCheck: 'check',
    updateChecking: 'checking',
    updateUpToDate: (v) => `up to date ${v}`,
    updateDownloading: (v, p) => `downloading ${v} ${p}%`,
    updateReady: (v) => `install ${v}`,
    updateFailed: 'failed',
    updateOpenPage: 'open the page',
  };
  const item = (state: UpdateState, mode: 'auto' | 'link' | 'off' = 'auto') => updateMenuItem(state, mode, '0.3.1', s);

  it('has one entry per state in an installed build', () => {
    expect(item({ kind: 'idle' })).toEqual({ label: 'check', enabled: true, action: 'check' });
    expect(item({ kind: 'checking' })).toEqual({ label: 'checking', enabled: false, action: 'none' });
    expect(item({ kind: 'upToDate' })).toEqual({ label: 'up to date 0.3.1', enabled: true, action: 'check' });
    expect(item({ kind: 'downloading', version: '0.4.0', percent: 35 })).toEqual({ label: 'downloading 0.4.0 35%', enabled: false, action: 'none' });
    expect(item({ kind: 'ready', version: '0.4.0' })).toEqual({ label: 'install 0.4.0', enabled: true, action: 'install' });
    expect(item({ kind: 'failed' })).toEqual({ label: 'failed', enabled: true, action: 'check' });
  });

  it('only opens the releases page in a build that cannot update itself, whatever the state', () => {
    for (const kind of ['idle', 'checking', 'upToDate', 'failed'] as const) {
      expect(item({ kind }, 'link')).toEqual({ label: 'open the page', enabled: true, action: 'open' });
    }
  });

  it('is absent in a development run', () => {
    expect(item({ kind: 'idle' }, 'off')).toBeNull();
    expect(item({ kind: 'ready', version: '9.9.9' }, 'off')).toBeNull();
  });
});
