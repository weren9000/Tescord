import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('kvaDesktop', Object.freeze({
  version: '0.2.0',
  readSession: (): string | null => ipcRenderer.sendSync('session:read'),
  writeSession: (value: string | null): boolean => ipcRenderer.sendSync('session:write', value)
}));
