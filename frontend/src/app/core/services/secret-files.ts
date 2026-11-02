/** File keys and names travel only inside authenticated secret messages. */
export const SECRET_CHUNK = 1024 * 1024;
export const SECRET_MAX_FILE = 500 * 1024 * 1024;
export interface SecretAttachment {
  version: 1;
  id: string;
  key: string;
  name: string;
  type: string;
  size: number;
  chunks: number;
}

export function validAttachment(value: unknown): value is SecretAttachment {
  if (!value || typeof value !== 'object') return false;
  const a = value as SecretAttachment;
  return (
    a.version === 1 &&
    /^[a-f0-9-]{36}$/.test(a.id) &&
    /^[A-Za-z0-9+/]{43}=$/.test(a.key) &&
    typeof a.name === 'string' &&
    a.name.length > 0 &&
    a.name.length <= 255 &&
    typeof a.type === 'string' &&
    a.type.length <= 127 &&
    Number.isSafeInteger(a.size) &&
    a.size >= 0 &&
    a.size <= SECRET_MAX_FILE &&
    a.chunks === Math.max(1, Math.ceil(a.size / SECRET_CHUNK))
  );
}

export function describeFile(file: File): SecretAttachment {
  if (file.size > SECRET_MAX_FILE) throw new Error('Максимальный размер файла — 500 МБ.');
  return {
    version: 1,
    id: crypto.randomUUID(),
    key: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
    name: file.name.slice(0, 255) || 'Файл',
    type: file.type.slice(0, 127),
    size: file.size,
    chunks: Math.max(1, Math.ceil(file.size / SECRET_CHUNK)),
  };
}

export async function fileCipher(a: SecretAttachment): Promise<CryptoKey> {
  if (!validAttachment(a)) throw new Error('Некорректное зашифрованное вложение.');
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(a.key), (c) => c.charCodeAt(0)),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}

function parameters(a: SecretAttachment, index: number): AesGcmParams {
  if (!Number.isInteger(index) || index < 0 || index >= a.chunks)
    throw new Error('Некорректная часть файла.');
  const iv = new Uint8Array(12);
  new DataView(iv.buffer).setUint32(8, index);
  return {
    name: 'AES-GCM',
    iv,
    tagLength: 128,
    additionalData: new TextEncoder().encode(
      `kvachat-secret-file-v1:${a.id}:${a.size}:${a.chunks}:${index}`,
    ),
  };
}

export async function encryptFileChunk(
  a: SecretAttachment,
  key: CryptoKey,
  file: File,
  index: number,
): Promise<ArrayBuffer> {
  return crypto.subtle.encrypt(
    parameters(a, index),
    key,
    await file.slice(index * SECRET_CHUNK, (index + 1) * SECRET_CHUNK).arrayBuffer(),
  );
}

export async function decryptFileChunk(
  a: SecretAttachment,
  key: CryptoKey,
  data: ArrayBuffer,
  index: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const expected = Math.min(SECRET_CHUNK, a.size - index * SECRET_CHUNK);
  if (data.byteLength !== expected + 16)
    throw new Error('Размер зашифрованного файла не совпадает.');
  try {
    return new Uint8Array(await crypto.subtle.decrypt(parameters(a, index), key, data));
  } catch {
    throw new Error('Файл повреждён или ключ не совпадает. Скачивание остановлено.');
  }
}

export interface SecretFileSink {
  write(data: Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

/** Called directly from the click handler so native/browser pickers keep user activation. */
export async function chooseFileSink(a: SecretAttachment): Promise<SecretFileSink | null> {
  const name =
    Array.from(a.name, (c) => (c.charCodeAt(0) < 32 ? '_' : c))
      .join('')
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/[. ]+$/, '') || 'Файл';
  const native = window.kvaDesktop;
  if (native) {
    if (!native.beginSecretDownload || !native.writeSecretDownload || !native.endSecretDownload)
      throw new Error('Обновите приложение для скачивания секретных файлов.');
    const id = await native.beginSecretDownload(name, a.size);
    if (!id) return null;
    let index = 0;
    return {
      write: async (data) => {
        if (!(await native.writeSecretDownload!(id, index++, data)))
          throw new Error('Не удалось записать файл.');
      },
      close: async () => {
        if (!(await native.endSecretDownload!(id, true)))
          throw new Error('Не удалось сохранить файл.');
      },
      abort: async () => {
        await native.endSecretDownload!(id, false);
      },
    };
  }
  const picker = (
    window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName: string;
      }) => Promise<{ createWritable(): Promise<FileSystemWritableFileStream> }>;
    }
  ).showSaveFilePicker;
  if (picker) {
    try {
      return await (await picker({ suggestedName: name })).createWritable();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      throw error;
    }
  }
  // Bounded fallback for browsers without streaming file output.
  if (a.size > 8 * 1024 * 1024)
    throw new Error(
      'Для скачивания файлов больше 8 МБ откройте Квачат в Chrome, Edge или приложении.',
    );
  const parts: Uint8Array<ArrayBuffer>[] = [];
  return {
    write: async (data) => {
      parts.push(data);
    },
    close: async () => {
      const url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      parts.length = 0;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    abort: async () => {
      parts.length = 0;
    },
  };
}
