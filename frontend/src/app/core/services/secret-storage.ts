/** Persistent message bodies are ciphertext; native vaults hold the store passphrase. */
export interface SecretVault {
  deviceId: string;
  passphrase: string;
  storeName: string;
}

const DATABASE = 'kvachat-secret-local-v1';
const TABLES = ['vaults', 'rooms', 'messages', 'outbox'] as const;
type Table = (typeof TABLES)[number];
let opening: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      for (const table of TABLES) request.result.createObjectStore(table);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Не удалось открыть защищённое хранилище.'));
  });
  return opening;
}

export async function secretRead<T>(table: Table, key: string): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(table).objectStore(table).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(new Error('Не удалось прочитать историю на устройстве.'));
  });
}

export async function secretWrite(table: Table, key: string, value: unknown): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(table, 'readwrite', { durability: 'strict' });
    transaction.objectStore(table).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(new Error('Не удалось сохранить данные. Проверьте свободное место.'));
  });
}

export async function secretDelete(table: Table, key: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(table, 'readwrite', { durability: 'strict' });
    transaction.objectStore(table).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(new Error('Не удалось удалить локальные данные.'));
  });
}

export async function secretList<T>(table: Table, prefix: string): Promise<T[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(table)
      .objectStore(table)
      .getAll(IDBKeyRange.bound(prefix, prefix + '\uffff'));
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(new Error('Не удалось прочитать локальную историю.'));
  });
}

interface BrowserVault {
  key: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}

export async function readVault(userId: string): Promise<SecretVault | undefined> {
  let raw: string | undefined;
  if (window.kvaDesktop) {
    if (!window.kvaDesktop.readSecretVault || !window.kvaDesktop.writeSecretVault) {
      throw new Error('Обновите приложение для работы с секретными чатами.');
    }
    raw = window.kvaDesktop.readSecretVault(userId) ?? undefined;
  } else {
    const stored = await secretRead<BrowserVault>('vaults', userId);
    if (stored) {
      raw = new TextDecoder().decode(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: stored.iv, additionalData: new TextEncoder().encode(userId) },
          stored.key,
          stored.ciphertext,
        ),
      );
    }
  }
  if (!raw) return undefined;
  const value = JSON.parse(raw) as SecretVault;
  if (
    !/^[a-f0-9-]{36}$/.test(value.deviceId) ||
    typeof value.passphrase !== 'string' ||
    value.passphrase.length < 40 ||
    value.storeName !== `kva-secret-${userId}-${value.deviceId}`
  ) {
    throw new Error('Ключи устройства повреждены. История не будет перезаписана.');
  }
  return value;
}

export async function createVault(userId: string): Promise<SecretVault> {
  const existing = await readVault(userId);
  if (existing) return existing;
  if ((await secretList('rooms', userId + ':')).length) {
    throw new Error('Ключи старой истории недоступны. Сначала отключите это секретное устройство.');
  }
  const deviceId = crypto.randomUUID();
  const value: SecretVault = {
    deviceId,
    passphrase: Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
    storeName: `kva-secret-${userId}-${deviceId}`,
  };
  const raw = JSON.stringify(value);
  if (window.kvaDesktop) {
    if (!window.kvaDesktop.writeSecretVault?.(userId, raw))
      throw new Error('Не удалось защитить ключи на устройстве.');
  } else {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(userId) },
      key,
      new TextEncoder().encode(raw),
    );
    await secretWrite('vaults', userId, { key, iv, ciphertext });
  }
  return value;
}

export async function clearSecretAccount(userId: string): Promise<void> {
  // Erase the vault first: this prevents reopening the encrypted crypto store.
  if (window.kvaDesktop?.writeSecretVault && !window.kvaDesktop.writeSecretVault(userId, null)) {
    throw new Error('Не удалось удалить ключи устройства.');
  }
  await secretDelete('vaults', userId);
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(['rooms', 'messages', 'outbox'], 'readwrite');
    for (const table of ['rooms', 'messages', 'outbox']) {
      transaction.objectStore(table).delete(IDBKeyRange.bound(userId + ':', userId + ':\uffff'));
    }
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(new Error('Не удалось удалить историю.'));
  });
  if (indexedDB.databases) {
    for (const db of await indexedDB.databases()) {
      if (db.name?.startsWith(`kva-secret-${userId}-`)) indexedDB.deleteDatabase(db.name);
    }
  }
}
