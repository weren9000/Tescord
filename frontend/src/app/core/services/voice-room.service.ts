import { Injectable, computed, signal } from '@angular/core';

import { WS_BASE_URL } from '../api/api-base';
import { CurrentUserResponse } from '../models/workspace.models';

export interface VoiceParticipant {
  id: string;
  user_id: string;
  nick: string;
  full_name: string;
  muted: boolean;
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
  masterVolume: number;
  participantVolumes: Record<string, number>;
}

type VoiceSignalType = 'offer' | 'answer' | 'ice_candidate';
type VoiceConnectionState = 'idle' | 'connecting' | 'connected' | 'error';

interface RoomStateMessage {
  type: 'room_state';
  self_id: string;
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

interface ErrorMessage {
  type: 'error';
  detail: string;
}

interface RemoteVoiceParticipant {
  id: string;
  user_id: string;
  nick: string;
  full_name: string;
  muted: boolean;
}

interface VoiceActivityMonitor {
  analyser: AnalyserNode;
  intervalId: number;
  lastDetectedAt: number;
  source: MediaStreamAudioSourceNode;
  samples: Uint8Array;
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
  | ErrorMessage
  | { type: 'pong' };

const ICE_SERVERS: RTCIceServer[] = [
  {
    urls: 'stun:stun.l.google.com:19302'
  }
];
const SETTINGS_STORAGE_KEY = 'tescord.voice.settings';
const VOICE_ACTIVITY_INTERVAL_MS = 120;
const VOICE_ACTIVITY_HOLD_MS = 320;
const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  inputDeviceId: null,
  outputDeviceId: null,
  sensitivity: 58,
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
    return {
      inputDeviceId: parsed.inputDeviceId ?? null,
      outputDeviceId: parsed.outputDeviceId ?? null,
      sensitivity: clamp(parsed.sensitivity ?? DEFAULT_VOICE_SETTINGS.sensitivity, 0, 100),
      masterVolume: clamp(parsed.masterVolume ?? DEFAULT_VOICE_SETTINGS.masterVolume, 0, 100),
      participantVolumes: parsed.participantVolumes ?? {}
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
  private localStream: MediaStream | null = null;
  private selfId: string | null = null;
  private lastJoinContext: VoiceJoinContext | null = null;
  private readonly peerConnections = new Map<string, RTCPeerConnection>();
  private readonly pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();
  private readonly remoteMonitors = new Map<string, VoiceActivityMonitor>();
  private readonly remoteAudioElements = new Map<string, HTMLAudioElement>();
  private readonly participantUserIds = new Map<string, string>();

  readonly state = signal<VoiceConnectionState>('idle');
  readonly error = signal<string | null>(null);
  readonly settingsNotice = signal<string | null>(null);
  readonly activeChannelId = signal<string | null>(null);
  readonly participants = signal<VoiceParticipant[]>([]);
  readonly localMuted = signal(false);
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
        full_name: currentUser.full_name,
        muted: false,
        speaking: false,
        is_self: true
      }
    ]);

    try {
      this.localStream = await this.openLocalStream();
      this.localMuted.set(false);
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
    this.selfId = null;
    this.state.set('idle');
    this.error.set(null);
    this.activeChannelId.set(null);
    this.participants.set([]);
    this.localMuted.set(false);
  }

  toggleMute(): void {
    if (!this.localStream) {
      return;
    }

    const nextMuted = !this.localMuted();
    this.localMuted.set(nextMuted);

    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !nextMuted;
    }

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

  updateMasterVolume(value: number): void {
    this.updateSettings({
      masterVolume: clamp(value, 0, 100)
    });
    this.applyAllRemoteVolumes();
  }

  updateParticipantVolume(userId: string, value: number): void {
    const nextVolume = clamp(value, 0, 100);
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
    return clamp(this.settings().participantVolumes[userId] ?? 100, 0, 100);
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

  private async openLocalStream(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Браузер не поддерживает доступ к микрофону');
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

      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error('Не удалось установить signaling-соединение'));
      socket.onclose = () => {
        if (this.socket !== socket) {
          return;
        }

        this.handleFailure('Голосовое соединение закрыто');
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

    if (message.type === 'offer') {
      void this.handleIncomingOffer(message.from_id, message.payload as RTCSessionDescriptionInit).catch((error) => {
        this.handleFailure(error instanceof Error ? error.message : 'Не удалось принять offer');
      });
      return;
    }

    if (message.type === 'answer') {
      void this.handleIncomingAnswer(message.from_id, message.payload as RTCSessionDescriptionInit).catch((error) => {
        this.handleFailure(error instanceof Error ? error.message : 'Не удалось принять answer');
      });
      return;
    }

    if (message.type === 'ice_candidate') {
      void this.handleIncomingIceCandidate(message.from_id, message.payload as RTCIceCandidateInit).catch((error) => {
        this.handleFailure(error instanceof Error ? error.message : 'Не удалось обработать ICE candidate');
      });
      return;
    }

    if (message.type === 'error') {
      this.error.set(message.detail);
      this.state.set('error');
    }
  }

  private async handleRoomState(message: RoomStateMessage): Promise<void> {
    this.selfId = message.self_id;
    this.updateLocalParticipantId(message.self_id);
    for (const participant of message.participants) {
      this.upsertParticipant(participant);
    }

    this.state.set('connected');
    await this.startLocalVoiceActivityMonitor().catch(() => undefined);

    for (const participant of message.participants) {
      await this.createOfferForParticipant(participant.id);
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

    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });

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

      this.attachRemoteAudio(participantId, stream);
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

  private attachRemoteAudio(participantId: string, stream: MediaStream): void {
    let audioElement = this.remoteAudioElements.get(participantId);
    if (!audioElement) {
      audioElement = document.createElement('audio');
      audioElement.autoplay = true;
      audioElement.setAttribute('playsinline', 'true');
      audioElement.style.display = 'none';
      document.body.appendChild(audioElement);
      this.remoteAudioElements.set(participantId, audioElement);
    }

    audioElement.srcObject = stream;
    void this.applyOutputDevice(audioElement).catch(() => undefined);
    this.applyVolumeToAudioElement(participantId);
    void audioElement.play().catch(() => undefined);
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
    for (const audioElement of this.remoteAudioElements.values()) {
      await this.applyOutputDevice(audioElement).catch(() => undefined);
    }
    this.applyAllRemoteVolumes();
  }

  private applyAllRemoteVolumes(): void {
    for (const participantId of this.remoteAudioElements.keys()) {
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
    const audioElement = this.remoteAudioElements.get(participantId);
    const userId = this.participantUserIds.get(participantId);
    if (!audioElement || !userId) {
      return;
    }

    const effectiveVolume = (this.settings().masterVolume / 100) * (this.getParticipantVolume(userId) / 100);
    audioElement.volume = clamp(effectiveVolume, 0, 1);
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
                full_name: participant.full_name,
                muted: participant.muted
              }
            : entry
        );
      }

      return [
        ...participants,
        {
          ...participant,
          speaking: false,
          is_self: false
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

    const audioElement = this.remoteAudioElements.get(participantId);
    if (audioElement) {
      audioElement.srcObject = null;
      audioElement.remove();
      this.remoteAudioElements.delete(participantId);
    }

    this.pendingIceCandidates.delete(participantId);
    this.participantUserIds.delete(participantId);
  }

  private teardownPeerConnections(): void {
    for (const participantId of this.peerConnections.keys()) {
      this.destroyPeer(participantId);
    }
  }

  private teardownSocket(): void {
    if (!this.socket) {
      return;
    }

    this.socket.onclose = null;
    this.socket.onerror = null;
    this.socket.onmessage = null;
    this.socket.close();
    this.socket = null;
  }

  private stopLocalStream(): void {
    if (!this.localStream) {
      return;
    }

    for (const track of this.localStream.getTracks()) {
      track.stop();
    }
    this.localStream = null;
  }

  private clearAudioElements(): void {
    for (const audioElement of this.remoteAudioElements.values()) {
      audioElement.srcObject = null;
      audioElement.remove();
    }
    this.remoteAudioElements.clear();
  }

  private handleFailure(message: string): void {
    this.stopVoiceActivityMonitoring();
    this.teardownSocket();
    this.teardownPeerConnections();
    this.stopLocalStream();
    this.clearAudioElements();
    this.pendingIceCandidates.clear();
    this.participantUserIds.clear();
    this.selfId = null;
    this.state.set('error');
    this.error.set(message);
    this.activeChannelId.set(null);
    this.participants.set([]);
    this.localMuted.set(false);
  }

  private async startLocalVoiceActivityMonitor(): Promise<void> {
    if (!this.localStream) {
      return;
    }

    const participantId = this.selfId ?? 'local';
    this.stopLocalVoiceActivityMonitor();
    this.localMonitor = await this.createVoiceActivityMonitor(participantId, this.localStream, () => this.localMuted());
  }

  private async startRemoteVoiceActivityMonitor(participantId: string, stream: MediaStream): Promise<void> {
    this.stopRemoteVoiceActivityMonitor(participantId);
    const monitor = await this.createVoiceActivityMonitor(
      participantId,
      stream,
      () => this.getParticipant(participantId)?.muted === true
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

  private createAudioContext(): AudioContext | null {
    const AudioContextCtor = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    return AudioContextCtor ? new AudioContextCtor() : null;
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
  }

  private stopLocalVoiceActivityMonitor(): void {
    if (!this.localMonitor) {
      return;
    }

    this.disposeVoiceActivityMonitor(this.localMonitor);
    this.localMonitor = null;
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
