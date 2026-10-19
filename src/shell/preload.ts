import { contextBridge, ipcRenderer } from 'electron';
import type { Vec2 } from '../engine/types';
import { IPC, type HitboxReport, type InitInfo, type Settings } from '../shared/types';

function on<T>(channel: string, cb: (payload: T) => void): void {
  ipcRenderer.on(channel, (_event, payload: T) => cb(payload));
}

// The renderer gets exactly these calls and nothing else from the main process.
contextBridge.exposeInMainWorld('buddyHost', {
  init: (): Promise<InitInfo> => ipcRenderer.invoke(IPC.init),
  onCursor: (cb: (p: Vec2) => void) => on(IPC.cursor, cb),
  onSettings: (cb: (s: Settings) => void) => on(IPC.settings, cb),
  onWorld: (cb: (w: { width: number; height: number }) => void) => on(IPC.world, cb),
  reportHitbox: (report: HitboxReport) => ipcRenderer.send(IPC.hitbox, report),
  setDragging: (dragging: boolean) => ipcRenderer.send(IPC.dragging, dragging),
  log: (level: string, message: string) => ipcRenderer.send(IPC.log, level, message),
});
