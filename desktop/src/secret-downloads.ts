import { BrowserWindow, dialog, ipcMain, IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Explicit exports only; renderer never supplies a filesystem path. */
export function registerSecretDownloads(isMain: (event: IpcMainInvokeEvent) => boolean, window: () => BrowserWindow | null): () => void {
  const active = new Map<string, { fd: number; temporary: string; destination: string; size: number; written: number; index: number }>();
  let picking = false;
  const discard = (id: string) => {
    const item = active.get(id); if (!item) return;
    active.delete(id);
    try { fs.closeSync(item.fd); } catch {}
    try { fs.unlinkSync(item.temporary); } catch {}
  };
  ipcMain.handle('secret-download:begin', async (event, name: unknown, size: unknown) => {
    if (!isMain(event) || !window() || picking || active.size || typeof name !== 'string' || name.length > 255 || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > 500*1024*1024) return null;
    picking = true;
    try {
      const result = await dialog.showSaveDialog(window()!, { defaultPath: name.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_'), title: 'Сохранить секретный файл' });
      if (result.canceled || !result.filePath || !isMain(event)) return null;
      const id = randomUUID();
      const temporary = path.join(path.dirname(result.filePath), '.kva-download-' + id + '.part');
      const fd = fs.openSync(temporary, 'wx', 0o600);
      active.set(id, { fd, temporary, destination: result.filePath, size, written: 0, index: 0 });
      return id;
    } catch { return null; }
    finally { picking = false; }
  });
  ipcMain.handle('secret-download:write', (event, id: string, index: number, data: unknown) => {
    if (!isMain(event)) return false;
    const item = active.get(id);
    if (!item || index !== item.index || !(data instanceof Uint8Array) || data.byteLength > 1024*1024 || item.written + data.byteLength > item.size) return false;
    try { let offset = 0; while (offset < data.byteLength) { const n = fs.writeSync(item.fd, data, offset, data.byteLength-offset); if (!n) throw new Error(); offset += n; }
      item.index++; item.written += data.byteLength; return true; }
    catch { discard(id); return false; }
  });
  ipcMain.handle('secret-download:end', (event, id: string, commit: unknown) => {
    if (!isMain(event)) return false;
    const item = active.get(id); if (!item) return false;
    if (commit !== true) { discard(id); return true; }
    try {
      if (item.written !== item.size) throw new Error();
      fs.fsyncSync(item.fd); fs.closeSync(item.fd); item.fd = -1;
      fs.renameSync(item.temporary, item.destination); active.delete(id); return true;
    } catch { discard(id); return false; }
  });
  return () => { for (const id of active.keys()) discard(id); };
}
