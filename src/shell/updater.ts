import { app, Notification, shell, type MenuItemConstructorOptions } from 'electron';
import { autoUpdater } from 'electron-updater';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  hasUninstaller,
  UpdateController,
  updateMenuItem,
  updateMode,
  type UpdateMode,
  type UpdaterPort,
  type UpdateState,
} from '../shared/update';
import { t } from './i18n';
import { log } from './log';

/** Where a build that cannot update itself (the portable zip) sends the user. */
const RELEASES_URL = 'https://github.com/catdevdog/chiikawa/releases/latest';

/** The installer leaves "Uninstall <product>.exe" beside the app; the portable zip has no such file. */
function installedBuild(): boolean {
  try {
    return hasUninstaller(readdirSync(path.dirname(process.execPath)));
  } catch {
    return false;
  }
}

const say = (message: unknown): string => (typeof message === 'string' ? message : JSON.stringify(message));

/** The real updater behind the controller's port. Only called for a build that updates itself. */
function realPort(): UpdaterPort {
  // the updater is created on first use; builds that never update never touch it
  const u = autoUpdater;
  u.autoDownload = true;
  // quitting from the tray installs what has been downloaded, even if nobody pressed "install and restart"
  u.autoInstallOnAppQuit = true;
  u.allowPrerelease = false;
  u.allowDowngrade = false;
  // the installer is a plain file next to latest.yml; a feed has no business pointing at a web installer
  u.disableWebInstaller = true;
  u.logger = {
    info: (m) => log('info', `[updater] ${say(m)}`),
    warn: (m) => log('warn', `[updater] ${say(m)}`),
    error: (m) => log('error', `[updater] ${say(m)}`),
  };
  return {
    listen(events) {
      u.on('checking-for-update', () => events.checking());
      u.on('update-available', (info) => events.available(info.version));
      u.on('update-not-available', () => events.notAvailable());
      u.on('download-progress', (p) => events.progress(p.percent));
      u.on('update-downloaded', (info) => events.downloaded(info.version));
      u.on('error', (err) => events.error(err instanceof Error ? err.message : String(err)));
    },
    async check() {
      const result = await u.checkForUpdates();
      // a failed download is reported through the 'error' event; keep its rejected promise from going unhandled
      result?.downloadPromise?.catch(() => {});
    },
    install: () => u.quitAndInstall(true, true),
  };
}

function announceReady(version: string): void {
  try {
    if (!Notification.isSupported()) return;
    new Notification({ title: 'Desktop Buddy', body: t().updateReadyBody(version), silent: true }).show();
  } catch (err) {
    log('warn', `could not show the update notice: ${String(err)}`);
  }
}

export interface Updates {
  readonly mode: UpdateMode;
  readonly state: UpdateState;
  /** looks now and then in the background (the "check for updates automatically" setting) */
  setBackground(on: boolean): void;
  checkNow(): void;
  installNow(): boolean;
  /** the tray's update entry, or null when this build has none */
  menuItem(): MenuItemConstructorOptions | null;
  /** end-to-end tests only: act as an installed build that looks at a local feed */
  useTestFeed(url: string): void;
  dispose(): void;
}

/**
 * Updating the installed app. An installed Windows build downloads newer versions from the GitHub releases in the
 * background and offers to install them from the tray; the portable zip only gets a menu entry that opens the
 * releases page; a development run does nothing. `onChange` is called when the tray entry has to be redrawn.
 */
export function createUpdates(onChange: () => void): Updates {
  let mode = updateMode({ packaged: app.isPackaged, platform: process.platform, installed: installedBuild() });
  let controller: UpdateController | null = null;
  let background = false;
  let startFailed = false;

  const start = (): UpdateController => {
    const c = new UpdateController({ port: realPort(), onChange, onReady: announceReady, log });
    c.setBackground(background);
    return c;
  };
  if (mode === 'auto') {
    try {
      controller = start();
    } catch (err) {
      // a broken updater must never keep the pet from starting; the menu still points at the releases page
      log('error', `could not start the updater: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      mode = 'link';
      startFailed = true;
    }
  }
  const why = mode === 'auto' ? '' : startFailed ? ' (the updater did not start)' : app.isPackaged ? ' (not an installed Windows build)' : ' (development run)';
  log('info', `updates: ${mode}${why}`);

  return {
    get mode() {
      return mode;
    },
    get state() {
      return controller?.state ?? { kind: 'idle' };
    },
    setBackground(on) {
      background = on;
      controller?.setBackground(on);
    },
    checkNow: () => controller?.checkNow(),
    installNow: () => controller?.installNow() ?? false,
    menuItem() {
      const item = updateMenuItem(controller?.state ?? { kind: 'idle' }, mode, app.getVersion(), t());
      if (!item) return null;
      return {
        label: item.label,
        enabled: item.enabled,
        click: () => {
          if (item.action === 'check') controller?.checkNow();
          else if (item.action === 'install') controller?.installNow();
          else if (item.action === 'open') void shell.openExternal(RELEASES_URL);
        },
      };
    },
    useTestFeed(url) {
      if (app.isPackaged) return;
      // the config an installed build reads from resources/app-update.yml, written where a development run can find it
      const file = path.join(app.getPath('userData'), 'dev-app-update.yml');
      writeFileSync(file, `provider: generic\nurl: ${url}\nupdaterCacheDirName: desktop-buddy-updater-test\n`);
      autoUpdater.forceDevUpdateConfig = true;
      autoUpdater.updateConfigPath = file;
      mode = 'auto';
      controller ??= start();
      onChange();
    },
    dispose: () => controller?.dispose(),
  };
}
