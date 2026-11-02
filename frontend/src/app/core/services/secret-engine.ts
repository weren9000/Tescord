import type { Device, OlmMachine } from '@matrix-org/matrix-sdk-crypto-wasm';
import {
  createVault,
  SecretVault,
  secretRead,
  secretWrite,
  secretList,
  secretDelete,
} from './secret-storage';
import { SecretAttachment, validAttachment } from './secret-files';

type CryptoModule = typeof import('@matrix-org/matrix-sdk-crypto-wasm');
type Transport = <T>(path: string, body?: unknown, method?: string) => Promise<T>;
interface CryptoRequest {
  id: string;
  type: number;
  body: string;
  event_type?: string;
}
export interface SecretChat {
  id: string;
  peer_device_id: string;
  peer_user_id: string;
  peer_name: string;
  peer_device_name: string;
  initiator: boolean;
  accepted_at: string | null;
  closed_at: string | null;
  peer_available: boolean;
  created_at: string;
}
export interface SecretMessage {
  id: string;
  kind: 'message' | 'edit' | 'delete';
  text: string;
  targetId?: string;
  replyTo?: string;
  createdAt: string;
  senderId: string;
  sequence: number;
  pending?: boolean;
  attachment?: SecretAttachment;
}
interface StoredMessage {
  upload_ids?: string[];
  queued_at?: number;
  client_id: string;
  kind: 'message' | 'keys';
  ciphertext: Record<string, unknown>;
  sender_device_id: string;
  sender_user_id: string;
  sequence: number;
}
interface LocalRoom {
  chat: SecretChat;
  fingerprint?: string;
  peerCurve?: string;
}

const identity = (userId: string) => '@' + userId + ':kvachat';

/** Olm transports session keys; Megolm messages can be decrypted again after a crash.
 * Persist ciphertext BEFORE acknowledging delivery. Private state is in the
 * SDK's encrypted IndexedDB store; key backups/forwarding are deliberately off.
 */
export class SecretEngine {
  private module!: CryptoModule;
  private machine!: OlmMachine;
  vault!: SecretVault;
  private stopped = false;

  constructor(
    readonly userId: string,
    private transport: Transport,
  ) {}

  async initialize(): Promise<void> {
    this.module = await import('@matrix-org/matrix-sdk-crypto-wasm');
    await this.module.initAsync(
      new URL('assets/crypto/matrix_sdk_crypto_wasm_bg.wasm', document.baseURI),
    );
    this.vault = await createVault(this.userId);
    this.machine = await this.module.OlmMachine.initialize(
      new this.module.UserId(identity(this.userId)),
      new this.module.DeviceId(this.vault.deviceId),
      this.vault.storeName,
      this.vault.passphrase,
    );
    this.machine.roomKeyRequestsEnabled = false;
    this.machine.roomKeyForwardingEnabled = false;
    const binding = await this.transport<{ challenge: Record<string, string | number> | null }>(
      `/devices/${this.vault.deviceId}/session-challenge`,
      {},
    );
    if (binding.challenge) {
      const challenge = Object.fromEntries(
        Object.keys(binding.challenge)
          .sort()
          .map((key) => [key, binding.challenge![key]]),
      );
      const signatures = await this.machine.sign(JSON.stringify(challenge));
      await this.transport(`/devices/${this.vault.deviceId}/session-proof`, {
        challenge,
        signatures: JSON.parse(signatures.asJSON()),
      });
      signatures.free();
    }
    await this.flushRequests();
  }

  close(): void {
    this.stopped = true;
    this.machine?.close();
  }

  private async flushRequests(): Promise<void> {
    for (const request of await this.machine.outgoingRequests()) {
      await this.processRequest(request as CryptoRequest);
    }
  }

