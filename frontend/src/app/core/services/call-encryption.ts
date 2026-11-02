import { signal } from '@angular/core';
import type {
  BaseKeyProvider,
  Room,
  RoomOptions,
  TrackPublication,
  RemoteTrack,
} from 'livekit-client';
import type { OlmMachine } from '@matrix-org/matrix-sdk-crypto-wasm';
import { API_BASE_URL } from '../api/api-base';

export interface MediaCryptoGrant {
  protocol: string;
  token: string;
  room: string;
  identity: string;
}
export interface CallEncryptionState {
  phase: 'waiting' | 'verify' | 'secure' | 'error';
  code: string;
  detail: string;
  participants: number;
}
type CryptoModule = typeof import('@matrix-org/matrix-sdk-crypto-wasm');
interface DeviceKeys {
  identity: string;
  id: string;
  device_keys: { keys: Record<string, string>; [key: string]: unknown };
}
interface Envelope {
  sequence: number;
  sender_id: string;
  ciphertext: Record<string, unknown>;
}
interface Snapshot {
  devices: DeviceKeys[];
  envelopes: Envelope[];
  one_time_key_counts: Record<string, number>;
}
interface CryptoRequest {
  id: string;
  type: number;
  body: string;
}
const matrixUser = (id: string) => '@' + id + ':kvachat';
const encode = (data: Uint8Array) => btoa(String.fromCharCode(...data));
const decode = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

/** A fresh, memory-only Olm identity per call. Media keys are sent only to the
 * currently present, explicitly verified devices, inside authenticated Olm.
 * Neither the API nor LiveKit receives plaintext media key material.
 */
export class CallEncryption {
  readonly state = signal<CallEncryptionState>({
    phase: 'waiting',
    code: '',
    detail: 'Подготавливаем защиту звонка…',
    participants: 0,
  });
  readonly deviceId = crypto.randomUUID();
  options!: Pick<RoomOptions, 'encryption'>;
  private sdk!: typeof import('livekit-client');
  private module!: CryptoModule;
  private machine!: OlmMachine;
  private provider!: BaseKeyProvider & {
    install(data: Uint8Array<ArrayBuffer>, identity: string, accept?: () => boolean): Promise<void>;
  };
  private worker?: Worker;
  private room?: Room;
  private snapshot: Snapshot = { devices: [], envelopes: [], one_time_key_counts: {} };
  private timer?: ReturnType<typeof setInterval>;
  private queue: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private initializing = true;
  private disposed = false;
  private polling = false;
  private roster = '';
  private verified = '';
  private generation = 0;
  private membershipEpoch = 0;
  private material = crypto.getRandomValues(new Uint8Array(32));
  private rotation: Promise<void> = Promise.resolve();
  private sent = new Set<string>();
  private received = new Map<string, number>();
  private pending: { recipient: string; id: string; ciphertext: unknown; generation: number }[] =
    [];
  private seen = new Set<number>();

  constructor(
    readonly grant: MediaCryptoGrant,
    private fail: (message: string) => void,
  ) {}

