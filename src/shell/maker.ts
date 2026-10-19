import { app, BrowserWindow, ipcMain, nativeTheme, screen, type IpcMainInvokeEvent } from 'electron';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isSkinId } from '../shared/ids.ts';
import { validateSkinPayload } from '../shared/skin-payload.ts';
import { IPC } from '../shared/types';
import { log } from './log';
import { listSkins, userSkinsDir } from './skins';

const MAKER_URL = 'buddy://app/maker.html';
let makerWindow: BrowserWindow | null = null;

/** Opens the skin maker, or brings the open one to the front. */
export function openMaker(): void {
  if (makerWindow && !makerWindow.isDestroyed()) {
    if (makerWindow.isMinimized()) makerWindow.restore();
    makerWindow.focus();
    return;
  }
  // laptop screens are smaller than the design size
  const { width, height } = screen.getPrimaryDisplay().workArea;
  makerWindow = new BrowserWindow({
    width: Math.min(1280, width),
    height: Math.min(860, height),
    minWidth: Math.min(900, width),
    minHeight: Math.min(600, height),
    title: '스킨 메이커',
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14181f' : '#f4f6fa',
    webPreferences: {
      preload: path.join(__dirname, 'maker-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  makerWindow.removeMenu();
  const wc = makerWindow.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => {
    if (url !== MAKER_URL) e.preventDefault();
  });
  wc.on('render-process-gone', (_e, d) => log('error', `maker renderer gone: ${d.reason}`));
  makerWindow.on('closed', () => {
    makerWindow = null;
  });
  void makerWindow.loadURL(MAKER_URL);
}

/**
 * True while the maker is the window being worked in and the screen point is over it. The always-on-top pet
 * must not steal clicks from the maker's controls then (it stays visible, the click goes to the window below).
 */
export function makerCovers(p: { x: number; y: number }): boolean {
  if (!makerWindow || makerWindow.isDestroyed() || makerWindow.isMinimized() || !makerWindow.isFocused()) return false;
  const b = makerWindow.getBounds();
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}

const fromMaker = (e: IpcMainInvokeEvent): boolean =>
  !!makerWindow && e.sender === makerWindow.webContents && !!e.senderFrame && e.senderFrame.url.startsWith(MAKER_URL);

export type SaveResult = { ok: true; where: string } | { ok: false; error: string };

export interface MakerHooks {
  /** a skin folder was (re)written */
  onSaved(id: string): void;
  /** the maker asked the pet to start using a skin */
  apply(id: string): void;
}

/**
 * Writes a skin to <userData>/skins/<id>. The request is validated first (id, file names, sizes, manifest),
 * and the files go to a temporary folder before replacing the old skin, so a failed save never leaves half a skin.
 */
async function saveSkin(raw: unknown, hooks: MakerHooks): Promise<SaveResult> {
  const checked = validateSkinPayload(raw);
  if (!checked.ok) return { ok: false, error: checked.error };
  const { id, files } = checked.payload;
  const dir = path.join(userSkinsDir(), id);
  const tmp = path.join(app.getPath('userData'), `skin-upload-${process.pid}`);
  try {
    await rm(tmp, { recursive: true, force: true });
    await mkdir(tmp, { recursive: true });
    for (const f of files) await writeFile(path.join(tmp, f.name), f.data);
    await mkdir(userSkinsDir(), { recursive: true });
    await rm(dir, { recursive: true, force: true });
    await rename(tmp, dir);
    log('info', `saved skin "${id}" (${files.length} files) to ${dir}`);
    hooks.onSaved(id);
    return { ok: true, where: dir };
  } catch (err) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    log('error', `saving skin "${id}" failed: ${String(err)}`);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function registerMakerIpc(hooks: MakerHooks): void {
  ipcMain.handle(IPC.makerExisting, async (e) => {
    if (!fromMaker(e)) throw new Error('untrusted sender');
    return (await listSkins()).map((s) => s.id);
  });
  ipcMain.handle(IPC.makerSave, async (e, raw: unknown): Promise<SaveResult> => {
    if (!fromMaker(e)) throw new Error('untrusted sender');
    return saveSkin(raw, hooks);
  });
  ipcMain.handle(IPC.makerApply, async (e, id: unknown) => {
    if (!fromMaker(e)) throw new Error('untrusted sender');
    if (!isSkinId(id) || !(await listSkins()).some((s) => s.id === id)) throw new Error('unknown skin');
    hooks.apply(id);
  });
}
