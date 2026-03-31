import { Injectable, computed, signal } from '@angular/core';

import { VOICE_ICE_SERVERS, WS_BASE_URL } from '../api/api-base';
import { CurrentUserResponse } from '../models/workspace.models';

export interface VoiceParticipant {
  id: string;
  user_id: string;
  nick: string;
  avatar_updated_at: string | null;
  muted: boolean;
  owner_muted: boolean;
  speaking: boolean;
  is_self: boolean;
}

export interface VoiceDeviceOption {
  deviceId: string;
  label: string;
}

export interface VoiceSettings {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  sensitivity: number;
  microphoneGain: number;
  masterVolume: number;
  participantVolumes: Record<string, number>;
}

type VoiceSignalType = 'offer' | 'answer' | 'ice_candidate';
type VoiceConnectionState = 'idle' | 'connecting' | 'connected' | 'error';

interface RoomStateMessage {
  type: 'room_state';
  self_id: string;
  self_participant: RemoteVoiceParticipant;
  participants: RemoteVoiceParticipant[];
}

interface PeerJoinedMessage {
  type: 'peer_joined';
  participant: RemoteVoiceParticipant;
}

interface PeerLeftMessage {
  type: 'peer_left';
  participant_id: string;
}

interface RelayedSignalMessage {
  type: VoiceSignalType;
  from_id: string;
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
}

interface MuteStateMessage {
  type: 'mute_state';
  participant_id: string;
  muted: boolean;
}

interface OwnerMuteStateMessage {
  type: 'owner_mute_state';
  participant_id: string;
  owner_muted: boolean;
}

interface ErrorMessage {
  type: 'error';
  detail: string;
}

interface RemoteVoiceParticipant {
  id: string;
  user_id: string;
  nick: string;
  avatar_updated_at: string | null;
  muted: boolean;
  owner_muted: boolean;
}

interface VoiceActivityMonitor {
  analyser: AnalyserNode;
  intervalId: number;
  lastDetectedAt: number;
  source: MediaStreamAudioSourceNode;
  samples: Uint8Array;
}

interface LocalAudioPipeline {
  source: MediaStreamAudioSourceNode;
  gainNode: GainNode;
  destination: MediaStreamAudioDestinationNode;
}

interface RemoteAudioOutput {
  audioElement: HTMLAudioElement;
  inputStream: MediaStream | null;
  source: MediaStreamAudioSourceNode | null;
  gainNode: GainNode | null;
  destination: MediaStreamAudioDestinationNode | null;
}

interface VoiceJoinContext {
  channelId: string;
  token: string;
  currentUser: CurrentUserResponse;
}

type IncomingVoiceMessage =
  | RoomStateMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | RelayedSignalMessage
  | MuteStateMessage
  | OwnerMuteStateMessage
  | ErrorMessage
  | { type: 'pong' };

const SETTINGS_STORAGE_KEY = 'tescord.voice.settings';
const VOICE_ACTIVITY_INTERVAL_MS = 120;
const VOICE_ACTIVITY_HOLD_MS = 320;
const VOICE_SOCKET_PING_INTERVAL_MS = 20000;
const OWNER_MUTED_NOTICE = 'Микрофон заблокирован владельцем канала';
const MAX_AUDIO_GAIN_PERCENT = 200;
const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  inputDeviceId: null,
  outputDeviceId: null,
  sensitivity: 58,
  microphoneGain: 100,
  masterVolume: 100,
  participantVolumes: {}
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function loadVoiceSettings(): VoiceSettings {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_VOICE_SETTINGS;
  }

  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_VOICE_SETTINGS;
    }

    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    const participantVolumes = Object.entries(parsed.participantVolumes ?? {}).reduce<Record<string, number>>(
      (accumulator, [userId, volume]) => {
        accumulator[userId] = clamp(
          typeof volume === 'number' ? volume : DEFAULT_VOICE_SETTINGS.masterVolume,
          0,
          MAX_AUDIO_GAIN_PERCENT
        );
        return accumulator;
      },
      {}
    );

    return {
      inputDeviceId: parsed.inputDeviceId ?? null,
      outputDeviceId: parsed.outputDeviceId ?? null,
      sensitivity: clamp(parsed.sensitivity ?? DEFAULT_VOICE_SETTINGS.sensitivity, 0, 100),
      microphoneGain: clamp(parsed.microphoneGain ?? DEFAULT_VOICE_SETTINGS.microphoneGain, 0, MAX_AUDIO_GAIN_PERCENT),
      masterVolume: clamp(parsed.masterVolume ?? DEFAULT_VOICE_SETTINGS.masterVolume, 0, MAX_AUDIO_GAIN_PERCENT),
      participantVolumes
    };
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
}

function saveVoiceSettings(settings: VoiceSettings): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

