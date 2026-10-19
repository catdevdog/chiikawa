import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  screen,
  session,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Mode, Roam } from '../engine/types';
import { inEllipse } from '../engine/vec';
import { DEFAULT_SETTINGS, IPC, type HitboxReport, type InitInfo, type Settings } from '../shared/types';
import { t } from './i18n';
import { log } from './log';
import { makerCovers, openMaker, registerMakerIpc } from './maker';
import { loadSettings, saveSettings } from './settings';
import { safeJoin } from './safe-path';
import { ensureUserSkinsDir, listSkins, MIME, resolveSkinFile, userSkinsDir } from './skins';

const APP_ID = 'io.github.catdevdog.desktop-buddy';
const ORIGIN = 'buddy://app';
const QUIT_SHORTCUT = 'CommandOrControl+Alt+Shift+B';
const QUIT_LABEL = process.platform === 'darwin' ? 'Cmd+Alt+Shift+B' : 'Ctrl+Alt+Shift+B';
const MAKER_FLAG = '--maker';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'buddy',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

// Windows may stop painting a window it believes is covered; the overlay has to keep animating.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let settings: Settings = { ...DEFAULT_SETTINGS };
let area = { x: 0, y: 0, width: 0, height: 0 };
/** latest pet hitbox from the renderer; click-through is decided from it */
let report: HitboxReport | null = null;
let dragging = false;
let ignoring = true;
/** BUDDY_DEBUG=1 logs every click-through switch to buddy.log */
const DEBUG = !!process.env.BUDDY_DEBUG;
let seenHitbox = false;

const trusted = (e: IpcMainEvent | IpcMainInvokeEvent): boolean =>
  !!e.senderFrame && e.senderFrame.url.startsWith(`${ORIGIN}/`);

function isHitbox(r: unknown): r is HitboxReport {
  if (!r || typeof r !== 'object') return false;
  const { rect, interactive } = r as Record<string, any>;
  return (
    typeof interactive === 'boolean' &&
    !!rect &&
    [rect.x, rect.y, rect.w, rect.h].every((n: unknown) => typeof n === 'number' && Number.isFinite(n))
  );
}

// --- app:// protocol: the UI from dist/renderer, skins from the user and bundled folders ----------

function registerProtocol(): void {
  const rendererDir = path.join(app.getAppPath(), 'dist', 'renderer');
  protocol.handle('buddy', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'app') return new Response('forbidden', { status: 403 });
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = rel.startsWith('/skins/') ? await resolveSkinFile(rel.slice('/skins/'.length)) : safeJoin(rendererDir, rel);
      if (!file) return new Response('not found', { status: 404 });
      const data = await readFile(file);
      return new Response(data, {
        headers: {
          'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

// --- overlay window --------------------------------------------------------------------------

function createOverlay(): void {
  area = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    ...area,
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
  win.setAlwaysOnTop(true, 'floating');
  win.setIgnoreMouseEvents(true, { forward: true });

  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) e.preventDefault();
  });
  wc.on('render-process-gone', (_e, d) => log('error', `renderer gone: ${d.reason} (exit ${d.exitCode})`));
  wc.on('did-fail-load', (_e, code, desc, url) => log('error', `load failed: ${code} ${desc} ${url}`));
  win.once('ready-to-show', () => win?.showInactive());
  win.on('closed', () => {
    win = null;
  });
  void win.loadURL(`${ORIGIN}/index.html`);
}

function refreshArea(): void {
  const wa = screen.getPrimaryDisplay().workArea;
  if (wa.x === area.x && wa.y === area.y && wa.width === area.width && wa.height === area.height) return;
  area = wa;
  if (!win) return;
  win.setBounds(area);
  win.webContents.send(IPC.world, { width: area.width, height: area.height });
}

/**
 * The window ignores the mouse except while the cursor is over the pet (or a drag is running).
 * Polling the cursor here is what lets the pet follow it even though the window never sees events
 * from other apps, and lets the hit test run without the renderer receiving any mouse input.
 */
function startCursorLoop(): void {
  let last = { x: Number.NaN, y: Number.NaN };
  let lastSent = 0;
  setInterval(() => {
    if (!win || win.isDestroyed() || win.webContents.isLoading()) return;
    const p = screen.getCursorScreenPoint();
    const x = p.x - area.x;
    const y = p.y - area.y;
    const now = Date.now();
    if (x !== last.x || y !== last.y || now - lastSent > 250) {
      win.webContents.send(IPC.cursor, { x, y });
      last = { x, y };
      lastSent = now;
    }
    const over = dragging || (report?.interactive === true && inEllipse({ x, y }, report.rect) && !makerCovers(p));
    if (over === ignoring) {
      ignoring = !over;
      win.setIgnoreMouseEvents(ignoring, { forward: true });
      if (DEBUG) log('info', `click-through ${ignoring ? 'on' : 'off'} cursor=${x},${y} dragging=${dragging} rect=${JSON.stringify(report?.rect)}`);
    }
  }, 16);
}

function registerIpc(): void {
  ipcMain.handle(IPC.init, async (e): Promise<InitInfo> => {
    if (!trusted(e)) throw new Error('untrusted sender');
    return {
      world: { width: area.width, height: area.height },
      settings,
      skins: await listSkins(),
      platform: process.platform,
      version: app.getVersion(),
    };
  });
  ipcMain.on(IPC.hitbox, (e, r: unknown) => {
    const ok = trusted(e) && isHitbox(r);
    if (ok) report = r as HitboxReport;
    if (DEBUG && (!ok || !seenHitbox)) log('info', `hitbox report ok=${ok} ${JSON.stringify(r)}`);
    seenHitbox = true;
  });
  ipcMain.on(IPC.dragging, (e, on: unknown) => {
    if (trusted(e)) dragging = on === true;
  });
  ipcMain.on(IPC.log, (e, level: unknown, message: unknown) => {
    if (!trusted(e)) return;
    log(level === 'warn' || level === 'error' ? level : 'info', `[renderer] ${String(message).slice(0, 2000)}`);
  });
}

// --- settings and tray -------------------------------------------------------------------------

function update(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };
  saveSettings(settings);
  if (patch.autoStart !== undefined) applyAutoStart();
  win?.webContents.send(IPC.settings, settings);
  void rebuildMenu();
}

