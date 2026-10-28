import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('kvaDesktop', Object.freeze({
  get version(): string { return ipcRenderer.sendSync('app:version'); },
  readSession: (): string | null => ipcRenderer.sendSync('session:read'),
  writeSession: (value: string | null): boolean => ipcRenderer.sendSync('session:write', value),
  notify: (value: {id: string; title: string; body: string; target: string}): Promise<boolean> => ipcRenderer.invoke('notification:show', value),
  clearNotifications: (target?: string): void => ipcRenderer.send('notification:clear', target),
  onNotificationOpen: (callback: (target: string) => void): (() => void) => {
    const listener = (_event: unknown, target: string) => callback(target);
    ipcRenderer.on('notification:open', listener);
    return () => ipcRenderer.removeListener('notification:open', listener);
  }
}));