@Injectable({
  providedIn: 'root'
})
export class VoiceRoomService {
  private audioContext: AudioContext | null = null;
  private localMonitor: VoiceActivityMonitor | null = null;
  private socket: WebSocket | null = null;
  private socketPingIntervalId: number | null = null;
  private rawLocalStream: MediaStream | null = null;
  private localStream: MediaStream | null = null;
  private localAudioPipeline: LocalAudioPipeline | null = null;
  private selfId: string | null = null;
  private lastJoinContext: VoiceJoinContext | null = null;
  private pendingPlaybackUnlock = new Set<string>();
  private userGestureUnlockHandler: (() => void) | null = null;
  private readonly peerConnections = new Map<string, RTCPeerConnection>();
  private readonly pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();
  private readonly remoteMonitors = new Map<string, VoiceActivityMonitor>();
  private readonly remoteAudioOutputs = new Map<string, RemoteAudioOutput>();
  private readonly participantUserIds = new Map<string, string>();

  readonly state = signal<VoiceConnectionState>('idle');
  readonly error = signal<string | null>(null);
  readonly settingsNotice = signal<string | null>(null);
  readonly activeChannelId = signal<string | null>(null);
  readonly participants = signal<VoiceParticipant[]>([]);
  readonly localMuted = signal(false);
  readonly ownerMuted = computed(() => this.getParticipant(this.selfId ?? 'local')?.owner_muted === true);
  readonly settings = signal<VoiceSettings>(loadVoiceSettings());
  readonly devicesLoading = signal(false);
  readonly inputDevices = signal<VoiceDeviceOption[]>([]);
  readonly outputDevices = signal<VoiceDeviceOption[]>([]);
  readonly isConnected = computed(() => this.state() === 'connected');
  readonly outputDeviceSupported = computed(() => {
    if (typeof HTMLMediaElement === 'undefined') {
      return false;
    }

    return 'setSinkId' in HTMLMediaElement.prototype;
  });

  constructor() {
    void this.refreshDevices();
  }

  async join(channelId: string, token: string, currentUser: CurrentUserResponse, force = false): Promise<void> {
    if (!force && this.activeChannelId() === channelId && (this.state() === 'connecting' || this.state() === 'connected')) {
      return;
    }

    this.lastJoinContext = {
      channelId,
      token,
      currentUser
    };

    this.leave();
    this.state.set('connecting');
    this.error.set(null);
    this.activeChannelId.set(channelId);
    this.participants.set([
      {
        id: 'local',
        user_id: currentUser.id,
        nick: currentUser.nick,
        avatar_updated_at: currentUser.avatar_updated_at,
        muted: false,
        owner_muted: false,
        speaking: false,
        is_self: true
      }
    ]);

    try {
      this.rawLocalStream = await this.openLocalStream();
      this.localStream = await this.createProcessedLocalStream(this.rawLocalStream);
      this.localMuted.set(false);
      this.applyLocalTrackState();
      await this.refreshDevices();
      await this.openSocket(channelId, token);
    } catch (error) {
      this.handleFailure(error instanceof Error ? error.message : 'Не удалось подключиться к голосовому каналу');
    }
  }

  leave(): void {
    this.stopVoiceActivityMonitoring();
    this.teardownSocket();
    this.teardownPeerConnections();
    this.stopLocalStream();
    this.clearAudioElements();
    this.pendingIceCandidates.clear();
    this.participantUserIds.clear();
    this.pendingPlaybackUnlock.clear();
    this.detachUserGestureUnlock();
    this.selfId = null;
    this.state.set('idle');
    this.error.set(null);
    this.activeChannelId.set(null);
    this.participants.set([]);
    this.localMuted.set(false);
    this.lastJoinContext = null;
    if (this.settingsNotice() === OWNER_MUTED_NOTICE) {
      this.settingsNotice.set(null);
    }
  }

  syncCurrentUserProfile(currentUser: CurrentUserResponse): void {
    if (this.lastJoinContext) {
      this.lastJoinContext = {
        ...this.lastJoinContext,
        currentUser
      };
    }

    this.participants.update((participants) =>
      participants.map((participant) =>
        participant.user_id === currentUser.id
          ? {
              ...participant,
              nick: currentUser.nick,
              avatar_updated_at: currentUser.avatar_updated_at
            }
          : participant
      )
    );
  }

  syncParticipantProfiles(participantsSnapshot: Array<Pick<VoiceParticipant, 'user_id' | 'nick' | 'avatar_updated_at'>>): void {
    if (!participantsSnapshot.length) {
      return;
    }

    const snapshotByUserId = new Map(participantsSnapshot.map((participant) => [participant.user_id, participant]));
    this.participants.update((participants) =>
      participants.map((participant) => {
        const snapshot = snapshotByUserId.get(participant.user_id);
        if (!snapshot) {
          return participant;
        }

        return {
          ...participant,
          nick: snapshot.nick,
          avatar_updated_at: snapshot.avatar_updated_at
        };
      })
    );
  }

  toggleMute(): void {
    if (!this.localStream) {
      return;
    }

    if (this.ownerMuted()) {
      this.settingsNotice.set(OWNER_MUTED_NOTICE);
      return;
    }

    const nextMuted = !this.localMuted();
    this.localMuted.set(nextMuted);
    this.applyLocalTrackState();

    this.updateParticipant(this.selfId ?? 'local', {
      muted: nextMuted,
      speaking: nextMuted ? false : this.getParticipant(this.selfId ?? 'local')?.speaking ?? false
    });
    this.sendSignal({
      type: 'mute_state',
      muted: nextMuted
    });
  }