  private async processRequest(request: CryptoRequest, chat?: SecretChat): Promise<void> {
    const m = this.module;
    let response: unknown;
    if (request.type === m.RequestType.KeysUpload) {
      response = await this.transport(
        `/devices/${this.vault.deviceId}/keys`,
        {
          ...JSON.parse(request.body),
          name: window.kvaAndroid ? 'Android' : window.kvaDesktop ? 'Windows' : 'Браузер',
        },
        'PUT',
      );
    } else if (request.type === m.RequestType.KeysQuery) {
      response = await this.transport('/keys/query', JSON.parse(request.body));
    } else if (request.type === m.RequestType.KeysClaim) {
      const intent =
        chat ?? (await secretRead<SecretChat>('outbox', this.userId + ':share-intent'));
      if (!intent) throw new Error('Не удалось восстановить адресата ключа.');
      response = await this.transport(`/chats/${intent.id}/keys/claim`, {});
    } else if (request.type === m.RequestType.ToDevice) {
      const intent =
        chat ?? (await secretRead<SecretChat>('outbox', this.userId + ':share-intent'));
      if (!intent) throw new Error('Не удалось восстановить адресата ключа. Отправка остановлена.');
      const payload = JSON.parse(request.body) as {
        messages: Record<string, Record<string, Record<string, unknown>>>;
      };
      const ciphertext = payload.messages[identity(intent.peer_user_id)]?.[intent.peer_device_id];
      if (ciphertext) {
        if (request.event_type !== 'm.room.encrypted')
          throw new Error(
            'У собеседника нет доступного ключа. Попросите его открыть Квачат и повторите отправку.',
          );
        const digest = new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(intent.id + ':keys:' + request.id),
          ),
        );
        const hex = Array.from(digest.slice(0, 16), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        const clientId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        try {
          await this.transport(`/chats/${intent.id}/envelopes`, {
            client_id: clientId,
            kind: 'keys',
            ciphertext,
          });
        } catch (error) {
          // A closed chat must not prevent opening the rest of the local vault.
          if ((error as { status?: number }).status !== 410) throw error;
        }
      }
      // Only the immutable peer device is addressed. Never forward keys to any
      // other trusted device from a different chat, even if the SDK lists one.
      response = {};
    } else {
      throw new Error('Неподдерживаемая операция защищённого обмена.');
    }
    await this.machine.markRequestAsSent(request.id, request.type, JSON.stringify(response));
  }

  private roomKey(chat: SecretChat): string {
    return this.userId + ':' + chat.id;
  }
  private messageKey(chat: SecretChat, id: string): string {
    return this.roomKey(chat) + ':' + id;
  }

  async remember(chat: SecretChat): Promise<void> {
    const existing = await secretRead<LocalRoom>('rooms', this.roomKey(chat));
    await secretWrite('rooms', this.roomKey(chat), { ...existing, chat });
  }

  async fingerprint(chat: SecretChat): Promise<string> {
    await this.machine.updateTrackedUsers([new this.module.UserId(identity(chat.peer_user_id))]);
    const request = this.machine.queryKeysForUsers([
      new this.module.UserId(identity(chat.peer_user_id)),
    ]);
    await this.processRequest(request as CryptoRequest);
    const device = await this.peer(chat);
    const participants = [
      `${identity(this.userId)}:${this.vault.deviceId}:${this.machine.identityKeys.ed25519.toBase64()}:${this.machine.identityKeys.curve25519.toBase64()}`,
      `${identity(chat.peer_user_id)}:${chat.peer_device_id}:${device.ed25519Key?.toBase64()}:${device.curve25519Key?.toBase64()}`,
    ].sort();
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode('kvachat-secret-v1:' + chat.id + ':' + participants.join('|')),
      ),
    );
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .match(/.{8}/g)!
      .join(' ');
  }

  async verify(chat: SecretChat, displayedFingerprint: string): Promise<void> {
    if ((await this.fingerprint(chat)) !== displayedFingerprint)
      throw new Error('Ключ собеседника изменился. Сверьте код заново.');
    await (await this.peer(chat)).setLocalTrust(this.module.LocalTrust.Verified);
    await secretWrite('rooms', this.roomKey(chat), {
      chat,
      fingerprint: displayedFingerprint,
      peerCurve: (await this.peer(chat)).curve25519Key!.toBase64(),
    });
  }

  async savedFingerprint(chat: SecretChat): Promise<string> {
    return (await secretRead<LocalRoom>('rooms', this.roomKey(chat)))?.fingerprint ?? '';
  }

  async isVerified(chat: SecretChat, fingerprint: string): Promise<boolean> {
    const saved = await secretRead<LocalRoom>('rooms', this.roomKey(chat));
    return saved?.fingerprint === fingerprint && (await this.peer(chat)).isLocallyTrusted();
  }

  private async peer(chat: SecretChat): Promise<Device> {
    const device = await this.machine.getDevice(
      new this.module.UserId(identity(chat.peer_user_id)),
      new this.module.DeviceId(chat.peer_device_id),
    );
    if (!device || device.isDeleted() || !device.ed25519Key || !device.curve25519Key)
      throw new Error('Ключи устройства собеседника недоступны.');
    return device;
  }

  private async requireVerified(chat: SecretChat): Promise<Device> {
    if (this.stopped) throw new Error('Сеанс завершён.');
    const fingerprint = await this.fingerprint(chat);
    if (!(await this.isVerified(chat, fingerprint)))
      throw new Error('Сначала сверьте код безопасности с собеседником.');
    return this.peer(chat);
  }

  async send(
    chat: SecretChat,
    payload: Omit<SecretMessage, 'id' | 'senderId' | 'sequence' | 'pending' | 'createdAt'>,
  ): Promise<void> {
    await this.requireVerified(chat);
    await this.flushRequests();
    const m = this.module;
    await secretWrite('outbox', this.userId + ':share-intent', chat);
    const claim = await this.machine.getMissingSessions([
      new m.UserId(identity(chat.peer_user_id)),
    ]);
    if (claim) await this.processRequest(claim, chat);
    const settings = new m.EncryptionSettings();
    settings.sharingStrategy = m.CollectStrategy.onlyTrustedDevices();
    settings.rotationPeriodMessages = 100n;
    settings.rotationPeriod = 86_400_000_000n;
    const room = new m.RoomId('!' + chat.id + ':kvachat');
    for (const request of await this.machine.shareRoomKey(
      room,
      [new m.UserId(identity(chat.peer_user_id))],
      settings,
    )) {
      await this.processRequest(request, chat);
    }
    await secretDelete('outbox', this.userId + ':share-intent');
    const id = crypto.randomUUID();
    const content = { ...payload, id, chatId: chat.id, createdAt: new Date().toISOString() };
    const ciphertext = JSON.parse(
      await this.machine.encryptRoomEvent(
        room,
        'ru.kvachat.secret.message',
        JSON.stringify(content),
      ),
    ) as Record<string, unknown>;
    const stored: StoredMessage = {
      client_id: id,
      kind: 'message',
      ciphertext,
      sender_device_id: this.vault.deviceId,
      sender_user_id: this.userId,
      sequence: Number.MAX_SAFE_INTEGER,
      queued_at: Date.now(),
      ...(payload.attachment ? { upload_ids: [payload.attachment.id] } : {}),
    };
    await secretWrite('outbox', this.messageKey(chat, id), stored);
    await secretWrite('messages', this.messageKey(chat, id), stored);
    // Once durable, this is a queued message. Keep its id for retry instead of
    // returning a failure that would make a second click create a duplicate.
    await this.flushOutbox(chat).catch(() => undefined);
  }

  async flushOutbox(chat: SecretChat): Promise<void> {
    const pending = await secretList<StoredMessage>('outbox', this.roomKey(chat) + ':');
    for (const stored of pending.sort((a, b) => (a.queued_at ?? 0) - (b.queued_at ?? 0))) {
      const result = await this.transport<{ sequence: number }>(`/chats/${chat.id}/envelopes`, {
        client_id: stored.client_id,
        kind: stored.kind,
        ciphertext: stored.ciphertext,
        upload_ids: stored.upload_ids ?? [],
      });
      await secretWrite('messages', this.messageKey(chat, stored.client_id), {
        ...stored,
        sequence: result.sequence,
      });
      await secretDelete('outbox', this.messageKey(chat, stored.client_id));
    }
  }

  async synchronize(chat: SecretChat): Promise<void> {
    await this.requireVerified(chat);
    const rows = await this.transport<StoredMessage[]>(
      `/chats/${chat.id}/envelopes`,
      undefined,
      'GET',
    );
    const completed: number[] = [];
    for (const row of rows) {
      if (row.sender_device_id !== chat.peer_device_id)
        throw new Error('Устройство отправителя не совпадает с участником чата.');
      // Keep the original encrypted key envelope too: acknowledge only data
      // already durable locally, including a crash between SDK commit and ack.
      const storageKey = this.messageKey(chat, row.client_id);
      const existing = await secretRead<StoredMessage>('messages', storageKey);
      if (existing && JSON.stringify(existing.ciphertext) !== JSON.stringify(row.ciphertext))
        throw new Error('Содержимое ранее полученного сообщения изменилось.');
      await secretWrite('messages', storageKey, { ...row, sender_user_id: chat.peer_user_id });
      if (row.kind === 'keys') {
        const processed = await this.machine.receiveSyncChangesMsc4186(
          JSON.stringify([
            {
              type: 'm.room.encrypted',
              sender: identity(chat.peer_user_id),
              content: row.ciphertext,
            },
          ]),
          new this.module.DeviceLists(),
          new Map(),
        );
        for (const event of processed) {
          if (event instanceof this.module.DecryptedToDeviceEvent) {
            const body = JSON.parse(event.rawEvent) as {
              type: string;
              content: { room_id: string };
            };
            if (
              event.encryptionInfo.senderCurve25519Key !==
                (await this.peer(chat)).curve25519Key!.toBase64() ||
              body.type !== 'm.room_key' ||
              body.content.room_id !== '!' + chat.id + ':kvachat'
            )
              throw new Error('Ключ получен для другой переписки или от другого устройства.');
          }
          // SDK reports an already processed Olm envelope as UTD on retry.
          // The durable Megolm state decrypts messages again without advancing
          // the Olm ratchet twice; missing keys remain a visible history error.
          event.free();
        }
      }
      completed.push(row.sequence);
    }
    if (completed.length) await this.transport(`/chats/${chat.id}/ack`, { sequences: completed });
    await this.flushOutbox(chat);
    await this.flushRequests();
  }

  async maintain(): Promise<void> {
    const counts = await this.transport<Record<string, number>>('/keys/counts', undefined, 'GET');
    await this.machine.receiveSyncChangesMsc4186(
      '[]',
      new this.module.DeviceLists(),
      new Map(Object.entries(counts)),
    );
    await this.flushRequests();
  }

  async history(chat: SecretChat): Promise<SecretMessage[]> {
    const saved = await secretRead<LocalRoom>('rooms', this.roomKey(chat));
    if (!saved?.fingerprint || !saved.peerCurve)
      throw new Error('История недоступна без проверенного ключа собеседника.');
    const records = await secretList<StoredMessage>('messages', this.roomKey(chat) + ':');
    const messages = new Map<string, SecretMessage>();
    for (const record of records.sort((a, b) => a.sequence - b.sequence)) {
      if (record.kind === 'keys') continue;
      const own = record.sender_device_id === this.vault.deviceId;
      const expectedCurve = own ? this.machine.identityKeys.curve25519.toBase64() : saved.peerCurve;
      const sender = own ? this.userId : chat.peer_user_id;
      if (record.sender_device_id !== (own ? this.vault.deviceId : chat.peer_device_id))
        throw new Error('Неизвестное устройство в истории.');
      const decrypted = await this.machine.decryptRoomEvent(
        JSON.stringify({
          type: 'm.room.encrypted',
          sender: identity(sender),
          event_id: '$' + record.client_id,
          origin_server_ts: 0,
          content: record.ciphertext,
        }),
        new this.module.RoomId('!' + chat.id + ':kvachat'),
        new this.module.DecryptionSettings(this.module.TrustRequirement.Untrusted),
      );
      if (decrypted.senderCurve25519Key !== expectedCurve)
        throw new Error('Не удалось подтвердить отправителя сообщения.');
      const event = JSON.parse(decrypted.event) as {
        type: string;
        content: SecretMessage & { chatId: string };
      };
      const body = event.content;
      if (
        event.type !== 'ru.kvachat.secret.message' ||
        body.id !== record.client_id ||
        body.chatId !== chat.id ||
        typeof body.text !== 'string' ||
        body.text.length > 20000
      ) {
        throw new Error('Некорректное защищённое сообщение.');
      }
      if (body.attachment !== undefined && !validAttachment(body.attachment))
        throw new Error('Некорректное защищённое вложение.');
      if (body.kind === 'message')
        messages.set(body.id, {
          ...body,
          senderId: sender,
          sequence: record.sequence,
          pending: record.sequence === Number.MAX_SAFE_INTEGER,
        });
      else if (body.targetId) {
        const original = messages.get(body.targetId);
        if (original?.senderId !== sender) continue;
        if (body.kind === 'edit') messages.set(original.id, { ...original, text: body.text });
        else if (body.kind === 'delete') messages.delete(original.id);
      }
    }
    return Array.from(messages.values());
  }
}
