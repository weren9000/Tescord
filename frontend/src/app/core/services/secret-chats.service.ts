import { Injectable, OnDestroy, signal } from '@angular/core';
import { API_BASE_URL } from '../api/api-base';
import { AuthSessionResponse } from '../models/auth.models';
import type { SecretChat, SecretEngine, SecretMessage } from './secret-engine';
import { clearSecretAccount, readVault } from './secret-storage';
import {
  chooseFileSink,
  decryptFileChunk,
  describeFile,
  encryptFileChunk,
  fileCipher,
  SecretAttachment,
  validAttachment,
} from './secret-files';

export interface SecretPeerDevice {
  id: string;
  name: string;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class SecretChatsService implements OnDestroy {
  private readonly pushListener = (event: MessageEvent) => {
    if (event.data?.type === 'open_secret_chats') this.open();
  };
  constructor() {
    navigator.serviceWorker?.addEventListener('message', this.pushListener);
  }
  readonly enabled = signal(false);
  readonly ready = signal(false);
  readonly opened = signal(false);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly chats = signal<SecretChat[]>([]);
  readonly active = signal<SecretChat | null>(null);
  readonly messages = signal<SecretMessage[]>([]);
  readonly fingerprint = signal('');
  readonly verified = signal(false);
  readonly peerDevices = signal<SecretPeerDevice[]>([]);
  readonly choosingDevice = signal(false);
  readonly ownDevices = signal<SecretPeerDevice[]>([]);
  readonly managingDevices = signal(false);
  readonly transfer = signal<number | null>(null);
  readonly previews = signal<Record<string, string>>({});
  readonly drafts = new Map<string, string>();
  private transferAbort?: AbortController;
  private latestNotification = 0;
  private session: AuthSessionResponse | null = null;
  private engine?: SecretEngine;
  private releaseLease?: () => void;
  private queue: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private poll = setInterval(() => {
    if (this.ready() && !this.busy() && (!document.hidden || !!window.kvaDesktop))
      void this.refresh();
  }, 5000);

  configure(session: AuthSessionResponse | null): void {
    if (this.session?.access_token === session?.access_token) return;
    const epoch = ++this.epoch;
    this.session = session;
    this.ready.set(false);
    this.enabled.set(false);
    this.active.set(null);
    this.messages.set([]);
    this.chats.set([]);
    void this.serial(async () => {
      this.engine?.close();
      this.engine = undefined;
      this.release();
      if (!session || epoch !== this.epoch) return;
      const capability = await this.request<{ enabled: boolean }>(
        '/capabilities',
        undefined,
        'GET',
      );
      this.enabled.set(capability.enabled);
      if (!capability.enabled) return;
      if (!navigator.locks)
        throw new Error('Для секретных чатов требуется обновить браузер или приложение.');
      await new Promise<void>((resolve, reject) => {
        void navigator.locks
          .request(
            'kvachat-secret-engine-' + session.user.id,
            { ifAvailable: true },
            async (lock) => {
              if (!lock) {
                reject(
                  new Error(
                    'Секретные чаты уже открыты в другой вкладке. Закройте её и обновите эту страницу.',
                  ),
                );
                return;
              }
              const lease = new Promise<void>((done) => {
                this.releaseLease = done;
              });
              resolve();
              await lease;
            },
          )
          .catch(reject);
      });
      if (epoch !== this.epoch) {
        this.release();
        return;
      }
      const { SecretEngine } = await import('./secret-engine');
      this.engine = new SecretEngine(session.user.id, (path, body, method) =>
        this.request(path, body, method),
      );
      try {
        await this.engine.initialize();
      } catch (error) {
        this.engine.close();
        this.engine = undefined;
        this.release();
        throw error;
      }
      if (epoch !== this.epoch) return;
      this.ready.set(true);
      if (new URL(location.href).searchParams.get('secretChats') === '1') this.open();
      this.error.set('');
      await this.loadChats();
    });
  }

  async request<T>(
    path: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ): Promise<T> {
    const token = this.session?.access_token;
    if (!token) throw new Error('Войдите в аккаунт.');
    const deviceId = this.engine?.vault?.deviceId;
    const response = await fetch(API_BASE_URL + '/api/secret' + path, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: 'Bearer ' + token,
        ...(deviceId ? { 'X-Secret-Device': deviceId } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { detail?: unknown };
      throw Object.assign(
        new Error(
          typeof data.detail === 'string' ? data.detail : 'Не удалось выполнить защищённый обмен.',
        ),
        { status: response.status },
      );
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  private serial(action: () => Promise<void>, propagate = false): Promise<void> {
    const task = this.queue.then(async () => {
      this.busy.set(true);
      try {
        await action();
      } catch (error) {
        this.error.set(error instanceof Error ? error.message : 'Не удалось выполнить действие.');
        if (propagate) throw error;
      } finally {
        this.busy.set(false);
      }
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  private release(): void {
    this.releaseLease?.();
    this.releaseLease = undefined;
  }

  open(): void {
    this.opened.set(true);
  }
  close(): void {
    this.opened.set(false);
    this.choosingDevice.set(false);
    this.managingDevices.set(false);
  }

  manageDevices(): Promise<void> {
    this.managingDevices.set(true);
    return this.serial(async () => {
      this.ownDevices.set(await this.request<SecretPeerDevice[]>('/devices'));
    });
  }

  revokeDevice(id: string): Promise<void> {
    return this.serial(async () => {
      await this.request('/devices/' + id, undefined, 'DELETE');
      if (id === this.engine?.vault.deviceId) {
        this.engine.close();
        this.engine = undefined;
        this.ready.set(false);
        await clearSecretAccount(this.session!.user.id);
        this.release();
        this.clearMemory();
        this.error.set('Устройство отключено. Для нового секретного устройства обновите страницу.');
      }
      this.ownDevices.set(await this.request<SecretPeerDevice[]>('/devices'));
      await this.loadChats();
    });
  }

  endChat(): Promise<void> {
    return this.serial(async () => {
      const chat = this.active();
      if (!chat) return;
      await this.request(`/chats/${chat.id}`, undefined, 'DELETE');
      await this.loadChats();
      this.active.set(this.chats().find((c) => c.id === chat.id) ?? null);
    });
  }

  cancelTransfer(): void {
    this.transferAbort?.abort();
  }

  private async binary(path: string, data?: ArrayBuffer): Promise<ArrayBuffer> {
    const response = await fetch(API_BASE_URL + '/api/secret' + path, {
      method: data ? 'PUT' : 'GET',
      cache: 'no-store',
      signal: this.transferAbort?.signal,
      headers: {
        Authorization: 'Bearer ' + this.session?.access_token,
        'X-Secret-Device': this.engine!.vault.deviceId,
        ...(data ? { 'Content-Type': 'application/octet-stream' } : {}),
      },
      ...(data ? { body: data } : {}),
    });
    if (!response.ok) throw new Error('Файл недоступен или передача прервана.');
    return data ? new ArrayBuffer(0) : response.arrayBuffer();
  }

  upload(file: File): Promise<void> {
    return this.serial(async () => {
      const chat = this.active();
      if (!chat || !this.engine || !this.verified()) return;
      const a = describeFile(file);
      const key = await fileCipher(a);
      this.transferAbort = new AbortController();
      this.transfer.set(0);
      let published = false;
      try {
        await this.request(`/chats/${chat.id}/uploads`, {
          id: a.id,
          size_bytes: a.size + a.chunks * 16,
          chunk_count: a.chunks,
        });
        for (let i = 0; i < a.chunks; i++) {
          this.transferAbort.signal.throwIfAborted();
          await this.binary(
            `/uploads/${a.id}/chunks/${i}`,
            await encryptFileChunk(a, key, file, i),
          );
          this.transfer.set(Math.round(((i + 1) / a.chunks) * 100));
        }
        await this.request(`/uploads/${a.id}/complete`, {});
        // After persisting the encrypted message, failed delivery is retried by the outbox.
        published = true;
        await this.engine.send(chat, { kind: 'message', text: '', attachment: a });
        this.messages.set(await this.engine.history(chat));
        this.error.set('');
      } finally {
        if (!published)
          await this.request(`/uploads/${a.id}`, undefined, 'DELETE').catch(() => undefined);
        this.transfer.set(null);
        this.transferAbort = undefined;
      }
    });
  }

  async download(a: SecretAttachment): Promise<void> {
    if (!validAttachment(a) || this.busy()) return;
    try {
      const sink = await chooseFileSink(a);
      if (!sink) return;
      await this.serial(async () => {
        this.transferAbort = new AbortController();
        this.transfer.set(0);
        try {
          const key = await fileCipher(a);
          for (let i = 0; i < a.chunks; i++) {
            this.transferAbort.signal.throwIfAborted();
            await sink.write(
              await decryptFileChunk(a, key, await this.binary(`/uploads/${a.id}/chunks/${i}`), i),
            );
            this.transfer.set(Math.round(((i + 1) / a.chunks) * 100));
          }
          await sink.close();
          this.error.set('');
        } catch (error) {
          await sink.abort();
          throw error;
        } finally {
          this.transfer.set(null);
          this.transferAbort = undefined;
        }
      });
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Не удалось сохранить файл.');
    }
  }

  preview(a: SecretAttachment): Promise<void> {
    return this.serial(async () => {
      if (
        !validAttachment(a) ||
        a.size > 8 * 1024 * 1024 ||
        !/^image\/(png|jpeg|webp|gif)$/.test(a.type) ||
        this.previews()[a.id]
      )
        return;
      const key = await fileCipher(a);
      const parts: Uint8Array<ArrayBuffer>[] = [];
      for (let i = 0; i < a.chunks; i++)
        parts.push(
          await decryptFileChunk(a, key, await this.binary(`/uploads/${a.id}/chunks/${i}`), i),
        );
      this.previews.update((current) => {
        const entries = Object.entries(current);
        while (entries.length >= 4) URL.revokeObjectURL(entries.shift()![1]);
        return {
          ...Object.fromEntries(entries),
          [a.id]: URL.createObjectURL(new Blob(parts, { type: a.type })),
        };
      });
    });
  }

  private clearMemory(): void {
    for (const url of Object.values(this.previews())) URL.revokeObjectURL(url);
    this.previews.set({});
    this.messages.set([]);
    this.drafts.clear();
    this.latestNotification = 0;
  }

  async hasLocalKeys(userId: string): Promise<boolean> {
    if (window.kvaDesktop && !window.kvaDesktop.readSecretVault) return false;
    try {
      return !!(await readVault(userId));
    } catch {
      return true;
    }
  }

  async resetLocalDevice(): Promise<void> {
    const session = this.session;
    if (!session) return;
    await this.eraseForLogout(session.user.id);
    this.session = null;
    this.configure(session);
  }

  async choosePeer(userId: string): Promise<void> {
    this.open();
    this.choosingDevice.set(true);
    this.peerDevices.set([]);
    await this.serial(async () => {
      if (!this.ready()) throw new Error('Подождите подготовки защищённого устройства.');
      this.peerDevices.set(
        await this.request<SecretPeerDevice[]>('/devices?user_id=' + encodeURIComponent(userId)),
      );
    });
  }

  async create(deviceId: string): Promise<void> {
    await this.serial(async () => {
      const chat = await this.request<SecretChat>('/chats', { peer_device_id: deviceId });
      this.choosingDevice.set(false);
      await this.loadChats();
      await this.activate(chat);
    });
  }

  select(chat: SecretChat): Promise<void> {
    return this.serial(() => this.activate(chat));
  }

  private async activate(chat: SecretChat): Promise<void> {
    this.active.set(chat);
    this.messages.set([]);
    this.verified.set(false);
    this.fingerprint.set('');
    this.error.set('');
    if (!this.engine) throw new Error('Ключи устройства недоступны.');
    await this.engine.remember(chat);
    if (chat.closed_at || !chat.peer_available) {
      const fingerprint = await this.engine.savedFingerprint(chat);
      this.fingerprint.set(fingerprint);
      this.verified.set(!!fingerprint);
      if (fingerprint) this.messages.set(await this.engine.history(chat));
      return;
    }
    const fingerprint = await this.engine.fingerprint(chat);
    this.fingerprint.set(fingerprint);
    this.verified.set(await this.engine.isVerified(chat, fingerprint));
    if (chat.accepted_at && this.verified() && !chat.closed_at && chat.peer_available)
      await this.engine.synchronize(chat);
    if (this.verified()) this.messages.set(await this.engine.history(chat));
  }

  accept(): Promise<void> {
    return this.serial(async () => {
      const current = this.active();
      if (!current) return;
      const chat = await this.request<SecretChat>(`/chats/${current.id}/accept`, {});
      await this.loadChats();
      await this.activate(chat);
    });
  }

  verify(): Promise<void> {
    return this.serial(async () => {
      const chat = this.active();
      if (!chat || !this.engine) return;
      await this.engine.verify(chat, this.fingerprint());
      await this.activate(chat);
    });
  }

  async send(text: string, replyTo?: string, editId?: string): Promise<boolean> {
    let success = false;
    await this.serial(async () => {
      const chat = this.active();
      if (!chat || !this.engine) return;
      if (!text.trim() || text.length > 20000)
        throw new Error('Введите сообщение до 20 000 символов.');
      await this.engine.send(chat, {
        kind: editId ? 'edit' : 'message',
        text: text.trim(),
        ...(replyTo ? { replyTo } : {}),
        ...(editId ? { targetId: editId } : {}),
      });
      this.messages.set(await this.engine.history(chat));
      this.error.set('');
      success = true;
    });
    return success;
  }

  remove(message: SecretMessage): Promise<void> {
    return this.serial(async () => {
      const chat = this.active();
      if (!chat || !this.engine || message.senderId !== this.session?.user.id) return;
      await this.engine.send(chat, { kind: 'delete', text: '', targetId: message.id });
      this.messages.set(await this.engine.history(chat));
    });
  }

  refresh(): Promise<void> {
    return this.serial(async () => {
      await this.loadChats();
      await this.engine?.maintain();
      const unread = await this.request<{ latest: number }>('/unread');
      if (unread.latest > this.latestNotification) {
        this.latestNotification = unread.latest;
        if (!this.opened() || document.hidden)
          void window.kvaDesktop?.notify?.({
            id: 'secret-' + unread.latest,
            title: 'Квачат',
            body: 'Новое секретное сообщение',
            target: 'secret',
          });
      }
      const active = this.active();
      const chat = active && this.chats().find((chat) => chat.id === active.id);
      if (chat) this.active.set(chat);
      if (
        !chat ||
        !this.engine ||
        !this.verified() ||
        !chat.accepted_at ||
        chat.closed_at ||
        !chat.peer_available
      )
        return;
      this.active.set(chat);
      await this.engine.synchronize(chat);
      this.messages.set(await this.engine.history(chat));
    });
  }

  private async loadChats(): Promise<void> {
    if (!this.ready()) return;
    const chats = await this.request<SecretChat[]>('/chats');
    this.chats.set(chats);
    for (const chat of chats) await this.engine?.remember(chat);
  }

  async eraseForLogout(userId: string): Promise<void> {
    ++this.epoch;
    this.ready.set(false);
    this.close();
    this.cancelTransfer();
    await this.serial(async () => {
      if (this.engine?.vault)
        await this.request('/devices/' + this.engine.vault.deviceId, undefined, 'DELETE').catch(
          () => undefined,
        );
      this.engine?.close();
      this.engine = undefined;
      await clearSecretAccount(userId);
      this.release();
      this.clearMemory();
    }, true);
  }

  async lockForReauthentication(): Promise<void> {
    ++this.epoch;
    this.ready.set(false);
    this.close();
    this.cancelTransfer();
    await this.serial(async () => {
      this.engine?.close();
      this.engine = undefined;
      this.release();
      this.clearMemory();
    });
  }

  userId(): string | undefined {
    return this.session?.user.id;
  }
  ngOnDestroy(): void {
    navigator.serviceWorker?.removeEventListener('message', this.pushListener);
    clearInterval(this.poll);
    this.cancelTransfer();
    this.clearMemory();
    this.engine?.close();
    this.releaseLease?.();
  }
}
