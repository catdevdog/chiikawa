/**
 * Keeping an installed app up to date. What decides things lives here, free of Electron, so it can be tested: what
 * kind of build this is, what the tray shows in each state, and the controller that turns the updater's events into
 * those states and decides when to look for a new version.
 */

/**
 * auto: an installed Windows build, which downloads newer versions and installs them itself.
 * link: any other packaged build (the portable zip), which can only point at the releases page.
 * off: a development run.
 */
export type UpdateMode = 'auto' | 'link' | 'off';

export function updateMode(build: { packaged: boolean; platform: string; installed: boolean }): UpdateMode {
  if (!build.packaged) return 'off';
  return build.platform === 'win32' && build.installed ? 'auto' : 'link';
}

/** The installer puts "Uninstall <product>.exe" next to the app; the portable zip has none. */
export function hasUninstaller(files: readonly string[]): boolean {
  return files.some((f) => /^uninstall .*\.exe$/i.test(f));
}

export type UpdateState =
  /** nothing known yet, or the last background look failed quietly */
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate' }
  /** `percent` moves in steps of 5, so the menu is not rebuilt for every chunk */
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'ready'; version: string }
  /** a look the user asked for failed */
  | { kind: 'failed' };

/** What the real updater reports. The controller listens; an adapter forwards. */
export interface UpdaterEvents {
  checking(): void;
  available(version: string): void;
  notAvailable(): void;
  /** 0 to 100 */
  progress(percent: number): void;
  downloaded(version: string): void;
  error(message: string): void;
}

export interface UpdaterPort {
  /** called once; the port forwards the updater's events to `events` from then on */
  listen(events: UpdaterEvents): void;
  /** looks for a newer version (and downloads it); the outcome arrives as events. Resolves when the look is over. */
  check(): Promise<void>;
  /** quits the app and runs the installer of the downloaded version */
  install(): void;
}

export interface UpdateOptions {
  port: UpdaterPort;
  onChange(state: UpdateState): void;
  /** once for each version that finished downloading */
  onReady(version: string): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  /** the first background look comes this long after start */
  firstCheckMs?: number;
  /** then one look this often */
  intervalMs?: number;
  /** replaceable in tests */
  timers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
}

const FIRST_CHECK_MS = 30_000;
const INTERVAL_MS = 6 * 60 * 60_000;
const PROGRESS_STEP = 5;

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class UpdateController implements UpdaterEvents {
  private current: UpdateState = { kind: 'idle' };
  /** the look under way was asked for in the menu: its failure is shown, a background one stays quiet */
  private manual = false;
  private background = false;
  private timer: unknown = null;
  private readonly timers: NonNullable<UpdateOptions['timers']>;
  private notified: string | null = null;

  constructor(private readonly o: UpdateOptions) {
    this.timers = o.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
    o.port.listen(this);
  }

  get state(): UpdateState {
    return this.current;
  }

  /** Looks now and then without being asked: once soon after start, then regularly. Off stops it. */
  setBackground(on: boolean): void {
    if (on === this.background) return;
    this.background = on;
    if (on) this.schedule(this.o.firstCheckMs ?? FIRST_CHECK_MS);
    else this.stopTimer();
  }

  /** The menu's "check for updates". */
  checkNow(): void {
    void this.run(true);
  }

  /** Installs the downloaded version and restarts. False when nothing has been downloaded. */
  installNow(): boolean {
    if (this.current.kind !== 'ready') return false;
    this.o.log('info', `installing v${this.current.version}`);
    this.o.port.install();
    return true;
  }

  dispose(): void {
    this.setBackground(false);
  }

  // --- what the updater reports ---------------------------------------------------------------------

  checking(): void {
    // the state was set when the look started
  }

  available(version: string): void {
    this.o.log('info', `v${version} is available, downloading`);
    this.set({ kind: 'downloading', version, percent: 0 });
  }

  notAvailable(): void {
    this.set({ kind: 'upToDate' });
  }

  progress(percent: number): void {
    if (this.current.kind !== 'downloading' || !Number.isFinite(percent)) return;
    const step = Math.min(100, Math.floor(Math.max(0, percent) / PROGRESS_STEP) * PROGRESS_STEP);
    if (step !== this.current.percent) this.set({ kind: 'downloading', version: this.current.version, percent: step });
  }

  downloaded(version: string): void {
    this.set({ kind: 'ready', version });
    if (this.notified === version) return;
    this.notified = version;
    this.o.onReady(version);
  }

  error(message: string): void {
    this.o.log('warn', `update error: ${message}`);
    // the updater reports a failure twice (an event and a rejected promise); only the first one finds a look under way
    if (this.current.kind !== 'checking' && this.current.kind !== 'downloading') return;
    this.set(this.manual ? { kind: 'failed' } : { kind: 'idle' });
  }

  // --- internals --------------------------------------------------------------------------------------------

  private async run(manual: boolean): Promise<void> {
    const kind = this.current.kind;
    // a look is under way, a download is coming in, or the new version is already here
    if (kind === 'checking' || kind === 'downloading' || kind === 'ready') return;
    this.manual = manual;
    this.set({ kind: 'checking' });
    try {
      await this.o.port.check();
    } catch (err) {
      this.error(errorText(err));
    }
    // an updater with nothing to look at (not a real build) answers without a word
    // (read through the getter: the guard above must not be taken to still hold after the await)
    if (this.state.kind === 'checking') this.set({ kind: 'idle' });
  }

  private schedule(ms: number): void {
    this.stopTimer();
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.run(false);
      if (this.background) this.schedule(this.o.intervalMs ?? INTERVAL_MS);
    }, ms);
  }

  private stopTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  private set(next: UpdateState): void {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.current = next;
    this.o.onChange(next);
  }
}

/** The words the menu item needs. */
export interface UpdateStrings {
  updateCheck: string;
  updateChecking: string;
  updateUpToDate: (version: string) => string;
  updateDownloading: (version: string, percent: number) => string;
  updateReady: (version: string) => string;
  updateFailed: string;
  updateOpenPage: string;
}

export interface UpdateMenuItem {
  label: string;
  enabled: boolean;
  /** what a click does: look again, install and restart, open the releases page */
  action: 'check' | 'install' | 'open' | 'none';
}

/** The tray's update entry for a state, or null when this kind of build has none. */
export function updateMenuItem(state: UpdateState, mode: UpdateMode, version: string, s: UpdateStrings): UpdateMenuItem | null {
  if (mode === 'off') return null;
  if (mode === 'link') return { label: s.updateOpenPage, enabled: true, action: 'open' };
  switch (state.kind) {
    case 'idle':
      return { label: s.updateCheck, enabled: true, action: 'check' };
    case 'checking':
      return { label: s.updateChecking, enabled: false, action: 'none' };
    case 'upToDate':
      return { label: s.updateUpToDate(version), enabled: true, action: 'check' };
    case 'downloading':
      return { label: s.updateDownloading(state.version, state.percent), enabled: false, action: 'none' };
    case 'ready':
      return { label: s.updateReady(state.version), enabled: true, action: 'install' };
    case 'failed':
      return { label: s.updateFailed, enabled: true, action: 'check' };
  }
}
