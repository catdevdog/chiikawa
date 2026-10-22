import {
  app,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  protocol,
  screen,
  session,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Mode, NoticeEvent, Roam, SayEvent, SpeechLevel } from '../engine/types';
import { chooseDisplays, MONITOR_ALL, MONITOR_PRIMARY, parseFakeDisplays, type DisplayInfo } from '../shared/displays';
import { BatteryWatch } from '../shared/power';
import { sanitizeFriends } from '../shared/sanitize';
import { DEFAULT_SETTINGS, IPC, MAX_FRIENDS, type InitInfo, type Settings } from '../shared/types';
import { parseBattery, parsePointer, parseSkinReport } from '../shared/validate';
import { readDisplays, setFakeDisplays } from './displays';
import { t } from './i18n';
import { log } from './log';
import { makerCovers, openMaker, registerMakerIpc } from './maker';
import { Overlay } from './overlay';
import { boxesFrom, platformsFrom, sidesFrom, type RawWindow, type WindowBox, type WindowSource } from './perch';
import { safeJoin } from './safe-path';
import { loadSettings, saveSettings } from './settings';
import { ensureUserSkinsDir, listSkins, MIME, resolveSkinFile, userSkinsDir } from './skins';
import { Stage, type StageDeps } from './stage';
import { createUpdates, type Updates } from './updater';
import { openWin32Cursor, openWin32Source, type CursorControl } from './win32';
import { announceChanges, releasePage, type Announced } from './whats-new';

const APP_ID = 'io.github.catdevdog.desktop-buddy';
const ORIGIN = 'buddy://app';
/** The keys that work while any other program has the focus: Ctrl+Alt+Shift and a letter. */
const shortcut = (key: string): string => `CommandOrControl+Alt+Shift+${key}`;
const shortcutLabel = (key: string): string => `${process.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+Alt+Shift+${key}`;
const QUIT_KEY = 'B';
const HIDE_KEY = 'H';
const CALL_KEY = 'C';
/** a wake from sleep brings the screens back a moment later, and the lock screen a moment after that */
const RESUME_GREETING_MS = 3000;
const UNLOCK_GREETING_MS = 800;
const MAKER_FLAG = '--maker';
/** the pet is simulated this often */
const TICK_MS = 16;
/** Windows sends several display events for one change; act once they have settled */
const DISPLAY_SETTLE_MS = 150;
/** the windows of other programs are looked at this often (the pets that stand on one follow it smoothly in between) */
const PERCH_POLL_MS = 200;
/** the windows that pets go along with are looked at this often, and only those: it is what makes them move with the window */
const FOLLOW_POLL_MS = 33;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'buddy',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

// Windows may stop painting a window it believes is covered; the overlay has to keep animating.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

let tray: Tray | null = null;
let settings: Settings = { ...DEFAULT_SETTINGS };
/** one overlay per monitor the pet lives on, by display id */
const overlays = new Map<number, Overlay>();
let stage: Stage;
/** the last report of each skin that was passed on, so that a skin every overlay reports is heard once */
const lastSkins = new Map<string, string>();
/** every overlay reports the battery; this keeps one warning for each time it runs low */
const batteryWatch = new BatteryWatch();
/** the screen is locked, so nobody is there to be greeted */
let screenLocked = false;
/** keeps the installed app up to date; null until the app is ready */
let updates: Updates | null = null;
/** the tray menu as last built, for the end-to-end tests to read */
let lastMenu: Menu | null = null;
/** where the windows of other programs come from (Windows only; null where the pets cannot sit on windows) */
let perchSource: WindowSource | null = null;
/** the system's own source, which the end-to-end tests put aside for a made-up one */
let systemSource: WindowSource | null = null;
/** the windows as the last look found them (and the quick looks at the ones that are followed kept up to date) */
let windowBoxes: WindowBox[] = [];
/** the made-up windows of the end-to-end tests, while there are any */
let fakeWindows: RawWindow[] | null = null;
/** how the pets move the real mouse cursor (Windows only; null where they cannot) */
let cursorControl: CursorControl | null = null;
/** what the stage is given to work with; the end-to-end tests put a cursor of their own in it */
let stageDeps: StageDeps = { cursor: () => screen.getCursorScreenPoint(), covered: (p) => makerCovers(p) };
/** the cursor of the end-to-end tests, while there is one: where it is, and whether it is in use for something else */
let fakeCursor: { x: number; y: number } | null = null;
let fakeBusy = false;

