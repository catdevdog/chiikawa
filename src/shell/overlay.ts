import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import type { DisplayInfo } from '../shared/displays';
import { IPC, type Area, type ViewFrame } from '../shared/types';
import { log } from './log';
import type { StageWindow } from './stage';

/** BUDDY_DEBUG=1 logs every click-through switch to buddy.log */
const DEBUG = !!process.env.BUDDY_DEBUG;

/** The transparent, always-on-top window that covers the work area of one monitor and draws the pet there. */
export class Overlay implements StageWindow {
  readonly win: BrowserWindow;
  displayId: number;
  area: Area;
  /** the page has asked for its start-up information, so it can be sent things */
  ready = false;
  /** lets the mouse through; kept here for diagnostics, the stage decides */
  ignoring = true;

  constructor(display: DisplayInfo, origin: string) {
    this.displayId = display.id;
    this.area = { ...display.workArea };
    const a = this.area;
    const win = new BrowserWindow({
      x: a.x,
      y: a.y,
      width: a.width,
      height: a.height,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false,
        devTools: !app.isPackaged,
      },
    });
    this.win = win;
    win.setAlwaysOnTop(true, 'floating');
    win.setIgnoreMouseEvents(true, { forward: true });

    const wc = win.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e, url) => {
      if (!url.startsWith(`${origin}/`)) e.preventDefault();
    });
    wc.on('render-process-gone', (_e, d) => log('error', `renderer gone: ${d.reason} (exit ${d.exitCode})`));
    wc.on('did-fail-load', (_e, code, desc, url) => log('error', `load failed: ${code} ${desc} ${url}`));
    win.once('ready-to-show', () => {
      this.fit();
      if (!win.isDestroyed()) win.showInactive();
    });
    void win.loadURL(`${origin}/index.html`);
  }

  get alive(): boolean {
    return !this.win.isDestroyed();
  }

  /**
   * Puts the window on its area. A monitor whose scale differs from the primary one can leave a new window at
   * the wrong size or place, so the result is checked and the move repeated.
   */
  fit(): void {
    if (!this.alive) return;
    const a = this.area;
    let b = this.win.getBounds();
    for (let i = 0; i < 3; i++) {
      this.win.setBounds({ x: a.x, y: a.y, width: a.width, height: a.height });
      b = this.win.getBounds();
      if (Math.abs(b.x - a.x) <= 1 && Math.abs(b.y - a.y) <= 1 && Math.abs(b.width - a.width) <= 1 && Math.abs(b.height - a.height) <= 1) return;
    }
    log('warn', `overlay of display ${this.displayId} is at ${JSON.stringify(b)} instead of ${JSON.stringify(a)}`);
  }

  /** The monitor's work area changed (resolution, taskbar, arrangement). */
  refit(display: DisplayInfo): void {
    const a = display.workArea;
    const same = a.x === this.area.x && a.y === this.area.y && a.width === this.area.width && a.height === this.area.height;
    this.displayId = display.id;
    if (same) return;
    this.area = { ...a };
    this.fit();
    this.tell(IPC.area, this.area);
  }

  // --- StageWindow ---------------------------------------------------------

  setIgnoring(ignore: boolean): void {
    this.ignoring = ignore;
    if (DEBUG) log('info', `click-through ${ignore ? 'on' : 'off'} display=${this.displayId}`);
    if (this.alive) this.win.setIgnoreMouseEvents(ignore, { forward: true });
  }

  send(frame: ViewFrame | null): void {
    this.tell(IPC.view, frame);
  }

  /** Sends to the page once it is up. */
  tell(channel: string, payload: unknown): void {
    if (this.ready && this.alive) this.win.webContents.send(channel, payload);
  }

  close(): void {
    this.ready = false;
    if (this.alive) this.win.destroy();
  }
}