  async initialize(): Promise<void> {
    try {
      this.sdk = await import('livekit-client');
      if (this.grant.protocol !== 'olm-livekit-v1' || !this.sdk.isE2EESupported())
        throw new Error(
          'Обновите браузер или приложение: сквозное шифрование звонков не поддерживается.',
        );
      this.module = await import('@matrix-org/matrix-sdk-crypto-wasm');
      await this.module.initAsync(
        new URL('assets/crypto/matrix_sdk_crypto_wasm_bg.wasm', document.baseURI),
      );
      this.machine = await this.module.OlmMachine.initialize(
        new this.module.UserId(matrixUser(this.grant.identity)),
        new this.module.DeviceId(this.deviceId),
      );
      this.machine.roomKeyForwardingEnabled = false;
      this.machine.roomKeyRequestsEnabled = false;
      const Base = this.sdk.BaseKeyProvider;
      this.provider = new (class extends Base {
        constructor() {
          super({
            sharedKey: false,
            keyringSize: 1,
            ratchetWindowSize: 0,
            failureTolerance: -1,
            keySize: 256,
          });
        }
        protected override onKeyRatcheted = (): void => {
          /* No automatic ratcheting or key logging. */
        };
        async install(
          data: Uint8Array<ArrayBuffer>,
          identity: string,
          accept = () => true,
        ): Promise<void> {
          const key = await crypto.subtle.importKey('raw', data, 'HKDF', false, [
            'deriveBits',
            'deriveKey',
          ]);
          if (accept()) this.onSetEncryptionKey(key, identity, 0);
        }
      })();
      await this.provider.install(this.material, this.grant.identity);
      this.worker = new Worker(
        new URL('assets/crypto/livekit-client.e2ee.worker.mjs', document.baseURI),
        { type: 'module' },
      );
      this.worker.addEventListener('error', () =>
        this.abort('Не удалось запустить шифрование медиа. Звонок остановлен.'),
      );
      this.options = { encryption: { keyProvider: this.provider, worker: this.worker } };
      for (const request of await this.machine.outgoingRequests())
        await this.process(request as CryptoRequest);
    } finally {
      this.initializing = false;
      if (this.stopped) this.dispose();
    }
  }

  async attach(room: Room): Promise<void> {
    this.room = room;
    room.on(this.sdk.RoomEvent.ParticipantConnected, this.membershipChanged);
    room.on(this.sdk.RoomEvent.ParticipantDisconnected, this.membershipChanged);
    room.on(this.sdk.RoomEvent.Connected, this.membershipChanged);
    room.on(this.sdk.RoomEvent.Reconnected, this.membershipChanged);
    room.on(this.sdk.RoomEvent.TrackPublished, this.checkPublication);
    room.on(this.sdk.RoomEvent.TrackSubscribed, this.checkSubscription);
    // Missing decrypt keys are expected before verification and while rotating.
    // The worker drops those frames; it must never fall back to plaintext.
    await room.setE2EEEnabled(true);
    this.timer = setInterval(() => {
      if (!this.polling && room.state === 'connected') void this.refresh();
    }, 1500);
  }

  private membershipChanged = (): void => {
    if (this.stopped) return;
    this.membershipEpoch++;
    for (const participant of this.room?.remoteParticipants.values() ?? []) {
      for (const publication of participant.trackPublications.values()) {
        if (!publication.isEncrypted) {
          this.abort('Участник подключил медиа без сквозного шифрования. Звонок остановлен.');
          return;
        }
      }
    }
    this.roster = '';
    this.verified = '';
    this.sent.clear();
    this.received.clear();
    this.generation++;
    this.material = crypto.getRandomValues(new Uint8Array(32));
    const generation = this.generation,
      material = this.material;
    const valid = () => !this.stopped && generation === this.generation;
    const identities = this.identities();
    this.rotation = this.rotation.then(async () => {
      if (!valid()) return;
      await this.provider.install(material, this.grant.identity, valid);
      // Forget old receive keys too; re-verification must not play stale media.
      for (const id of identities)
        if (id !== this.grant.identity)
          await this.provider.install(crypto.getRandomValues(new Uint8Array(32)), id, valid);
    });
    this.state.set({
      phase: 'waiting',
      code: '',
      detail: 'Обновляем ключи участников…',
      participants: this.identities().length,
    });
    if (!this.polling) void this.refresh();
  };

  private checkPublication = (publication: TrackPublication): void => {
    if (!publication.isEncrypted)
      this.abort('Участник подключил медиа без сквозного шифрования. Звонок остановлен.');
  };
  private checkSubscription = (_track: RemoteTrack, publication: TrackPublication): void =>
    this.checkPublication(publication);

  private identities(): string[] {
    return [this.grant.identity, ...(this.room?.remoteParticipants.keys() ?? [])].sort();
  }