function applyAutoStart(): void {
  // an unpackaged run would register the bare electron binary
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: settings.autoStart });
  } catch (err) {
    log('warn', `could not change autostart: ${String(err)}`);
  }
}

async function rebuildMenu(): Promise<void> {
  if (!tray) return;
  const s = t();
  const skins = await listSkins();
  const radio = <V>(label: string, value: V, current: V, apply: (v: V) => void): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: value === current,
    click: () => apply(value),
  });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: s.mode,
        submenu: [
          radio<Mode>(s.modeAuto, 'auto', settings.mode, (mode) => update({ mode })),
          radio<Mode>(s.modeFollow, 'follow', settings.mode, (mode) => update({ mode })),
          radio<Mode>(s.modeAttach, 'attach', settings.mode, (mode) => update({ mode })),
          radio<Mode>(s.modeWander, 'wander', settings.mode, (mode) => update({ mode })),
        ],
      },
      {
        label: s.size,
        submenu: [
          radio(s.small, 0.75, settings.scale, (scale) => update({ scale })),
          radio(s.normal, 1, settings.scale, (scale) => update({ scale })),
          radio(s.large, 1.5, settings.scale, (scale) => update({ scale })),
          radio(s.huge, 2, settings.scale, (scale) => update({ scale })),
        ],
      },
      {
        label: s.roam,
        submenu: [
          radio<Roam>(s.roamFree, 'free', settings.roam, (roam) => update({ roam })),
          radio<Roam>(s.roamFloor, 'floor', settings.roam, (roam) => update({ roam })),
        ],
      },
      {
        label: s.skin,
        submenu: [
          ...skins.map((sk) => radio(sk.name, sk.id, settings.skin, (skin) => update({ skin }))),
          { type: 'separator' },
          { label: s.openSkins, click: () => void shell.openPath(userSkinsDir()) },
        ],
      },
      { label: s.makeSkin, click: () => openMaker() },
      { type: 'separator' },
      { label: s.clickThrough, type: 'checkbox', checked: settings.clickThrough, click: (i) => update({ clickThrough: i.checked }) },
      { label: s.autoStart, type: 'checkbox', checked: settings.autoStart, click: (i) => update({ autoStart: i.checked }) },
      { type: 'separator' },
      { label: `${s.quit} (${QUIT_LABEL})`, click: () => app.quit() },
    ]),
  );
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(path.join(app.getAppPath(), 'assets', 'tray.png')));
  tray.setToolTip('Desktop Buddy');
  // Windows only opens the menu on right click by default
  tray.on('click', () => tray?.popUpContextMenu());
  void rebuildMenu();
}

// --- lifecycle -----------------------------------------------------------------------------------

async function boot(): Promise<void> {
  app.setAppUserModelId(APP_ID);
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  ensureUserSkinsDir();
  settings = loadSettings();
  registerProtocol();
  registerIpc();
  registerMakerIpc({
    onSaved: (id) => {
      // a skin that is on screen right now is re-read; the tray list picks up new ones
      if (settings.skin === id) win?.webContents.send(IPC.reloadSkin);
      void rebuildMenu();
    },
    apply: (skin) => update({ skin }),
  });
  applyAutoStart();
  createOverlay();
  createTray();
  startCursorLoop();
  screen.on('display-metrics-changed', refreshArea);
  screen.on('display-added', refreshArea);
  screen.on('display-removed', refreshArea);
  if (!globalShortcut.register(QUIT_SHORTCUT, () => app.quit())) log('warn', `could not register ${QUIT_SHORTCUT}`);
  log('info', `started v${app.getVersion()} (electron ${process.versions.electron}, ${process.platform}, area ${JSON.stringify(area)})`);
  if (process.argv.includes(MAKER_FLAG)) openMaker();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    // "DesktopBuddy.exe --maker" from a shortcut opens the skin maker in the instance that is already running
    if (argv.includes(MAKER_FLAG) && app.isReady()) openMaker();
    else log('info', 'second instance blocked');
  });
  app.whenReady().then(boot).catch((err) => {
    log('error', `boot failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    app.quit();
  });
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
process.on('uncaughtException', (err) => log('error', `uncaught: ${err.stack ?? err.message}`));
process.on('unhandledRejection', (reason) => log('error', `unhandled rejection: ${String(reason)}`));
