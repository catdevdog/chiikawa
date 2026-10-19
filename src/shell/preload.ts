import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type Area, type InitInfo, type PointerReport, type Settings, type SkinReport, type ViewFrame } from '../shared/types';

function on<T>(channel: string, cb: (payload: T) => void): void {
  ipcRenderer.on(channel, (_event, payload: T) => cb(payload));
}

// The renderer gets exactly these calls and nothing else from the main process.
contextBridge.exposeInMainWorld('buddyHost', {
  init: (): Promise<InitInfo> => ipcRenderer.invoke(IPC.init),
  onSettings: (cb: (s: Settings) => void) => on(IPC.settings, cb),
  onArea: (cb: (a: Area) => void) => on(IPC.area, cb),
  onView: (cb: (frame: ViewFrame | null) => void) => on(IPC.view, cb),
  onReloadSkin: (cb: () => void) => on(IPC.reloadSkin, cb),
  pointer: (report: PointerReport) => ipcRenderer.send(IPC.pointer, report),
  reportSkin: (skin: SkinReport) => ipcRenderer.send(IPC.skin, skin),
  log: (level: string, message: string) => ipcRenderer.send(IPC.log, level, message),
});