  async refreshDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    this.devicesLoading.set(true);
    this.settingsNotice.set(null);

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter((device) => device.kind === 'audioinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Микрофон ${index + 1}`
        }));
      const outputs = devices
        .filter((device) => device.kind === 'audiooutput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Вывод ${index + 1}`
        }));

      this.inputDevices.set(inputs);
      this.outputDevices.set(outputs);
    } catch {
      this.settingsNotice.set('Не удалось получить список аудиоустройств');
    } finally {
      this.devicesLoading.set(false);
    }
  }

  async updateInputDevice(deviceId: string | null): Promise<void> {
    this.updateSettings({
      inputDeviceId: deviceId || null
    });
    await this.refreshDevices();
    await this.reconnectIfNeeded();
  }

  async updateOutputDevice(deviceId: string | null): Promise<void> {
    this.updateSettings({
      outputDeviceId: deviceId || null
    });
    await this.applyAudioOutputPreferences();
  }

  updateSensitivity(value: number): void {
    this.updateSettings({
      sensitivity: clamp(value, 0, 100)
    });
  }

  updateMicrophoneGain(value: number): void {
    const usedProcessedStream = this.usesProcessedLocalStream();
    this.updateSettings({
      microphoneGain: clamp(value, 0, MAX_AUDIO_GAIN_PERCENT)
    });
    const shouldUseProcessedStream = this.usesProcessedLocalStream();
    if (usedProcessedStream !== shouldUseProcessedStream) {
      void this.rebuildLocalStreamForCurrentSettings().catch(() => undefined);
      return;
    }
    this.applyLocalMicrophoneGain();
  }

  updateMasterVolume(value: number): void {
    this.updateSettings({
      masterVolume: clamp(value, 0, MAX_AUDIO_GAIN_PERCENT)
    });
    this.applyAllRemoteVolumes();
  }

  updateParticipantVolume(userId: string, value: number): void {
    const nextVolume = clamp(value, 0, MAX_AUDIO_GAIN_PERCENT);
    const participantVolumes = {
      ...this.settings().participantVolumes,
      [userId]: nextVolume
    };

    this.updateSettings({
      participantVolumes
    });
    this.applyVolumesForUser(userId);
  }

  getParticipantVolume(userId: string): number {
    return clamp(this.settings().participantVolumes[userId] ?? 100, 0, MAX_AUDIO_GAIN_PERCENT);
  }

  private updateSettings(patch: Partial<VoiceSettings>): void {
    const nextSettings: VoiceSettings = {
      ...this.settings(),
      ...patch,
      participantVolumes: patch.participantVolumes ?? this.settings().participantVolumes
    };
    this.settings.set(nextSettings);
    saveVoiceSettings(nextSettings);
  }

  private async reconnectIfNeeded(): Promise<void> {
    if (!this.lastJoinContext || !this.activeChannelId()) {
      return;
    }

    await this.join(
      this.lastJoinContext.channelId,
      this.lastJoinContext.token,
      this.lastJoinContext.currentUser,
      true
    );
  }

  private async createProcessedLocalStream(rawLocalStream: MediaStream): Promise<MediaStream> {
    if (!this.usesProcessedLocalStream()) {
      this.disposeLocalAudioPipeline();
      return rawLocalStream;
    }

    const audioContext = await this.ensureAudioContext();
    if (!audioContext) {
      this.disposeLocalAudioPipeline();
      return rawLocalStream;
    }

    this.disposeLocalAudioPipeline();

    const source = audioContext.createMediaStreamSource(rawLocalStream);
    const gainNode = audioContext.createGain();
    const destination = audioContext.createMediaStreamDestination();

    source.connect(gainNode);
    gainNode.connect(destination);

    this.localAudioPipeline = {
      source,
      gainNode,
      destination
    };
    this.applyLocalMicrophoneGain();

    return destination.stream;
  }

  private applyLocalMicrophoneGain(): void {
    if (!this.localAudioPipeline || !this.audioContext) {
      return;
    }

    this.localAudioPipeline.gainNode.gain.setValueAtTime(this.getMicrophoneGainMultiplier(), this.audioContext.currentTime);
  }

  private getMicrophoneGainMultiplier(): number {
    return clamp(this.settings().microphoneGain / 100, 0, 2);
  }

  private usesProcessedLocalStream(): boolean {
    return this.settings().microphoneGain !== 100;
  }

  private async rebuildLocalStreamForCurrentSettings(): Promise<void> {
    if (!this.rawLocalStream) {
      return;
    }

    const previousLocalStream = this.localStream;
    const nextLocalStream = await this.createProcessedLocalStream(this.rawLocalStream);
    this.localStream = nextLocalStream;
    this.applyLocalTrackState();

    const nextAudioTrack = nextLocalStream.getAudioTracks()[0] ?? null;
    const replaceTrackTasks: Promise<void>[] = [];

    for (const connection of this.peerConnections.values()) {
      const sender = connection.getSenders().find((item) => item.track?.kind === 'audio');
      if (!sender) {
        continue;
      }

      replaceTrackTasks.push(sender.replaceTrack(nextAudioTrack));
    }

    await Promise.allSettled(replaceTrackTasks);

    if (previousLocalStream && previousLocalStream !== this.rawLocalStream && previousLocalStream !== nextLocalStream) {
      for (const track of previousLocalStream.getTracks()) {
        track.stop();
      }
    }
  }

  private async openLocalStream(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Браузер не поддерживает доступ к микрофону');
    }

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      throw new Error('На телефоне микрофон и голосовой канал работают только через HTTPS или localhost. Откройте Altgramm по защищенному домену.');
    }

    const settings = this.settings();
    const withSelectedDevice: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    };

    if (settings.inputDeviceId) {
      withSelectedDevice.deviceId = {
        exact: settings.inputDeviceId
      };
    }

    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: withSelectedDevice
      });
    } catch (error) {
      if (settings.inputDeviceId) {
        this.settingsNotice.set('Выбранный микрофон недоступен, подключаемся через устройство по умолчанию');
      }

      return navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    }
  }

  private async openSocket(channelId: string, token: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${WS_BASE_URL}/api/voice/channels/${channelId}/ws?token=${encodeURIComponent(token)}`);
      this.socket = socket;

      let opened = false;

      socket.onopen = () => {
        opened = true;
        this.startSocketKeepAlive();
        resolve();
      };
      socket.onerror = () => reject(new Error('Не удалось установить signaling-соединение'));
      socket.onclose = (event) => {
        if (this.socket !== socket) {
          return;
        }

        this.stopSocketKeepAlive();
        if (!opened) {
          reject(new Error('Не удалось установить signaling-соединение для голосового канала'));
          return;
        }

        const failureMessage =
          event.code === 4003
            ? 'Владелец закрыл вам доступ к голосовому каналу'
            : 'Соединение голосового канала прервано';
        this.handleFailure(failureMessage);
      };
      socket.onmessage = (event) => {
        this.handleSocketMessage(event.data);
      };
    });
  }

  private handleSocketMessage(rawMessage: string): void {
    const message = JSON.parse(rawMessage) as IncomingVoiceMessage;

    if (message.type === 'room_state') {
      void this.handleRoomState(message).catch((error) => {
        this.handleFailure(error instanceof Error ? error.message : 'Не удалось обработать состояние голосовой комнаты');
      });
      return;
    }

    if (message.type === 'peer_joined') {
      this.upsertParticipant(message.participant);
      return;
    }

    if (message.type === 'peer_left') {
      this.removeParticipant(message.participant_id);
      this.destroyPeer(message.participant_id);
      return;
    }

    if (message.type === 'mute_state') {
      this.updateParticipant(message.participant_id, { muted: message.muted });
      return;
    }

    if (message.type === 'owner_mute_state') {
      this.handleOwnerMuteState(message.participant_id, message.owner_muted);
      return;
    }

    if (message.type === 'offer') {
      void this.handleIncomingOffer(message.from_id, message.payload as RTCSessionDescriptionInit).catch((error) => {
        this.handlePeerConnectionFailure(
          message.from_id,
          error instanceof Error ? error.message : 'Не удалось принять входящее голосовое предложение'
        );
      });
      return;
    }

    if (message.type === 'answer') {
      void this.handleIncomingAnswer(message.from_id, message.payload as RTCSessionDescriptionInit).catch((error) => {
        this.handlePeerConnectionFailure(
          message.from_id,
          error instanceof Error ? error.message : 'Не удалось обработать ответ голосового соединения'
        );
      });
      return;
    }

    if (message.type === 'ice_candidate') {
      void this.handleIncomingIceCandidate(message.from_id, message.payload as RTCIceCandidateInit).catch((error) => {
        this.handlePeerConnectionFailure(
          message.from_id,
          error instanceof Error ? error.message : 'Не удалось применить ICE-кандидат голосового соединения'
        );
      });
      return;
    }

    if (message.type === 'error') {
      this.settingsNotice.set(message.detail);
    }
  }

  private async handleRoomState(message: RoomStateMessage): Promise<void> {
    this.selfId = message.self_id;
    this.updateLocalParticipantId(message.self_id);
    this.upsertParticipant(message.self_participant);
    this.applyLocalTrackState();
    for (const participant of message.participants) {
      this.upsertParticipant(participant);
    }

    this.state.set('connected');
    await this.startLocalVoiceActivityMonitor().catch(() => undefined);

    for (const participant of message.participants) {
      try {
        await this.createOfferForParticipant(participant.id);
      } catch (error) {
        this.handlePeerConnectionFailure(
          participant.id,
          error instanceof Error ? error.message : 'Не удалось подключить участника к голосовой комнате'
        );
      }
    }
  }

  private async createOfferForParticipant(participantId: string): Promise<void> {
    if (!this.socket || !this.localStream) {
      return;
    }

    const connection = this.ensurePeerConnection(participantId);
    const offer = await connection.createOffer({
      offerToReceiveAudio: true
    });
    await connection.setLocalDescription(offer);

    this.sendSignal({
      type: 'offer',
      target_id: participantId,
      payload: connection.localDescription
    });
  }

  private async handleIncomingOffer(participantId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    const connection = this.ensurePeerConnection(participantId);
    await connection.setRemoteDescription(new RTCSessionDescription(offer));
    await this.flushPendingIceCandidates(participantId);

    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);

    this.sendSignal({
      type: 'answer',
      target_id: participantId,
      payload: connection.localDescription
    });
  }

  private async handleIncomingAnswer(participantId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const connection = this.ensurePeerConnection(participantId);
    await connection.setRemoteDescription(new RTCSessionDescription(answer));
    await this.flushPendingIceCandidates(participantId);
  }

  private async handleIncomingIceCandidate(participantId: string, candidate: RTCIceCandidateInit): Promise<void> {
    if (!candidate.candidate) {
      return;
    }

    const connection = this.ensurePeerConnection(participantId);
    if (!connection.remoteDescription) {
      const queue = this.pendingIceCandidates.get(participantId) ?? [];
      queue.push(candidate);
      this.pendingIceCandidates.set(participantId, queue);
      return;
    }

    await connection.addIceCandidate(new RTCIceCandidate(candidate));
  }

  private async flushPendingIceCandidates(participantId: string): Promise<void> {
    const connection = this.peerConnections.get(participantId);
    const candidates = this.pendingIceCandidates.get(participantId);
    if (!connection || !candidates?.length) {
      return;
    }

    for (const candidate of candidates) {
      await connection.addIceCandidate(new RTCIceCandidate(candidate));
    }
    this.pendingIceCandidates.delete(participantId);
  }

  private ensurePeerConnection(participantId: string): RTCPeerConnection {
    const existingConnection = this.peerConnections.get(participantId);
    if (existingConnection) {
      return existingConnection;
    }

    const connection = new RTCPeerConnection({ iceServers: VOICE_ICE_SERVERS });

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        connection.addTrack(track, this.localStream);
      }
    }

    connection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      this.sendSignal({
        type: 'ice_candidate',
        target_id: participantId,
        payload: event.candidate.toJSON()
      });
    };

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) {
        return;
      }

      void this.attachRemoteAudio(participantId, stream);
      void this.startRemoteVoiceActivityMonitor(participantId, stream).catch(() => undefined);
    };

    this.peerConnections.set(participantId, connection);
    return connection;
  }

  private sendSignal(payload: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(payload));
  }

  private applyLocalTrackState(): void {
    if (!this.rawLocalStream && !this.localStream) {
      return;
    }

    const enabled = !(this.localMuted() || this.ownerMuted());
    for (const track of this.rawLocalStream?.getAudioTracks() ?? []) {
      track.enabled = enabled;
    }
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      track.enabled = enabled;
    }
  }

  private handleOwnerMuteState(participantId: string, ownerMuted: boolean): void {
    this.updateParticipant(participantId, {
      owner_muted: ownerMuted,
      speaking: ownerMuted ? false : this.getParticipant(participantId)?.speaking ?? false
    });

    if (participantId === (this.selfId ?? 'local')) {
      this.applyLocalTrackState();
      if (ownerMuted) {
        this.settingsNotice.set(OWNER_MUTED_NOTICE);
      } else if (this.settingsNotice() === OWNER_MUTED_NOTICE) {
        this.settingsNotice.set(null);
      }
    }
  }

  private async attachRemoteAudio(participantId: string, stream: MediaStream): Promise<void> {
    const remoteAudioOutput = await this.ensureRemoteAudioOutput(participantId, stream);
    const audioElement = remoteAudioOutput.audioElement;
    void this.applyOutputDevice(audioElement).catch(() => undefined);
    this.applyVolumeToAudioElement(participantId);
    void this.playRemoteAudio(participantId, audioElement);
  }

  private async playRemoteAudio(participantId: string, audioElement: HTMLAudioElement): Promise<void> {
    try {
      await audioElement.play();
      this.pendingPlaybackUnlock.delete(participantId);
      if (!this.pendingPlaybackUnlock.size) {
        this.detachUserGestureUnlock();
      }
    } catch {
      this.pendingPlaybackUnlock.add(participantId);
      this.attachUserGestureUnlock();
      this.settingsNotice.set('На телефоне коснитесь экрана еще раз, если браузер не начал воспроизводить голос автоматически.');
    }
  }

  private async applyOutputDevice(audioElement: HTMLAudioElement): Promise<void> {
    const outputDeviceId = this.settings().outputDeviceId;
    const sinkCapableElement = audioElement as HTMLAudioElement & {
      setSinkId?: (sinkId: string) => Promise<void>;
    };

    if (!outputDeviceId || !sinkCapableElement.setSinkId) {
      return;
    }

    try {
      await sinkCapableElement.setSinkId(outputDeviceId);
      this.settingsNotice.set(null);
    } catch {
      this.settingsNotice.set('Браузер не дал переключить устройство вывода звука');
    }
  }

  private async applyAudioOutputPreferences(): Promise<void> {
    for (const remoteAudioOutput of this.remoteAudioOutputs.values()) {
      await this.applyOutputDevice(remoteAudioOutput.audioElement).catch(() => undefined);
    }
    this.applyAllRemoteVolumes();
  }

  private applyAllRemoteVolumes(): void {
    for (const participantId of this.remoteAudioOutputs.keys()) {
      this.applyVolumeToAudioElement(participantId);
    }
  }

  private applyVolumesForUser(userId: string): void {
    for (const [participantId, participantUserId] of this.participantUserIds.entries()) {
      if (participantUserId === userId) {
        this.applyVolumeToAudioElement(participantId);
      }
    }
  }

  private applyVolumeToAudioElement(participantId: string): void {
    const remoteAudioOutput = this.remoteAudioOutputs.get(participantId);
    const userId = this.participantUserIds.get(participantId);
    if (!remoteAudioOutput || !userId) {
      return;
    }

    const effectiveGain = this.getRemoteParticipantGain(userId);
    const shouldUseGraph = this.shouldUseRemoteAudioGraph(userId);
    if (remoteAudioOutput.inputStream && shouldUseGraph !== Boolean(remoteAudioOutput.gainNode)) {
      void this.refreshRemoteAudioOutput(participantId).catch(() => undefined);
      if (!shouldUseGraph) {
        remoteAudioOutput.audioElement.volume = clamp(effectiveGain, 0, 1);
      }
      return;
    }

    if (remoteAudioOutput.gainNode && this.audioContext) {
      remoteAudioOutput.gainNode.gain.setValueAtTime(effectiveGain, this.audioContext.currentTime);
      remoteAudioOutput.audioElement.volume = 1;
      return;
    }

    remoteAudioOutput.audioElement.volume = clamp(effectiveGain, 0, 1);
  }

  private getRemoteParticipantGain(userId: string): number {
    const effectiveGain = (this.settings().masterVolume / 100) * (this.getParticipantVolume(userId) / 100);
    return clamp(effectiveGain, 0, 2);
  }

  private shouldUseRemoteAudioGraph(userId: string): boolean {
    return this.getRemoteParticipantGain(userId) > 1;
  }

  private async ensureRemoteAudioOutput(participantId: string, stream: MediaStream): Promise<RemoteAudioOutput> {
    let remoteAudioOutput = this.remoteAudioOutputs.get(participantId);
    if (!remoteAudioOutput) {
      const audioElement = document.createElement('audio');
      audioElement.autoplay = true;
      audioElement.setAttribute('playsinline', 'true');
      audioElement.style.display = 'none';
      document.body.appendChild(audioElement);

      remoteAudioOutput = {
        audioElement,
        inputStream: null,
        source: null,
        gainNode: null,
        destination: null
      };
      this.remoteAudioOutputs.set(participantId, remoteAudioOutput);
    }

    remoteAudioOutput.inputStream = stream;
    this.disposeRemoteAudioGraph(remoteAudioOutput);

    const userId = this.participantUserIds.get(participantId);
    if (!userId || !this.shouldUseRemoteAudioGraph(userId)) {
      remoteAudioOutput.audioElement.srcObject = stream;
      return remoteAudioOutput;
    }

    const audioContext = await this.ensureAudioContext();
    if (!audioContext) {
      remoteAudioOutput.audioElement.srcObject = stream;
      return remoteAudioOutput;
    }

    const source = audioContext.createMediaStreamSource(stream);
    const gainNode = audioContext.createGain();
    const destination = audioContext.createMediaStreamDestination();

    source.connect(gainNode);
    gainNode.connect(destination);

    remoteAudioOutput.source = source;
    remoteAudioOutput.gainNode = gainNode;
    remoteAudioOutput.destination = destination;
    remoteAudioOutput.audioElement.srcObject = destination.stream;

    return remoteAudioOutput;
  }

  private async refreshRemoteAudioOutput(participantId: string): Promise<void> {
    const remoteAudioOutput = this.remoteAudioOutputs.get(participantId);
    const inputStream = remoteAudioOutput?.inputStream;
    if (!remoteAudioOutput || !inputStream) {
      return;
    }

    const output = await this.ensureRemoteAudioOutput(participantId, inputStream);
    await this.applyOutputDevice(output.audioElement).catch(() => undefined);
    this.applyVolumeToAudioElement(participantId);
    await this.playRemoteAudio(participantId, output.audioElement).catch(() => undefined);
  }

  private disposeRemoteAudioGraph(remoteAudioOutput: RemoteAudioOutput): void {
    try {
      remoteAudioOutput.source?.disconnect();
    } catch {
      // ignore disconnect errors for already disposed graphs
    }

    try {
      remoteAudioOutput.gainNode?.disconnect();
    } catch {
      // ignore disconnect errors for already disposed graphs
    }

    remoteAudioOutput.source = null;
    remoteAudioOutput.gainNode = null;
    remoteAudioOutput.destination = null;
  }

  private updateLocalParticipantId(selfId: string): void {
    this.participants.update((participants) =>
      participants.map((participant) =>
        participant.is_self
          ? {
              ...participant,
              id: selfId
            }
          : participant
      )
    );
  }

  private upsertParticipant(participant: RemoteVoiceParticipant): void {
    this.participantUserIds.set(participant.id, participant.user_id);

    this.participants.update((participants) => {
      const existingParticipant = participants.find((entry) => entry.id === participant.id);
      if (existingParticipant) {
        return participants.map((entry) =>
          entry.id === participant.id
            ? {
                ...entry,
                nick: participant.nick,
                avatar_updated_at: participant.avatar_updated_at,
                muted: participant.muted,
                owner_muted: participant.owner_muted
              }
            : entry
        );
      }

      return [
        ...participants,
        {
          ...participant,
          speaking: false,
          is_self: participant.id === this.selfId
        }
      ];
    });

    this.applyVolumesForUser(participant.user_id);
  }

  private updateParticipant(participantId: string, patch: Partial<VoiceParticipant>): void {
    this.participants.update((participants) =>
      participants.map((participant) => (participant.id === participantId ? { ...participant, ...patch } : participant))
    );
  }

  private removeParticipant(participantId: string): void {
    this.participants.update((participants) =>
      participants.filter((participant) => participant.id !== participantId)
    );
    this.participantUserIds.delete(participantId);
  }

  private destroyPeer(participantId: string): void {
    this.stopRemoteVoiceActivityMonitor(participantId);

    const connection = this.peerConnections.get(participantId);
    if (connection) {
      connection.close();
      this.peerConnections.delete(participantId);
    }

    const remoteAudioOutput = this.remoteAudioOutputs.get(participantId);
    if (remoteAudioOutput) {
      this.disposeRemoteAudioGraph(remoteAudioOutput);
      remoteAudioOutput.inputStream = null;
      remoteAudioOutput.audioElement.srcObject = null;
      remoteAudioOutput.audioElement.remove();
      this.remoteAudioOutputs.delete(participantId);
    }

    this.pendingIceCandidates.delete(participantId);
    this.participantUserIds.delete(participantId);
    this.pendingPlaybackUnlock.delete(participantId);
    if (!this.pendingPlaybackUnlock.size) {
      this.detachUserGestureUnlock();
    }
  }

  private teardownPeerConnections(): void {
    for (const participantId of this.peerConnections.keys()) {
      this.destroyPeer(participantId);
    }
  }

  private teardownSocket(): void {
    if (!this.socket) {
      this.stopSocketKeepAlive();
      return;
    }

    this.stopSocketKeepAlive();
    this.socket.onclose = null;
    this.socket.onerror = null;
    this.socket.onmessage = null;
    this.socket.close();
    this.socket = null;
  }

  private stopLocalStream(): void {
    for (const track of this.rawLocalStream?.getTracks() ?? []) {
      track.stop();
    }
    if (this.localStream && this.localStream !== this.rawLocalStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
    }

    this.disposeLocalAudioPipeline();
    this.rawLocalStream = null;
    this.localStream = null;
  }

  private clearAudioElements(): void {
    for (const remoteAudioOutput of this.remoteAudioOutputs.values()) {
      this.disposeRemoteAudioGraph(remoteAudioOutput);
      remoteAudioOutput.audioElement.srcObject = null;
      remoteAudioOutput.audioElement.remove();
    }
    this.remoteAudioOutputs.clear();
  }

  private handlePeerConnectionFailure(participantId: string, message: string): void {
    this.settingsNotice.set(message);
    this.removeParticipant(participantId);
    this.destroyPeer(participantId);
    this.error.set(null);
    if (this.activeChannelId()) {
      this.state.set('connected');
    }
  }

  private handleFailure(message: string): void {
    this.stopVoiceActivityMonitoring();
    this.teardownSocket();
    this.teardownPeerConnections();
    this.stopLocalStream();
    this.clearAudioElements();
    this.pendingIceCandidates.clear();
    this.participantUserIds.clear();
    this.pendingPlaybackUnlock.clear();
    this.detachUserGestureUnlock();
    this.selfId = null;
    this.state.set('error');
    this.error.set(message);
    this.activeChannelId.set(null);
    this.participants.set([]);
    this.localMuted.set(false);
    if (this.settingsNotice() === OWNER_MUTED_NOTICE) {
      this.settingsNotice.set(null);
    }
  }

  private async startLocalVoiceActivityMonitor(): Promise<void> {
    const monitorStream = this.rawLocalStream ?? this.localStream;
    if (!monitorStream) {
      return;
    }

    const participantId = this.selfId ?? 'local';
    this.stopLocalVoiceActivityMonitor();
    this.localMonitor = await this.createVoiceActivityMonitor(
      participantId,
      monitorStream,
      () => this.localMuted() || this.ownerMuted()
    );
  }

  private async startRemoteVoiceActivityMonitor(participantId: string, stream: MediaStream): Promise<void> {
    this.stopRemoteVoiceActivityMonitor(participantId);
    const monitor = await this.createVoiceActivityMonitor(
      participantId,
      stream,
      () => {
        const participant = this.getParticipant(participantId);
        return participant?.muted === true || participant?.owner_muted === true;
      }
    );
    if (monitor) {
      this.remoteMonitors.set(participantId, monitor);
    }
  }

  private async createVoiceActivityMonitor(
    participantId: string,
    stream: MediaStream,
    isMuted: () => boolean
  ): Promise<VoiceActivityMonitor | null> {
    const audioContext = await this.ensureAudioContext();
    if (!audioContext) {
      return null;
    }

    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.22;
    source.connect(analyser);

    const monitor: VoiceActivityMonitor = {
      analyser,
      intervalId: 0,
      lastDetectedAt: 0,
      source,
      samples: new Uint8Array(analyser.fftSize)
    };

    monitor.intervalId = window.setInterval(() => {
      if (isMuted()) {
        this.updateParticipant(participantId, { speaking: false });
        monitor.lastDetectedAt = 0;
        return;
      }

      const level = this.readVoiceActivityLevel(monitor);
      const now = Date.now();
      if (level >= this.getVoiceActivityThreshold()) {
        monitor.lastDetectedAt = now;
      }

      this.updateParticipant(participantId, {
        speaking: monitor.lastDetectedAt > 0 && now - monitor.lastDetectedAt <= VOICE_ACTIVITY_HOLD_MS
      });
    }, VOICE_ACTIVITY_INTERVAL_MS);

    return monitor;
  }

  private getVoiceActivityThreshold(): number {
    return 0.09 - (this.settings().sensitivity / 100) * 0.08;
  }

  private readVoiceActivityLevel(monitor: VoiceActivityMonitor): number {
    monitor.analyser.getByteTimeDomainData(monitor.samples);

    let squareSum = 0;
    for (const sample of monitor.samples) {
      const normalized = (sample - 128) / 128;
      squareSum += normalized * normalized;
    }

    return Math.sqrt(squareSum / monitor.samples.length);
  }

  private async ensureAudioContext(): Promise<AudioContext | null> {
    const audioContext = this.audioContext ?? this.createAudioContext();
    if (!audioContext) {
      return null;
    }

    this.audioContext = audioContext;

    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch {
        return null;
      }
    }

    return audioContext;
  }

  private startSocketKeepAlive(): void {
    this.stopSocketKeepAlive();

    this.socketPingIntervalId = window.setInterval(() => {
      this.sendSignal({
        type: 'ping'
      });
    }, VOICE_SOCKET_PING_INTERVAL_MS);
  }

  private stopSocketKeepAlive(): void {
    if (this.socketPingIntervalId === null) {
      return;
    }

    window.clearInterval(this.socketPingIntervalId);
    this.socketPingIntervalId = null;
  }

  private createAudioContext(): AudioContext | null {
    const AudioContextCtor = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    return AudioContextCtor ? new AudioContextCtor() : null;
  }

  private attachUserGestureUnlock(): void {
    if (typeof window === 'undefined' || this.userGestureUnlockHandler) {
      return;
    }

    this.userGestureUnlockHandler = () => {
      void this.retryPendingAudioPlayback();
    };

    window.addEventListener('touchstart', this.userGestureUnlockHandler, { passive: true });
    window.addEventListener('click', this.userGestureUnlockHandler);
  }

  private detachUserGestureUnlock(): void {
    if (typeof window === 'undefined' || !this.userGestureUnlockHandler) {
      return;
    }

    window.removeEventListener('touchstart', this.userGestureUnlockHandler);
    window.removeEventListener('click', this.userGestureUnlockHandler);
    this.userGestureUnlockHandler = null;
  }

  private async retryPendingAudioPlayback(): Promise<void> {
    await this.ensureAudioContext().catch(() => null);

    for (const participantId of [...this.pendingPlaybackUnlock]) {
      const audioElement = this.remoteAudioOutputs.get(participantId)?.audioElement;
      if (!audioElement) {
        this.pendingPlaybackUnlock.delete(participantId);
        continue;
      }

      try {
        await audioElement.play();
        this.pendingPlaybackUnlock.delete(participantId);
      } catch {
        return;
      }
    }

    if (!this.pendingPlaybackUnlock.size) {
      this.settingsNotice.set(null);
      this.detachUserGestureUnlock();
    }
  }

  private stopVoiceActivityMonitoring(): void {
    this.stopLocalVoiceActivityMonitor();

    for (const participantId of this.remoteMonitors.keys()) {
      this.stopRemoteVoiceActivityMonitor(participantId);
    }

    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }

    this.disposeLocalAudioPipeline();
  }

  private stopLocalVoiceActivityMonitor(): void {
    if (!this.localMonitor) {
      return;
    }

    this.disposeVoiceActivityMonitor(this.localMonitor);
    this.localMonitor = null;
  }

  private disposeLocalAudioPipeline(): void {
    if (!this.localAudioPipeline) {
      return;
    }

    try {
      this.localAudioPipeline.source.disconnect();
    } catch {
      // ignore disconnect errors for already disposed graphs
    }

    try {
      this.localAudioPipeline.gainNode.disconnect();
    } catch {
      // ignore disconnect errors for already disposed graphs
    }

    this.localAudioPipeline = null;
  }

  private stopRemoteVoiceActivityMonitor(participantId: string): void {
    const monitor = this.remoteMonitors.get(participantId);
    if (!monitor) {
      return;
    }

    this.disposeVoiceActivityMonitor(monitor);
    this.remoteMonitors.delete(participantId);
  }

  private disposeVoiceActivityMonitor(monitor: VoiceActivityMonitor): void {
    if (monitor.intervalId) {
      window.clearInterval(monitor.intervalId);
    }

    try {
      monitor.source.disconnect();
    } catch {
      return;
    }
  }

  private getParticipant(participantId: string): VoiceParticipant | undefined {
    return this.participants().find((participant) => participant.id === participantId);
  }
}
