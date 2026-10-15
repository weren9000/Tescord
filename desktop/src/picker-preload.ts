import {contextBridge, ipcRenderer} from 'electron';
contextBridge.exposeInMainWorld('capturePicker', {
  sources: () => ipcRenderer.invoke('capture:sources'),
  choose: (id: string, audio: boolean) => ipcRenderer.send('capture:choose', id, audio),
  cancel: () => ipcRenderer.send('capture:cancel')
});