  private async request<T>(
    path: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ): Promise<T> {
    const response = await fetch(API_BASE_URL + '/api/media-encryption' + path, {
      method,
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: {
        'X-Media-Token': this.grant.token,
        'X-Media-Device': this.deviceId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw Object.assign(new Error('Обмен ключами звонка временно недоступен.'), {
        status: response.status,
      });
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  private async process(request: CryptoRequest): Promise<void> {
    const m = this.module;
    let response: unknown;
    if (request.type === m.RequestType.KeysUpload) {
      response = await this.request(
        `/devices/${this.deviceId}/keys`,
        JSON.parse(request.body),
        'PUT',
      );
    } else if (request.type === m.RequestType.KeysQuery) {
      const requested = JSON.parse(request.body).device_keys as Record<string, string[]>;
      const keys: Record<string, Record<string, unknown>> = {};
      for (const identity of Object.keys(requested)) {
        keys[identity] = {};
        for (const peer of this.snapshot.devices)
          if (matrixUser(peer.identity) === identity && this.identities().includes(peer.identity))
            keys[identity][peer.id] = peer.device_keys;
      }
      response = { device_keys: keys, failures: {} };
    } else if (request.type === m.RequestType.KeysClaim) {
      const requested = JSON.parse(request.body).one_time_keys as Record<
        string,
        Record<string, string>
      >;
      const keys: Record<string, unknown> = {};
      for (const peer of this.snapshot.devices) {
        if (
          requested[matrixUser(peer.identity)]?.[peer.id] &&
          this.identities().includes(peer.identity)
        ) {
          const result = await this.request<{ one_time_keys: Record<string, unknown> }>('/claim', {
            device_id: peer.id,
          });
          Object.assign(keys, result.one_time_keys);
        }
      }
      response = { one_time_keys: keys, failures: {} };
    } else throw new Error('Неподдерживаемая операция защиты звонка.');
    await this.machine.markRequestAsSent(request.id, request.type, JSON.stringify(response));
  }

  private async synchronizeDevices(): Promise<string | null> {
    const ids = this.identities();
    if (this.room?.name && this.room.name !== this.grant.room)
      throw new Error('Комната звонка не совпадает с защищённым сеансом.');
    if (ids.some((id) => !this.snapshot.devices.some((peer) => peer.identity === id))) return null;
    await this.machine.updateTrackedUsers(
      ids
        .filter((id) => id !== this.grant.identity)
        .map((id) => new this.module.UserId(matrixUser(id))),
    );
    await this.process(
      this.machine.queryKeysForUsers(ids.map((id) => new this.module.UserId(matrixUser(id)))),
    );
    const identities: string[] = [];
    for (const id of ids) {
      const peer = this.snapshot.devices.find((peer) => peer.identity === id)!;
      const device = await this.machine.getDevice(
        new this.module.UserId(matrixUser(id)),
        new this.module.DeviceId(peer.id),
      );
      if (!device?.ed25519Key || !device.curve25519Key)
        throw new Error('Не удалось проверить ключ участника.');
      identities.push(
        `${id}:${peer.id}:${device.ed25519Key.toBase64()}:${device.curve25519Key.toBase64()}`,
      );
      device.free();
    }
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode('kvachat-call-v1:' + this.grant.room + ':' + identities.join('|')),
      ),
    );
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  refresh(): Promise<void> {
    if (this.polling || this.stopped) return Promise.resolve();
    this.polling = true;
    const task = this.queue
      .then(async () => {
        if (this.stopped || this.room?.state !== 'connected') return;
        const epoch = this.membershipEpoch;
        this.snapshot = await this.request<Snapshot>('/state');
        const roster = await this.synchronizeDevices();
        if (this.stopped || epoch !== this.membershipEpoch) return;
        if (!roster) {
          this.state.set({
            phase: 'waiting',
            code: '',
            detail: 'Ожидаем защищённые устройства всех участников.',
            participants: this.identities().length,
          });
          return;
        }
        if (roster !== this.roster) {
          // Includes an identity key change even if LiveKit retained its participant.
          this.membershipChanged();
          this.roster = roster;
        }
        await this.rotation;
        await this.machine.receiveSyncChangesMsc4186(
          '[]',
          new this.module.DeviceLists(),
          new Map(Object.entries(this.snapshot.one_time_key_counts)),
        );
        for (const request of await this.machine.outgoingRequests())
          await this.process(request as CryptoRequest);
        if (this.verified === roster) {
          await this.share();
          await this.receive();
        }
        const peers = this.snapshot.devices.filter(
          (peer) => peer.id !== this.deviceId && this.identities().includes(peer.identity),
        );
        const secure =
          peers.length > 0 &&
          this.verified === roster &&
          peers.every((peer) => this.received.has(peer.id) && this.sent.has(peer.id));
        this.state.set({
          phase: secure ? 'secure' : this.verified === roster ? 'waiting' : 'verify',
          code: roster.match(/.{8}/g)!.join(' '),
          detail: secure
            ? 'Сквозное шифрование · участники проверены'
            : this.verified === roster
              ? 'Ожидаем подтверждения собеседников…'
              : 'Сверьте код со всеми участниками по доверенному каналу.',
          participants: peers.length + 1,
        });
      })
      .catch((error) => {
        if (this.stopped) return;
        if ([403, 404, 410].includes((error as { status?: number }).status ?? 0))
          this.abort('Допуск к защищённому звонку завершён. Подключитесь заново.');
        else if (
          'status' in Object(error) ||
          error instanceof TypeError ||
          (error instanceof DOMException && error.name === 'TimeoutError')
        )
          this.state.update((state) => ({
            ...state,
            phase: 'error',
            detail: 'Обмен ключами временно недоступен. Повторяем подключение…',
          }));
        else this.abort('Не удалось проверить защиту звонка. Подключитесь заново.');
      })
      .finally(() => {
        this.polling = false;
      });
    this.queue = task;
    return task;
  }

  async confirm(displayed: string): Promise<void> {
    await this.refresh();
    const task = this.queue.then(async () => {
      if (this.stopped || !this.roster || displayed.replaceAll(' ', '') !== this.roster) return;
      for (const peer of this.snapshot.devices) {
        if (peer.id === this.deviceId || !this.identities().includes(peer.identity)) continue;
        const device = await this.machine.getDevice(
          new this.module.UserId(matrixUser(peer.identity)),
          new this.module.DeviceId(peer.id),
        );
        if (!device) throw new Error('Устройство участника изменилось.');
        await device.setLocalTrust(this.module.LocalTrust.Verified);
        device.free();
      }
      this.verified = this.roster;
    });
    this.queue = task.catch(() => undefined);
    try {
      await task;
      await this.refresh();
    } catch {
      this.abort('Не удалось подтвердить устройства звонка.');
    }
  }

  private async share(): Promise<void> {
    const roster = this.roster,
      generation = this.generation,
      material = this.material;
    const peers = this.snapshot.devices.filter(
      (peer) => peer.id !== this.deviceId && this.identities().includes(peer.identity),
    );
    const claim = await this.machine.getMissingSessions(
      peers.map((peer) => new this.module.UserId(matrixUser(peer.identity))),
    );
    if (claim) await this.process(claim);
    for (const peer of peers) {
      if (this.stopped || generation !== this.generation || roster !== this.verified) return;
      if (this.sent.has(peer.id)) continue;
      let pending = this.pending.find(
        (item) => item.recipient === peer.id && item.generation === generation,
      );
      if (!pending) {
        const device = await this.machine.getDevice(
          new this.module.UserId(matrixUser(peer.identity)),
          new this.module.DeviceId(peer.id),
        );
        if (!device?.isLocallyTrusted())
          throw new Error('Сначала подтвердите устройство участника.');
        const ciphertext = JSON.parse(
          await device.encryptToDeviceEvent(
            'ru.kvachat.media-key',
            { room: this.grant.room, roster, generation, key: encode(material) },
            this.module.CollectStrategy.onlyTrustedDevices(),
          ),
        );
        device.free();
        pending = { recipient: peer.id, id: crypto.randomUUID(), ciphertext, generation };
        this.pending.push(pending);
      }
      if (
        this.stopped ||
        generation !== this.generation ||
        roster !== this.verified ||
        !this.identities().includes(peer.identity)
      )
        return;
      await this.request('/envelopes', {
        recipient_id: pending.recipient,
        client_id: pending.id,
        ciphertext: pending.ciphertext,
      });
      this.pending = this.pending.filter((item) => item !== pending);
      if (generation === this.generation) this.sent.add(peer.id);
    }
    this.pending = this.pending.filter((item) => item.generation === this.generation);
  }

  private async receive(): Promise<void> {
    const epoch = this.membershipEpoch;
    const completed: number[] = [];
    for (const row of this.snapshot.envelopes) {
      if (this.seen.has(row.sequence)) {
        completed.push(row.sequence);
        continue;
      }
      const peer = this.snapshot.devices.find(
        (peer) => peer.id === row.sender_id && this.identities().includes(peer.identity),
      );
      if (!peer) {
        completed.push(row.sequence);
        continue;
      }
      const events = await this.machine.receiveSyncChangesMsc4186(
        JSON.stringify([
          { type: 'm.room.encrypted', sender: matrixUser(peer.identity), content: row.ciphertext },
        ]),
        new this.module.DeviceLists(),
        new Map(),
      );
      for (const event of events) {
        if (!(event instanceof this.module.DecryptedToDeviceEvent))
          throw new Error('Не удалось расшифровать ключ участника. Переподключитесь к звонку.');
        if (
          !event.encryptionInfo.isSenderVerified() ||
          event.encryptionInfo.senderCurve25519Key !==
            peer.device_keys.keys['curve25519:' + peer.id]
        )
          throw new Error('Не удалось подтвердить отправителя ключа.');
        const value = JSON.parse(event.rawEvent) as {
          type: string;
          content: { room: string; roster: string; generation: number; key: string };
        };
        const body = value.content;
        if (
          value.type !== 'ru.kvachat.media-key' ||
          body.room !== this.grant.room ||
          !Number.isSafeInteger(body.generation) ||
          body.generation < 0 ||
          typeof body.key !== 'string' ||
          !/^[A-Za-z0-9+/]{43}=$/.test(body.key)
        )
          throw new Error('Некорректный ключ медиа.');
        if (
          !this.stopped &&
          epoch === this.membershipEpoch &&
          body.roster === this.verified &&
          body.roster === this.roster &&
          body.generation > (this.received.get(peer.id) ?? -1)
        ) {
          await this.provider.install(
            decode(body.key),
            peer.identity,
            () => !this.stopped && epoch === this.membershipEpoch,
          );
          if (!this.stopped && epoch === this.membershipEpoch)
            this.received.set(peer.id, body.generation);
        }
        event.free();
      }
      this.seen.add(row.sequence);
      completed.push(row.sequence);
    }
    if (completed.length) await this.request('/ack', { sequences: completed });
  }

  private abort(message: string): void {
    if (this.stopped) return;
    this.state.update((state) => ({ ...state, phase: 'error', detail: message }));
    this.fail(message);
  }
  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.machine?.close();
    this.worker?.terminate();
    this.material.fill(0);
    this.pending = [];
  }
  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    this.room?.off(this.sdk.RoomEvent.ParticipantConnected, this.membershipChanged);
    this.room?.off(this.sdk.RoomEvent.ParticipantDisconnected, this.membershipChanged);
    this.room?.off(this.sdk.RoomEvent.Connected, this.membershipChanged);
    this.room?.off(this.sdk.RoomEvent.Reconnected, this.membershipChanged);
    this.room?.off(this.sdk.RoomEvent.TrackPublished, this.checkPublication);
    this.room?.off(this.sdk.RoomEvent.TrackSubscribed, this.checkSubscription);
    void this.request('/device', undefined, 'DELETE').catch(() => undefined);
    void this.queue.finally(() => {
      if (!this.initializing) this.dispose();
    });
  }
}
