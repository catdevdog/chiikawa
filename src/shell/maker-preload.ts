import { contextBridge, ipcRenderer } from 'electron';
import type { SkinPayload } from '../shared/skin-payload';
import { IPC } from '../shared/types';

// The skin maker window gets exactly these three calls; the pet overlay has none of them.
contextBridge.exposeInMainWorld('buddyMaker', {
  existing: (): Promise<string[]> => ipcRenderer.invoke(IPC.makerExisting),
  save: (payload: SkinPayload) => ipcRenderer.invoke(IPC.makerSave, payload),
  apply: (id: string): Promise<void> => ipcRenderer.invoke(IPC.makerApply, id),
});