/** The overlay window an IPC message came from; anything else (the skin maker, a stray frame) is refused. */
function overlayOf(e: IpcMainEvent | IpcMainInvokeEvent): Overlay | undefined {
  if (!e.senderFrame?.url.startsWith(`${ORIGIN}/`)) return undefined;
  for (const o of overlays.values()) if (o.alive && o.win.webContents === e.sender) return o;
  return undefined;
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

// --- monitors and overlay windows ---------------------------------------------------------------

const describeAreas = (list: Iterable<{ displayId: number; area: { x: number; y: number; width: number; height: number } }>): string =>
  [...list].map((o) => `#${o.displayId} ${o.area.width}x${o.area.height}@${o.area.x},${o.area.y}`).join(' | ');

/**
 * Makes the overlays match the monitors: one for each monitor the pet lives on, none for the others. New windows
 * come first, so the pet always has somewhere to stand while screens come and go.
 */
function syncDisplays(): void {
  const chosen = chooseDisplays(readDisplays(), settings.monitor);
  if (chosen.length === 0) {
    // every monitor is gone for the moment (a remote session ending, say): keep what is up until they are back
    log('warn', 'no monitor found');
    return;
  }
  const wanted = new Set(chosen.map((d) => d.id));
  for (const d of chosen) {
    const have = overlays.get(d.id);
    if (have?.alive) have.refit(d);
    else overlays.set(d.id, new Overlay(d, ORIGIN));
  }
  for (const [id, o] of overlays) {
    if (wanted.has(id)) continue;
    o.close();
    overlays.delete(id);
  }
  const ordered = chosen.map((d) => overlays.get(d.id)!);
  stage.setWindows(ordered);
  void rebuildMenu();
  log('info', `screens: ${describeAreas(ordered)}`);
}

let settleTimer: ReturnType<typeof setTimeout> | null = null;
function syncDisplaysSoon(ms = DISPLAY_SETTLE_MS): void {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    try {
      syncDisplays();
    } catch (err) {
      log('error', `could not update the monitors: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    }
  }, ms);
}

function tellAll(channel: string, payload: unknown): void {
  for (const o of overlays.values()) o.tell(channel, payload);
}

// --- the simulation ---------------------------------------------------------------------------------

function startLoop(): void {
  let failures = 0;
  setInterval(() => {
    try {
      stage.tick(performance.now());
    } catch (err) {
      // a broken step must not stop the pet for good; say so once in a while instead of 60 times a second
      if (failures++ % 600 === 0) log('error', `tick failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    }
  }, TICK_MS);
  setInterval(pollPerch, PERCH_POLL_MS);
  setInterval(followWindows, FOLLOW_POLL_MS);
}

/** Looks at the windows of other programs and tells the pets where they can stand. Nothing happens while the setting is off. */
function pollPerch(): void {
  if (!settings.windows || stage.isHidden || !perchSource) return;
  try {
    publishWindows(boxesFrom(perchSource));
  } catch (err) {
    // give it up for this run rather than failing five times a second
    log('error', `could not read the windows: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    perchSource = null;
    publishWindows([]);
    void rebuildMenu();
  }
}

/** The windows the pets know about: the tops to stand on and the sides to hide at. */
function publishWindows(boxes: WindowBox[]): void {
  windowBoxes = boxes;
  stage.setPlatforms(platformsFrom(boxes));
  stage.setSides(sidesFrom(boxes));
}

/**
 * Looks at the windows that pets are going along with (the one they stand on or hide at) much more often than the rest,
 * so that they move with their window and do not trail behind it. A window that is gone is dropped at once.
 */
function followWindows(): void {
  const source = perchSource;
  if (!settings.windows || stage.isHidden || !source?.frames || windowBoxes.length === 0) return;
  const ids = stage.followed;
  if (ids.length === 0) return;
  try {
    const fresh = new Map(boxesFrom({ list: () => source.frames!(ids), toDip: source.toDip }).map((b) => [b.id, b]));
    let changed = false;
    const next: WindowBox[] = [];
    for (const b of windowBoxes) {
      if (!ids.includes(b.id)) {
        next.push(b);
        continue;
      }
      const f = fresh.get(b.id);
      if (!f) {
        // a window that a pet goes along with is not one to stand on any more (closed, minimized, hidden)
        log('info', `windows: the window ${b.id} that a pet goes along with is not listed any more`);
        changed = true;
        continue;
      }
      if (f.x !== b.x || f.y !== b.y || f.w !== b.w || f.h !== b.h) changed = true;
      next.push(f);
    }
    if (changed) publishWindows(next);
  } catch {
    // the full look every PERCH_POLL_MS reports (and gives up on) a source that fails
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.init, async (e): Promise<InitInfo> => {
    const o = overlayOf(e);
    if (!o) throw new Error('untrusted sender');
    o.ready = true;
    return {
      area: o.area,
      settings,
      skins: await listSkins(),
      platform: process.platform,
      version: app.getVersion(),
    };
  });
  ipcMain.on(IPC.pointer, (e, raw: unknown) => {
    const o = overlayOf(e);
    const report = parsePointer(raw);
    if (o && report) stage.pointer(o, report);
  });
  ipcMain.on(IPC.skin, (e, raw: unknown) => {
    const skin = overlayOf(e) && parseSkinReport(raw);
    if (!skin) return;
    // every overlay reports each skin it loaded; the pets only need to hear about a change
    const key = JSON.stringify(skin);
    if (key === lastSkins.get(skin.id)) return;
    lastSkins.set(skin.id, key);
    stage.setSkin(skin);
    // the menu offers a trick only to a skin that has one
    void rebuildMenu();
  });
  ipcMain.on(IPC.battery, (e, raw: unknown) => {
    if (overlayOf(e)) onBattery(raw);
  });
  ipcMain.on(IPC.log, (e, level: unknown, message: unknown) => {
    if (!overlayOf(e)) return;
    log(level === 'warn' || level === 'error' ? level : 'info', `[renderer] ${String(message).slice(0, 2000)}`);
  });
}

// --- hiding, calling and the computer's news ---------------------------------------------------

function setHidden(hidden: boolean): void {
  stage.setHidden(hidden);
  // the windows may have moved while the pets were away
  if (!hidden) pollPerch();
  void rebuildMenu();
}

function toggleHidden(): void {
  setHidden(!stage.isHidden);
}

function performTrick(): void {
  stage.perform();
}

function callPet(): void {
  stage.call();
  // a call also brings back a pet that was hidden
  void rebuildMenu();
}

function onBattery(raw: unknown): void {
  const battery = parseBattery(raw);
  if (battery && batteryWatch.report(battery)) stage.notice('lowBattery');
}

/** The pet notices the user coming back (unlock, wake from sleep) and the charger going in or out. */
function watchPower(): void {
  powerMonitor.on('lock-screen', () => {
    screenLocked = true;
  });
  powerMonitor.on('unlock-screen', () => {
    screenLocked = false;
    setTimeout(() => stage.notice('welcome'), UNLOCK_GREETING_MS);
  });
  // with a lock screen the unlock does the greeting; without one nothing else tells that the user is back
  powerMonitor.on('resume', () => {
    setTimeout(() => {
      if (!screenLocked) stage.notice('welcome');
    }, RESUME_GREETING_MS);
  });
  powerMonitor.on('on-ac', () => stage.notice('plug'));
  powerMonitor.on('on-battery', () => stage.notice('unplug'));
}

// --- settings and tray -------------------------------------------------------------------------

function update(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };
  // the main character is not its own friend (a new choice of character takes it off the list), and the list has a limit
  settings.friends = sanitizeFriends(settings.friends, settings.skin);
  saveSettings(settings);
  if (patch.autoStart !== undefined) applyAutoStart();
  if (patch.autoUpdate !== undefined) updates?.setBackground(settings.autoUpdate);
  stage.setSettings(settings);
  if (patch.windows !== undefined) {
    if (settings.windows) pollPerch();
    else publishWindows([]);
  }
  tellAll(IPC.settings, settings);
  if (patch.monitor !== undefined) syncDisplaysSoon(0);
  void rebuildMenu();
}

/** A pet that pulls at the mouse moves the real cursor: a point of the pets' space, put where it is on the screen (which is scaled differently). */
function moveCursor(p: { x: number; y: number }): void {
  const at = screen.dipToScreenPoint({ x: p.x, y: p.y });
  if (!cursorControl?.set(at.x, at.y)) log('warn', 'the cursor could not be moved');
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

/** "1. 1920x1080 (main)" — the real pixel size, since the shared coordinates are scaled. */
function monitorLabel(d: DisplayInfo, number: number): string {
  const s = t();
  const size = `${Math.round(d.bounds.width * d.scaleFactor)}x${Math.round(d.bounds.height * d.scaleFactor)}`;
  return s.monitorItem(number, size, d.primary);
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
  const displays = readDisplays();
  // a chosen monitor that is unplugged is shown as the main one, which is where the pet is then
  const monitor = /^\d+$/.test(settings.monitor) && !displays.some((d) => String(d.id) === settings.monitor) ? MONITOR_PRIMARY : settings.monitor;
  const monitors: MenuItemConstructorOptions[] =
    displays.length > 1 || settings.monitor !== MONITOR_ALL
      ? [
          {
            label: s.monitor,
            submenu: [
              radio(s.monitorAll, MONITOR_ALL, monitor, (m) => update({ monitor: m })),
              radio(s.monitorPrimary, MONITOR_PRIMARY, monitor, (m) => update({ monitor: m })),
              ...(displays.length > 1 ? [{ type: 'separator' } as MenuItemConstructorOptions] : []),
              ...(displays.length > 1 ? displays.map((d, i) => radio(monitorLabel(d, i + 1), String(d.id), monitor, (m) => update({ monitor: m }))) : []),
            ],
          },
        ]
      : [];
  // any other character can come along as a friend, up to a limit; with nobody else to choose there is no menu
  const others = skins.filter((sk) => sk.id !== settings.skin);
  const full = settings.friends.length >= MAX_FRIENDS;
  const friends: MenuItemConstructorOptions[] =
    others.length > 0
      ? [
          {
            label: s.friends,
            submenu: [
              ...others.map(
                (sk): MenuItemConstructorOptions => ({
                  label: sk.name,
                  type: 'checkbox',
                  checked: settings.friends.includes(sk.id),
                  enabled: settings.friends.includes(sk.id) || !full,
                  click: (i) => update({ friends: i.checked ? [...settings.friends, sk.id] : settings.friends.filter((id) => id !== sk.id) }),
                }),
              ),
              ...(full ? [{ type: 'separator' } as MenuItemConstructorOptions, { label: s.friendsFull(MAX_FRIENDS), enabled: false } as MenuItemConstructorOptions] : []),
            ],
          },
        ]
      : [];
  const updateItem = updates?.menuItem() ?? null;
  lastMenu = Menu.buildFromTemplate([
    { label: `${s.call} (${shortcutLabel(CALL_KEY)})`, click: () => callPet() },
    { label: `${stage.isHidden ? s.show : s.hide} (${shortcutLabel(HIDE_KEY)})`, click: () => toggleHidden() },
    ...(stage.hasActions ? [{ label: s.perform, enabled: !stage.isHidden, click: () => performTrick() } as MenuItemConstructorOptions] : []),
    { type: 'separator' },
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
    ...monitors,
    {
      label: s.speech,
      submenu: [
        radio<SpeechLevel>(s.speechAll, 'all', settings.speech, (speech) => update({ speech })),
        radio<SpeechLevel>(s.speechReactions, 'reactions', settings.speech, (speech) => update({ speech })),
        radio<SpeechLevel>(s.speechOff, 'off', settings.speech, (speech) => update({ speech })),
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
    ...friends,
    { label: s.makeSkin, click: () => openMaker() },
    { type: 'separator' },
    { label: s.clickThrough, type: 'checkbox', checked: settings.clickThrough, click: (i) => update({ clickThrough: i.checked }) },
    // only a skin with tricks has anything to switch off
    ...(stage.hasActions
      ? [{ label: s.tricksAuto, type: 'checkbox', checked: settings.tricks, click: (i) => update({ tricks: i.checked }) } as MenuItemConstructorOptions]
      : []),
    // only where the windows of other programs can be read (Windows)
    ...(perchSource
      ? [{ label: s.windows, type: 'checkbox', checked: settings.windows, click: (i) => update({ windows: i.checked }) } as MenuItemConstructorOptions]
      : []),
    // an experiment, and only where the cursor can be moved (Windows)
    ...(stageDeps.setCursor
      ? [{ label: s.attention, type: 'checkbox', checked: settings.attention, click: (i) => update({ attention: i.checked }) } as MenuItemConstructorOptions]
      : []),
    { label: s.autoStart, type: 'checkbox', checked: settings.autoStart, click: (i) => update({ autoStart: i.checked }) },
    // only a build that can update itself has something to switch off
    ...(updates?.mode === 'auto'
      ? [{ label: s.updateAuto, type: 'checkbox', checked: settings.autoUpdate, click: (i) => update({ autoUpdate: i.checked }) } as MenuItemConstructorOptions]
      : []),
    { type: 'separator' },
    ...(updateItem ? [updateItem] : []),
    { label: s.whatsNew, click: () => void shell.openExternal(releasePage(app.getVersion())) },
    { type: 'separator' },
    { label: `${s.quit} (${shortcutLabel(QUIT_KEY)})`, click: () => app.quit() },
  ]);
  tray.setContextMenu(lastMenu);
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(path.join(app.getAppPath(), 'assets', 'tray.png')));
  // the version in the tip tells at a glance whether an update has gone through
  tray.setToolTip(`Desktop Buddy v${app.getVersion()}`);
  // Windows only opens the menu on right click by default
  tray.on('click', () => tray?.popUpContextMenu());
  void rebuildMenu();
}

interface MenuDescription {
  label: string;
  type: string;
  checked: boolean;
  enabled: boolean;
  submenu?: MenuDescription[];
}

function describeMenu(menu: Menu | null): MenuDescription[] {
  return (menu?.items ?? []).map((i) => ({
    label: i.label,
    type: i.type,
    checked: i.checked,
    enabled: i.enabled,
    ...(i.submenu ? { submenu: describeMenu(i.submenu) } : {}),
  }));
}

/** Handles for the end-to-end tests. Only an unpackaged run (never an installed app) gets them. */
function exposeTestHooks(): void {
  if (app.isPackaged || !process.env.BUDDY_TEST) return;
  (globalThis as Record<string, unknown>).__buddyTest = {
    /** replaces the monitors with made-up ones (or the real ones again with null) */
    setDisplays: (list: unknown) => {
      setFakeDisplays(list === null ? null : parseFakeDisplays(list));
      syncDisplaysSoon(0);
    },
    settings: () => settings,
    update: (patch: Partial<Settings>) => update(patch),
    say: (event: SayEvent) => stage.say(event),
    /** hiding and calling, as the tray and the shortcuts do it */
    hide: (hidden: boolean) => setHidden(hidden),
    hidden: () => stage.isHidden,
    call: () => callPet(),
    /** does a trick (one by name, or any) and says whether there was one to do */
    perform: (name?: string) => stage.perform(name),
    hasActions: () => stage.hasActions,
    /** what the computer tells the pet: a notice, or a battery report as an overlay sends it */
    notice: (event: NoticeEvent) => stage.notice(event),
    battery: (raw: unknown) => onBattery(raw),
    /** the update machinery: state, mode, and a local feed to look at in place of GitHub */
    updates: {
      mode: () => updates?.mode ?? null,
      state: () => updates?.state ?? null,
      useFeed: (url: string) => updates?.useTestFeed(url),
      checkNow: () => updates?.checkNow(),
    },
    /** the notice of what an update changed, with its text captured instead of shown */
    whatsNew: (wasReturning: boolean): Announced | null => announceChanges(wasReturning, () => {}),
    /** the tray menu as it is now: label, type, checked, enabled, submenu */
    menu: () => describeMenu(lastMenu),
    /** clicks an item of the tray menu, found by the labels on the way to it; false when there is none (or it is switched off) */
    clickMenu: (...labels: string[]): boolean => {
      let items = lastMenu?.items ?? [];
      for (const [i, label] of labels.entries()) {
        const item = items.find((x) => x.label === label);
        if (!item || !item.enabled) return false;
        if (i === labels.length - 1) {
          item.click();
          return true;
        }
        items = item.submenu?.items ?? [];
      }
      return false;
    },
    /** the windows of other programs: made-up ones in place of the system's (or the system's again with null), in the pets' own pixels */
    perch: {
      fake: (list: RawWindow[] | null) => {
        fakeWindows = list;
        perchSource = list === null ? systemSource : { list: () => list, toDip: (r) => r, frames: (ids) => list.filter((w) => ids.includes(w.id)) };
        void rebuildMenu();
        pollPerch();
      },
      platforms: () => stage.platformList,
      sides: () => stage.sideList,
      perches: () => stage.perches,
      attachments: () => stage.attachments,
      /** the pets (of one skin, or all) that stand on a window look over its top edge now */
      lookOver: (id?: string) => stage.lookOver(id),
      /** moves a made-up window in the list without anyone being told: only what watches the windows closely can notice (the end-to-end tests of that) */
      shift: (id: string, dx: number, dy: number) => {
        const list = fakeWindows;
        const w = list?.find((x) => x.id === id);
        if (!w) return false;
        w.left += dx;
        w.right += dx;
        w.top += dy;
        w.bottom += dy;
        return true;
      },
    },
    /** a pet that pulls at the mouse: a cursor of the tests' own (not the real one) that the pets may move, and the pet sent out at once */
    attention: {
      fake: (at: { x: number; y: number } | null) => {
        fakeCursor = at ? { x: at.x, y: at.y } : null;
        fakeBusy = false;
        stageDeps.cursor = () => fakeCursor ?? screen.getCursorScreenPoint();
        if (fakeCursor) {
          stageDeps.setCursor = (p) => {
            fakeCursor = { x: p.x, y: p.y };
          };
          stageDeps.cursorBusy = () => fakeBusy;
        } else if (cursorControl) {
          stageDeps.setCursor = moveCursor;
          stageDeps.cursorBusy = () => cursorControl?.busy() ?? false;
        } else {
          delete stageDeps.setCursor;
          delete stageDeps.cursorBusy;
        }
        stage.setSettings(settings);
        void rebuildMenu();
      },
      /** the fake cursor moved as somebody's hand would move it (the pets do not hear of it except through the cursor) */
      move: (p: { x: number; y: number }) => {
        if (fakeCursor) fakeCursor = { x: p.x, y: p.y };
      },
      cursor: () => fakeCursor,
      busy: (on: boolean) => {
        fakeBusy = on;
      },
      now: () => stage.seekAttention(),
      seeking: () => stage.seekingAttention,
    },
    view: () => (stage.view ? { ...stage.view, particles: [...stage.view.particles] } : null),
    /** every pet that is on the screens: the main character first, then its friends */
    views: () => stage.views.map(({ id, view }) => ({ id, ...view, particles: [...view.particles] })),
    /** how big each of them looks: the picture's size, the scale it is drawn at, and the two multiplied */
    sizes: () => stage.sizes,
    /** everybody hides behind the wall (as three clicks on a pet do), and comes out again; who is hiding */
    hideAtWall: (origin?: string) => stage.hideAtWall(origin),
    findAll: () => stage.findAll(),
    hiding: () => stage.hiding,
    windows: () =>
      [...overlays.values()].map((o) => ({
        id: o.displayId,
        area: o.area,
        bounds: o.alive ? o.win.getBounds() : null,
        ready: o.ready,
        ignoring: o.ignoring,
        url: o.alive ? o.win.webContents.getURL() : '',
      })),
  };
}

// --- lifecycle -----------------------------------------------------------------------------------

async function boot(): Promise<void> {
  app.setAppUserModelId(APP_ID);
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  // an app that ran here before has made its skins folder; a first start has not (read before it is made)
  const returning = existsSync(userSkinsDir());
  ensureUserSkinsDir();
  settings = loadSettings();
  // a friend whose skin folder has been taken away since last time cannot come along
  const known = new Set((await listSkins()).map((sk) => sk.id));
  settings = { ...settings, friends: settings.friends.filter((id) => known.has(id)) };
  cursorControl = openWin32Cursor((message) => log('warn', message));
  stageDeps = {
    cursor: () => screen.getCursorScreenPoint(),
    covered: makerCovers,
    log: (message) => log('info', message),
    ...(cursorControl ? { setCursor: moveCursor, cursorBusy: () => cursorControl?.busy() ?? false } : {}),
  };
  stage = new Stage(stageDeps, settings);
  registerProtocol();
  registerIpc();
  registerMakerIpc({
    onSaved: (id) => {
      // a skin that is on screen right now (as the main character or a friend) is re-read; the tray list picks up new ones
      if (settings.skin === id || settings.friends.includes(id)) tellAll(IPC.reloadSkin, undefined);
      void rebuildMenu();
    },
    apply: (skin) => update({ skin }),
  });
  applyAutoStart();
  try {
    syncDisplays();
  } catch (err) {
    // the tray still works without a pet on screen, and the next change of monitors tries again
    log('error', `could not open the overlays: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  }
  systemSource = openWin32Source(
    process.pid,
    (r) => {
      const d = screen.screenToDipRect(null, { x: r.x, y: r.y, width: r.w, height: r.h });
      return { x: d.x, y: d.y, w: d.width, h: d.height };
    },
    (message) => log('warn', message),
  );
  perchSource = systemSource;
  updates = createUpdates(() => void rebuildMenu());
  updates.setBackground(settings.autoUpdate);
  createTray();
  // a development run has no update to tell about; the end-to-end tests ask for it themselves
  if (app.isPackaged) announceChanges(returning);
  startLoop();
  screen.on('display-added', () => syncDisplaysSoon());
  screen.on('display-removed', () => syncDisplaysSoon());
  screen.on('display-metrics-changed', () => syncDisplaysSoon());
  exposeTestHooks();
  watchPower();
  for (const [key, action] of [
    [QUIT_KEY, () => app.quit()],
    [HIDE_KEY, toggleHidden],
    [CALL_KEY, callPet],
  ] as const) {
    if (!globalShortcut.register(shortcut(key), action)) log('warn', `could not register ${shortcut(key)}`);
  }
  log('info', `started v${app.getVersion()} (electron ${process.versions.electron}, ${process.platform}, screens ${describeAreas(overlays.values())})`);
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

// The pet lives in the tray: a moment without any overlay (the monitors are being swapped) must not end the app.
app.on('window-all-closed', () => {});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  updates?.dispose();
});
process.on('uncaughtException', (err) => log('error', `uncaught: ${err.stack ?? err.message}`));
process.on('unhandledRejection', (reason) => log('error', `unhandled rejection: ${String(reason)}`));
