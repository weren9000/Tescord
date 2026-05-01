import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import {
  ConnectionState as LiveKitConnectionState,
  DisconnectReason,
  LocalAudioTrack,
  LocalVideoTrack,
  type Participant,
  type RemoteParticipant,
  RemoteAudioTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
  RemoteVideoTrack,
  Room,
  type RoomEventCallbacks,
  Track,
} from 'livekit-client';
import { firstValueFrom } from 'rxjs';

import { SFU_BASE_URL, VOICE_ICE_SERVERS, WS_BASE_URL } from '../api/api-base';
import { WorkspaceApiService } from '../api/workspace-api.service';
import { CurrentUserResponse, VoiceSfuTokenResponse } from '../models/workspace.models';
import { isIphoneLikeBrowser, prepareInlineMediaElement, requestCameraStream } from '../../shared/media-device.utils';

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

type VoiceConnectionState = 'idle' | 'connecting' | 'connected' | 'error';
type ReconnectMode = 'socket' | 'full';
type VoiceVideoSource = 'camera' | 'screen-share';

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
  | MuteStateMessage
  | OwnerMuteStateMessage
  | ErrorMessage
  | { type: 'pong' };

const SETTINGS_STORAGE_KEY = 'tescord.voice.settings';
const VOICE_SOCKET_PING_INTERVAL_MS = 20000;
const VOICE_RECONNECT_BASE_MS = 1000;
const VOICE_RECONNECT_MAX_MS = 10000;
const MIN_MICROPHONE_GAIN_PERCENT = 10;
const MAX_AUDIO_GAIN_PERCENT = 200;
const OWNER_MUTED_NOTICE = 'Микрофон заблокирован владельцем канала';
const CONTROL_RECONNECT_NOTICE = 'Связь с голосовой комнатой просела, переподключаемся';
const MEDIA_RECONNECT_NOTICE = 'Связь с медиасервером просела, переподключаемся';
const RECONNECT_RETRY_NOTICE = 'Не удалось быстро восстановить голос, пробуем ещё раз';
const AUDIO_UNLOCK_NOTICE = 'На телефоне коснитесь экрана ещё раз, если браузер не начал воспроизводить голос автоматически.';

const MICROPHONE_SILENCE_NOTICE = 'Микрофон подключён, но браузер получает тишину. Проверьте выбранный микрофон и входную громкость Windows.';

const TRANSIENT_NOTICES = new Set<string>([
  OWNER_MUTED_NOTICE,
  CONTROL_RECONNECT_NOTICE,
  MEDIA_RECONNECT_NOTICE,
  RECONNECT_RETRY_NOTICE,
  AUDIO_UNLOCK_NOTICE,
  MICROPHONE_SILENCE_NOTICE,
]);

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  inputDeviceId: null,
  outputDeviceId: null,
  sensitivity: 58,
  microphoneGain: 100,
  masterVolume: 100,
  participantVolumes: {},
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
          MAX_AUDIO_GAIN_PERCENT,
        );
        return accumulator;
      },
      {},
    );

    return {
      inputDeviceId: parsed.inputDeviceId ?? null,
      outputDeviceId: parsed.outputDeviceId ?? null,
      sensitivity: clamp(parsed.sensitivity ?? DEFAULT_VOICE_SETTINGS.sensitivity, 0, 100),
      microphoneGain: clamp(
        parsed.microphoneGain ?? DEFAULT_VOICE_SETTINGS.microphoneGain,
        MIN_MICROPHONE_GAIN_PERCENT,
        MAX_AUDIO_GAIN_PERCENT,
      ),
      masterVolume: clamp(parsed.masterVolume ?? DEFAULT_VOICE_SETTINGS.masterVolume, 0, MAX_AUDIO_GAIN_PERCENT),
      participantVolumes,
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
  providedIn: 'root',
})
export class VoiceRoomService {
  private readonly workspaceApi = inject(WorkspaceApiService);

  private audioContext: AudioContext | null = null;
  private controlSocket: WebSocket | null = null;
  private controlSocketPingIntervalId: number | null = null;
  private reconnectTimerId: number | null = null;
  private reconnectAttempt = 0;
  private reconnectMode: ReconnectMode | null = null;
  private room: Room | null = null;
  private roomEventDisposers: Array<() => void> = [];
  private rawLocalStream: MediaStream | null = null;
  private localStream: MediaStream | null = null;
  private localAudioPipeline: LocalAudioPipeline | null = null;
  private localAudioTrack: LocalAudioTrack | null = null;
  private localVideoStreamInternal: MediaStream | null = null;
  private localVideoTrackMedia: MediaStreamTrack | null = null;
  private localVideoTrack: LocalVideoTrack | null = null;
  private localScreenShareStreamInternal: MediaStream | null = null;
  private localScreenShareTrackMedia: MediaStreamTrack | null = null;
  private localScreenShareTrack: LocalVideoTrack | null = null;
  private selfId: string | null = null;
  private lastJoinContext: VoiceJoinContext | null = null;
  private pendingPlaybackUnlock = new Set<string>();
  private userGestureUnlockHandler: (() => void) | null = null;
  private activeSpeakerUserIds = new Set<string>();
  private readonly participantUserIds = new Map<string, string>();
  private readonly remoteAudioOutputs = new Map<string, RemoteAudioOutput>();
  private readonly remoteVideoTracks = new Map<string, RemoteVideoTrack>();
  private readonly remoteVideoStreamsByUserId = new Map<string, MediaStream>();
  private readonly remoteScreenShareTracks = new Map<string, RemoteVideoTrack>();
  private readonly remoteScreenShareStreamsByUserId = new Map<string, MediaStream>();

  readonly state = signal<VoiceConnectionState>('idle');
  readonly error = signal<string | null>(null);
  readonly settingsNotice = signal<string | null>(null);
  readonly activeChannelId = signal<string | null>(null);
  readonly participants = signal<VoiceParticipant[]>([]);
  readonly localMuted = signal(false);
  readonly localVideoStream = signal<MediaStream | null>(null);
  readonly localScreenShareStream = signal<MediaStream | null>(null);
  readonly remoteVideoStreams = signal<Record<string, MediaStream | null>>({});
  readonly remoteScreenShareStreams = signal<Record<string, MediaStream | null>>({});
  readonly ownerMuted = computed(() => this.getParticipant(this.selfId ?? 'local')?.owner_muted === true);
  readonly settings = signal<VoiceSettings>(loadVoiceSettings());
  readonly devicesLoading = signal(false);
  readonly inputDevices = signal<VoiceDeviceOption[]>([]);
  readonly outputDevices = signal<VoiceDeviceOption[]>([]);
  readonly isConnected = computed(() => this.state() === 'connected');
  readonly cameraSupported = computed(() => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia);
  readonly cameraEnabled = computed(() => this.localVideoStream() !== null);
  readonly screenShareSupported = computed(
    () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && !isIphoneLikeBrowser()
  );
  readonly screenShareEnabled = computed(() => this.localScreenShareStream() !== null);
  readonly outputDeviceSupported = computed(() => {
    if (typeof HTMLMediaElement === 'undefined') {
      return false;
    }

    return 'setSinkId' in HTMLMediaElement.prototype;
  });

  constructor() {
    saveVoiceSettings(this.settings());
    void this.refreshDevices();
  }

  async join(channelId: string, token: string, currentUser: CurrentUserResponse, force = false): Promise<void> {
    if (!force && this.activeChannelId() === channelId && (this.state() === 'connecting' || this.state() === 'connected')) {
      return;
    }

    const previousMuted = force && this.activeChannelId() === channelId ? this.localMuted() : false;
    const restoreCamera = force && this.activeChannelId() === channelId && this.cameraEnabled();

    await this.cleanupCurrentSession();

    this.lastJoinContext = {
      channelId,
      token,
      currentUser,
    };
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.reconnectMode = null;
    this.selfId = null;
    this.activeSpeakerUserIds.clear();
    this.state.set('connecting');
    this.error.set(null);
    this.activeChannelId.set(channelId);
    this.localMuted.set(previousMuted);
    this.setConnectingParticipants(currentUser, previousMuted);
    if (this.settingsNotice() === OWNER_MUTED_NOTICE) {
      this.settingsNotice.set(null);
    }

    try {
      void this.ensureAudioContext().catch(() => null);
      this.rawLocalStream = await this.openLocalStream();
      this.localStream = await this.createProcessedLocalStream(this.rawLocalStream);
      this.localAudioTrack = this.createLocalAudioTrack(this.localStream);
      if (!this.localAudioTrack) {
        throw new Error('Браузер подключил микрофон, но не отдал аудиодорожку');
      }
      this.applyLocalMuteState();
      await this.refreshDevices();

      const sfuToken = await firstValueFrom(this.workspaceApi.createVoiceSfuToken(token, channelId));
      await this.openControlSocket(channelId, token);
      await this.connectRoom(sfuToken);

      if (restoreCamera) {
        await this.startCamera();
      }

      this.clearReconnectNoticeIfReady();
      this.updateOperationalState();
    } catch (error) {
      await this.failSession(this.describeError(error, 'Не удалось подключиться к голосовому каналу'));
    }
  }

  leave(): void {
    void this.cleanupCurrentSession(true);
    this.state.set('idle');
    this.error.set(null);
    this.activeChannelId.set(null);
    this.participants.set([]);
    this.localMuted.set(false);
    this.remoteVideoStreams.set({});
    this.clearTransientNotice();
  }

  syncCurrentUserProfile(currentUser: CurrentUserResponse): void {
    if (this.lastJoinContext) {
      this.lastJoinContext = {
        ...this.lastJoinContext,
        currentUser,
      };
    }

    this.participants.update((participants) =>
      participants.map((participant) =>
        participant.user_id === currentUser.id
          ? {
              ...participant,
              nick: currentUser.nick,
              avatar_updated_at: currentUser.avatar_updated_at,
            }
          : participant,
      ),
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
          avatar_updated_at: snapshot.avatar_updated_at,
        };
      }),
    );
  }

  toggleMute(): void {
    if (!this.localAudioTrack) {
      return;
    }

    if (this.ownerMuted()) {
      this.settingsNotice.set(OWNER_MUTED_NOTICE);
      return;
    }

    const nextMuted = !this.localMuted();
    this.localMuted.set(nextMuted);
    this.applyLocalMuteState();
    this.updateParticipant(this.selfId ?? 'local', {
      muted: nextMuted,
      speaking: nextMuted ? false : this.activeSpeakerUserIds.has(this.lastJoinContext?.currentUser.id ?? ''),
    });
    this.sendControlMessage({
      type: 'mute_state',
      muted: nextMuted,
    });
  }

  async startCamera(): Promise<void> {
    if (!this.cameraSupported()) {
      this.settingsNotice.set('Браузер не поддерживает доступ к камере');
      return;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      this.settingsNotice.set('Камера работает только через HTTPS или localhost');
      return;
    }

    if (!this.room || this.room.state !== LiveKitConnectionState.Connected || !this.activeChannelId()) {
      this.settingsNotice.set('Сначала подключитесь к голосовому каналу');
      return;
    }

    if (this.localVideoTrack) {
      return;
    }

    try {
      const stream = await requestCameraStream({
        width: { ideal: 960, max: 1280 },
        height: { ideal: 540, max: 720 },
        frameRate: { ideal: 20, max: 24 },
        facingMode: 'user',
      });
      const [track] = stream.getVideoTracks();
      if (!track) {
        throw new Error('Не удалось получить видеодорожку камеры');
      }

      const localVideoTrack = new LocalVideoTrack(track, undefined, true);
      await this.room.localParticipant.publishTrack(localVideoTrack, {
        source: Track.Source.Camera,
      });

      track.onended = () => {
        if (this.localVideoTrackMedia?.id === track.id) {
          void this.stopCamera();
        }
      };

      this.localVideoTrackMedia = track;
      this.localVideoTrack = localVideoTrack;
      this.localVideoStreamInternal = stream;
      this.localVideoStream.set(stream);
      this.settingsNotice.set(null);
    } catch (error) {
      this.clearLocalCamera();
      this.settingsNotice.set(this.describeError(error, 'Не удалось включить камеру'));
    }
  }

  async stopCamera(): Promise<void> {
    const room = this.room;
    const localVideoTrack = this.localVideoTrack;
    this.clearLocalCamera();

    if (!room || !localVideoTrack) {
      return;
    }

    await room.localParticipant.unpublishTrack(localVideoTrack, false).catch(() => undefined);
  }

  toggleCamera(): void {
    if (this.cameraEnabled()) {
      void this.stopCamera();
      return;
    }

    void this.startCamera();
  }

  remoteVideoStreamForParticipant(participantId: string): MediaStream | null {
    return this.remoteVideoStreams()[participantId] ?? null;
  }

  remoteScreenShareStreamForParticipant(participantId: string): MediaStream | null {
    return this.remoteScreenShareStreams()[participantId] ?? null;
  }

  async startScreenShare(): Promise<void> {
    if (!this.screenShareSupported()) {
      this.settingsNotice.set('Браузер не поддерживает показ экрана');
      return;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      this.settingsNotice.set('Показ экрана работает только через HTTPS или localhost');
      return;
    }

    if (!this.room || this.room.state !== LiveKitConnectionState.Connected || !this.activeChannelId()) {
      this.settingsNotice.set('Сначала подключитесь к голосовому каналу');
      return;
    }

    if (this.localScreenShareTrack) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: {
            ideal: 15,
            max: 30,
          },
        },
        audio: false,
      });
      const [track] = stream.getVideoTracks();
      if (!track) {
        throw new Error('Не удалось получить видеодорожку экрана');
      }

      const localScreenShareTrack = new LocalVideoTrack(track, undefined, true);
      await this.room.localParticipant.publishTrack(localScreenShareTrack, {
        source: Track.Source.ScreenShare,
      });

      track.onended = () => {
        if (this.localScreenShareTrackMedia?.id === track.id) {
          void this.stopScreenShare();
        }
      };

      this.localScreenShareTrackMedia = track;
      this.localScreenShareTrack = localScreenShareTrack;
      this.localScreenShareStreamInternal = stream;
      this.localScreenShareStream.set(stream);
      this.settingsNotice.set(null);
    } catch (error) {
      this.clearLocalScreenShare();
      this.settingsNotice.set(this.describeError(error, 'Не удалось начать показ экрана'));
    }
  }

  async stopScreenShare(): Promise<void> {
    const room = this.room;
    const localScreenShareTrack = this.localScreenShareTrack;
    this.clearLocalScreenShare();

    if (!room || !localScreenShareTrack) {
      return;
    }

    await room.localParticipant.unpublishTrack(localScreenShareTrack, false).catch(() => undefined);
  }

  toggleScreenShare(): void {
    if (this.screenShareEnabled()) {
      void this.stopScreenShare();
      return;
    }

    void this.startScreenShare();
  }

  async refreshDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    this.devicesLoading.set(true);
    this.settingsNotice.set(this.settingsNotice() === OWNER_MUTED_NOTICE ? OWNER_MUTED_NOTICE : null);

    try {
      const devices = await Room.getLocalDevices(undefined, false).catch(async () => navigator.mediaDevices.enumerateDevices());
      const inputs = devices
        .filter((device) => device.kind === 'audioinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Микрофон ${index + 1}`,
        }));
      const outputs = devices
        .filter((device) => device.kind === 'audiooutput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Вывод ${index + 1}`,
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
      inputDeviceId: deviceId || null,
    });
    await this.refreshDevices();
    await this.reconnectIfNeeded();
  }

  async updateOutputDevice(deviceId: string | null): Promise<void> {
    this.updateSettings({
      outputDeviceId: deviceId || null,
    });
    await this.applyAudioOutputPreferences();
  }

  updateSensitivity(value: number): void {
    this.updateSettings({
      sensitivity: clamp(value, 0, 100),
    });
  }

  updateMicrophoneGain(value: number): void {
    const usedProcessedStream = this.usesProcessedLocalStream();
    this.updateSettings({
      microphoneGain: clamp(value, MIN_MICROPHONE_GAIN_PERCENT, MAX_AUDIO_GAIN_PERCENT),
    });
    const shouldUseProcessedStream = this.usesProcessedLocalStream();

    if (usedProcessedStream !== shouldUseProcessedStream) {
      void this.reconnectIfNeeded();
      return;
    }

    this.applyLocalMicrophoneGain();
  }

  updateMasterVolume(value: number): void {
    this.updateSettings({
      masterVolume: clamp(value, 0, MAX_AUDIO_GAIN_PERCENT),
    });
    this.applyAllRemoteVolumes();
  }

  updateParticipantVolume(userId: string, value: number): void {
    const nextVolume = clamp(value, 0, MAX_AUDIO_GAIN_PERCENT);
    const participantVolumes = {
      ...this.settings().participantVolumes,
      [userId]: nextVolume,
    };

    this.updateSettings({
      participantVolumes,
    });
    this.applyVolumesForUser(userId);
  }

  getParticipantVolume(userId: string): number {
    return clamp(this.settings().participantVolumes[userId] ?? 100, 0, MAX_AUDIO_GAIN_PERCENT);
  }

  private async reconnectIfNeeded(): Promise<void> {
    if (!this.lastJoinContext) {
      return;
    }

    await this.join(
      this.lastJoinContext.channelId,
      this.lastJoinContext.token,
      this.lastJoinContext.currentUser,
      true,
    );
  }

  private updateSettings(patch: Partial<VoiceSettings>): void {
    const nextSettings: VoiceSettings = {
      ...this.settings(),
      ...patch,
      participantVolumes: patch.participantVolumes ?? this.settings().participantVolumes,
    };
    this.settings.set(nextSettings);
    saveVoiceSettings(nextSettings);
  }

  private setConnectingParticipants(currentUser: CurrentUserResponse, muted: boolean): void {
    this.participantUserIds.clear();
    this.participantUserIds.set('local', currentUser.id);
    this.participants.set([
      {
        id: 'local',
        user_id: currentUser.id,
        nick: currentUser.nick,
        avatar_updated_at: currentUser.avatar_updated_at,
        muted,
        owner_muted: false,
        speaking: false,
        is_self: true,
      },
    ]);
  }

  private async connectRoom(sfuToken: VoiceSfuTokenResponse): Promise<void> {
    const room = new Room({
      adaptiveStream: false,
      dynacast: true,
      disconnectOnPageLeave: false,
      stopLocalTrackOnUnpublish: false,
    });
    this.room = room;
    this.attachRoomListeners(room);

    await room.connect(sfuToken.url || SFU_BASE_URL, sfuToken.token, {
      rtcConfig: {
        iceServers: VOICE_ICE_SERVERS,
      },
    });

    if (this.localAudioTrack) {
      await room.localParticipant.publishTrack(this.localAudioTrack, {
        source: Track.Source.Microphone,
      });
      this.applyLocalMuteState();
    }

    this.syncSubscribedRemoteTracks(room);
    await this.applyAudioOutputPreferences();
    this.applyAllRemoteVolumes();
    void room.startAudio()
      .then(() => {
        void this.retryPendingAudioPlayback();
      })
      .catch(() => {
        this.pendingPlaybackUnlock.add('__room__');
        this.attachUserGestureUnlock();
        this.settingsNotice.set(AUDIO_UNLOCK_NOTICE);
      });

    this.reconnectAttempt = 0;
    if (this.reconnectMode === 'full') {
      this.reconnectMode = null;
    }
    this.updateOperationalState();
  }

  private attachRoomListeners(room: Room): void {
    this.attachRoomEvent(room, 'connected', () => {
      this.updateOperationalState();
      this.syncSubscribedRemoteTracks(room);
      this.clearReconnectNoticeIfReady();
    });
    this.attachRoomEvent(room, 'reconnecting', () => {
      this.state.set('connecting');
      this.settingsNotice.set(MEDIA_RECONNECT_NOTICE);
      this.error.set(null);
    });
    this.attachRoomEvent(room, 'signalReconnecting', () => {
      this.state.set('connecting');
      this.settingsNotice.set(MEDIA_RECONNECT_NOTICE);
      this.error.set(null);
    });
    this.attachRoomEvent(room, 'reconnected', () => {
      this.updateOperationalState();
      this.syncSubscribedRemoteTracks(room);
      this.clearReconnectNoticeIfReady();
    });
    this.attachRoomEvent(room, 'disconnected', (reason) => {
      void this.handleRoomDisconnected(reason);
    });
    this.attachRoomEvent(room, 'mediaDevicesChanged', () => {
      void this.refreshDevices();
    });
    this.attachRoomEvent(room, 'localAudioSilenceDetected', (publication) => {
      if (publication.source !== Track.Source.Microphone || this.localMuted() || this.ownerMuted()) {
        return;
      }

      this.settingsNotice.set(MICROPHONE_SILENCE_NOTICE);
    });
    this.attachRoomEvent(room, 'trackSubscribed', (track, publication, participant) => {
      void this.handleTrackSubscribed(track, publication.source, participant.identity);
    });
    this.attachRoomEvent(room, 'trackPublished', (publication, participant) => {
      this.ensurePublicationSubscribed(publication);
      this.attachSubscribedPublication(publication, participant);
    });
    this.attachRoomEvent(room, 'trackUnsubscribed', (track, publication, participant) => {
      this.handleTrackUnsubscribed(track, publication.source, participant.identity);
    });
    this.attachRoomEvent(room, 'participantDisconnected', (participant) => {
      this.clearRemoteMediaForUser(participant.identity);
      this.activeSpeakerUserIds.delete(participant.identity);
      this.syncSpeakingParticipants();
    });
    this.attachRoomEvent(room, 'activeSpeakersChanged', (speakers) => {
      this.activeSpeakerUserIds = new Set(speakers.map((speaker) => speaker.identity));
      if (this.lastJoinContext && this.activeSpeakerUserIds.has(this.lastJoinContext.currentUser.id)) {
        this.clearMicrophoneSilenceNotice();
      }
      this.syncSpeakingParticipants();
    });
  }

  private syncSubscribedRemoteTracks(room: Room | null = this.room): void {
    if (!room) {
      return;
    }

    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        this.ensurePublicationSubscribed(publication);
        this.attachSubscribedPublication(publication, participant);
      }
    }
  }

  private ensurePublicationSubscribed(publication: RemoteTrackPublication): void {
    if (!publication.isDesired) {
      publication.setSubscribed(true);
    }
  }

  private attachSubscribedPublication(publication: RemoteTrackPublication, participant: RemoteParticipant): void {
    if (!publication.track || !publication.isSubscribed) {
      return;
    }

    void this.handleTrackSubscribed(publication.track, publication.source, participant.identity);
  }

  private attachRoomEvent<T extends keyof RoomEventCallbacks>(
    room: Room,
    event: T,
    handler: RoomEventCallbacks[T],
  ): void {
    room.on(event, handler);
    this.roomEventDisposers.push(() => {
      room.off(event, handler);
    });
  }

  private detachRoomListeners(): void {
    for (const dispose of this.roomEventDisposers) {
      dispose();
    }
    this.roomEventDisposers = [];
  }

  private async handleRoomDisconnected(reason?: DisconnectReason): Promise<void> {
    if (!this.lastJoinContext) {
      return;
    }

    if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
      await this.failSession('Этот аккаунт уже подключён к голосовому каналу в другой вкладке или на другом устройстве');
      return;
    }

    if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
      await this.failSession('Вы были отключены от голосового канала');
      return;
    }

    this.state.set('connecting');
    this.error.set(null);
    this.settingsNotice.set(MEDIA_RECONNECT_NOTICE);
    this.scheduleReconnect('full');
  }

  private async handleTrackSubscribed(track: RemoteTrack, source: Track.Source | undefined, userId: string): Promise<void> {
    if (track.kind === Track.Kind.Audio) {
      await this.attachRemoteAudio(userId, track as RemoteAudioTrack);
      return;
    }

    if (track.kind === Track.Kind.Video) {
      if (source === Track.Source.ScreenShare) {
        this.attachRemoteScreenShare(userId, track as RemoteVideoTrack);
        return;
      }

      this.attachRemoteVideo(userId, track as RemoteVideoTrack);
    }
  }

  private handleTrackUnsubscribed(track: RemoteTrack, source: Track.Source | undefined, userId: string): void {
    if (track.kind === Track.Kind.Audio) {
      this.clearRemoteAudioForUser(userId);
      return;
    }

    if (track.kind === Track.Kind.Video) {
      if (source === Track.Source.ScreenShare) {
        this.clearRemoteScreenShareForUser(userId);
        return;
      }

      this.clearRemoteVideoForUser(userId);
    }
  }

  private async openControlSocket(channelId: string, token: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${WS_BASE_URL}/api/voice/channels/${channelId}/ws?token=${encodeURIComponent(token)}`);
      this.controlSocket = socket;

      let opened = false;

      socket.onopen = () => {
        opened = true;
        this.reconnectAttempt = 0;
        if (this.reconnectMode === 'socket') {
          this.reconnectMode = null;
        }
        this.startSocketKeepAlive();
        if (this.localMuted()) {
          this.sendControlMessage({
            type: 'mute_state',
            muted: true,
          });
        }
        this.updateOperationalState();
        resolve();
      };

      socket.onerror = () => {
        reject(new Error('Не удалось установить signaling-соединение'));
      };

      socket.onclose = (event) => {
        if (this.controlSocket !== socket) {
          return;
        }

        this.stopSocketKeepAlive();
        this.controlSocket = null;
        if (!opened) {
          reject(new Error(this.getControlSocketFailureMessage(event.code)));
          return;
        }

        void this.handleControlSocketClosed(event);
      };

      socket.onmessage = (event) => {
        this.handleControlSocketMessage(event.data);
      };
    });
  }

  private async handleControlSocketClosed(event: CloseEvent): Promise<void> {
    if (this.isFatalControlSocketCloseCode(event.code)) {
      await this.failSession(this.getControlSocketFailureMessage(event.code));
      return;
    }

    if (!this.lastJoinContext) {
      await this.failSession('Соединение голосового канала прервано');
      return;
    }

    this.error.set(null);
    this.state.set('connecting');
    this.settingsNotice.set(CONTROL_RECONNECT_NOTICE);
    this.scheduleReconnect('socket');
  }

  private handleControlSocketMessage(rawMessage: string): void {
    const message = JSON.parse(rawMessage) as IncomingVoiceMessage;

    if (message.type === 'room_state') {
      this.handleRoomState(message);
      return;
    }

    if (message.type === 'peer_joined') {
      this.upsertParticipant(message.participant);
      return;
    }

    if (message.type === 'peer_left') {
      this.removeParticipant(message.participant_id);
      return;
    }

    if (message.type === 'mute_state') {
      const participant = this.getParticipant(message.participant_id);
      this.updateParticipant(message.participant_id, {
        muted: message.muted,
        speaking: message.muted ? false : this.activeSpeakerUserIds.has(participant?.user_id ?? ''),
      });
      return;
    }

    if (message.type === 'owner_mute_state') {
      this.handleOwnerMuteState(message.participant_id, message.owner_muted);
      return;
    }

    if (message.type === 'error') {
      this.settingsNotice.set(message.detail);
    }
  }

  private handleRoomState(message: RoomStateMessage): void {
    this.selfId = message.self_id;
    this.participantUserIds.clear();

    const nextParticipants = [message.self_participant, ...message.participants].map((participant) => {
      this.participantUserIds.set(participant.id, participant.user_id);
      return this.toVoiceParticipant(participant, participant.id === message.self_id);
    });

    this.participants.set(
      nextParticipants.map((participant) => ({
        ...participant,
        muted: participant.is_self ? this.localMuted() : participant.muted,
        speaking: !participant.muted && !participant.owner_muted && this.activeSpeakerUserIds.has(participant.user_id),
      })),
    );

    this.syncRemoteVideoParticipantMappings();
    this.syncRemoteScreenShareParticipantMappings();
    this.applyAllRemoteVolumes();
    if (this.localMuted()) {
      this.sendControlMessage({
        type: 'mute_state',
        muted: true,
      });
    }
    this.applyLocalMuteState();
    this.updateOperationalState();
    this.clearReconnectNoticeIfReady();
  }

  private toVoiceParticipant(participant: RemoteVoiceParticipant, isSelf: boolean): VoiceParticipant {
    return {
      ...participant,
      speaking: !participant.muted && !participant.owner_muted && this.activeSpeakerUserIds.has(participant.user_id),
      is_self: isSelf,
    };
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
                owner_muted: participant.owner_muted,
                speaking: !participant.muted && !participant.owner_muted && this.activeSpeakerUserIds.has(participant.user_id),
              }
            : entry,
        );
      }

      return [
        ...participants,
        {
          ...participant,
          speaking: !participant.muted && !participant.owner_muted && this.activeSpeakerUserIds.has(participant.user_id),
          is_self: participant.id === this.selfId,
        },
      ];
    });

    this.syncRemoteVideoParticipantMappings();
    this.syncRemoteScreenShareParticipantMappings();
    this.applyVolumesForUser(participant.user_id);
  }

  private updateParticipant(participantId: string, patch: Partial<VoiceParticipant>): void {
    this.participants.update((participants) =>
      participants.map((participant) => (participant.id === participantId ? { ...participant, ...patch } : participant)),
    );
  }

  private removeParticipant(participantId: string): void {
    this.participants.update((participants) => participants.filter((participant) => participant.id !== participantId));
    this.participantUserIds.delete(participantId);
    this.syncRemoteVideoParticipantMappings();
    this.syncRemoteScreenShareParticipantMappings();
  }

  private syncSpeakingParticipants(): void {
    this.participants.update((participants) =>
      participants.map((participant) => ({
        ...participant,
        speaking: !participant.muted && !participant.owner_muted && this.activeSpeakerUserIds.has(participant.user_id),
      })),
    );
  }

  private sendControlMessage(payload: Record<string, unknown>): void {
    if (!this.controlSocket || this.controlSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.controlSocket.send(JSON.stringify(payload));
  }

  private applyLocalMuteState(): void {
    const shouldMute = this.localMuted() || this.ownerMuted();
    if (shouldMute) {
      this.clearMicrophoneSilenceNotice();
    }

    for (const track of this.rawLocalStream?.getAudioTracks() ?? []) {
      track.enabled = !shouldMute;
    }
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      track.enabled = !shouldMute;
    }

    if (!this.localAudioTrack) {
      return;
    }

    if (shouldMute && !this.localAudioTrack.isMuted) {
      void this.localAudioTrack.mute().catch(() => undefined);
      return;
    }

    if (!shouldMute && this.localAudioTrack.isMuted) {
      void this.localAudioTrack.unmute().catch(() => undefined);
    }
  }

  private clearMicrophoneSilenceNotice(): void {
    if (this.settingsNotice() === MICROPHONE_SILENCE_NOTICE) {
      this.settingsNotice.set(null);
    }
  }

  private handleOwnerMuteState(participantId: string, ownerMuted: boolean): void {
    const participant = this.getParticipant(participantId);
    this.updateParticipant(participantId, {
      owner_muted: ownerMuted,
      speaking: ownerMuted ? false : this.activeSpeakerUserIds.has(participant?.user_id ?? ''),
    });

    if (participantId === (this.selfId ?? 'local')) {
      this.applyLocalMuteState();
      if (ownerMuted) {
        this.settingsNotice.set(OWNER_MUTED_NOTICE);
      } else if (this.settingsNotice() === OWNER_MUTED_NOTICE) {
        this.settingsNotice.set(null);
      }
    }
  }

  private async attachRemoteAudio(userId: string, track: RemoteAudioTrack): Promise<void> {
    const stream = new MediaStream([track.mediaStreamTrack]);
    const remoteAudioOutput = await this.ensureRemoteAudioOutput(userId, stream);
    await this.applyOutputDevice(remoteAudioOutput.audioElement).catch(() => undefined);
    this.applyVolumeToAudioElement(userId);
    await this.playRemoteAudio(userId, remoteAudioOutput.audioElement).catch(() => undefined);
  }

  private async playRemoteAudio(userId: string, audioElement: HTMLAudioElement): Promise<void> {
    try {
      await audioElement.play();
      this.pendingPlaybackUnlock.delete(userId);
      this.pendingPlaybackUnlock.delete('__room__');
      if (!this.pendingPlaybackUnlock.size) {
        this.detachUserGestureUnlock();
        if (this.settingsNotice() === AUDIO_UNLOCK_NOTICE) {
          this.settingsNotice.set(null);
        }
      }
    } catch {
      this.pendingPlaybackUnlock.add(userId);
      this.attachUserGestureUnlock();
      this.settingsNotice.set(AUDIO_UNLOCK_NOTICE);
    }
  }

  private async ensureRemoteAudioOutput(userId: string, stream: MediaStream): Promise<RemoteAudioOutput> {
    let remoteAudioOutput = this.remoteAudioOutputs.get(userId);
    if (!remoteAudioOutput) {
      const audioElement = document.createElement('audio');
      prepareInlineMediaElement(audioElement);
      audioElement.style.display = 'none';
      document.body.appendChild(audioElement);

      remoteAudioOutput = {
        audioElement,
        inputStream: null,
        source: null,
        gainNode: null,
        destination: null,
      };
      this.remoteAudioOutputs.set(userId, remoteAudioOutput);
    }

    remoteAudioOutput.inputStream = stream;
    this.disposeRemoteAudioGraph(remoteAudioOutput);

    if (!this.shouldUseRemoteAudioGraph(userId)) {
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
      if (this.settingsNotice() === 'Браузер не дал переключить устройство вывода звука') {
        this.settingsNotice.set(null);
      }
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
    for (const userId of this.remoteAudioOutputs.keys()) {
      this.applyVolumeToAudioElement(userId);
    }
  }

  private applyVolumesForUser(userId: string): void {
    this.applyVolumeToAudioElement(userId);
  }

  private applyVolumeToAudioElement(userId: string): void {
    const remoteAudioOutput = this.remoteAudioOutputs.get(userId);
    if (!remoteAudioOutput) {
      return;
    }

    const effectiveGain = this.getRemoteParticipantGain(userId);
    const shouldUseGraph = this.shouldUseRemoteAudioGraph(userId);
    if (remoteAudioOutput.inputStream && shouldUseGraph !== Boolean(remoteAudioOutput.gainNode)) {
      void this.refreshRemoteAudioOutput(userId).catch(() => undefined);
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

  private async refreshRemoteAudioOutput(userId: string): Promise<void> {
    const remoteAudioOutput = this.remoteAudioOutputs.get(userId);
    const inputStream = remoteAudioOutput?.inputStream;
    if (!remoteAudioOutput || !inputStream) {
      return;
    }

    const output = await this.ensureRemoteAudioOutput(userId, inputStream);
    await this.applyOutputDevice(output.audioElement).catch(() => undefined);
    this.applyVolumeToAudioElement(userId);
    await this.playRemoteAudio(userId, output.audioElement).catch(() => undefined);
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

  private attachRemoteVideo(userId: string, track: RemoteVideoTrack): void {
    this.attachRemoteVisualTrack(userId, track, 'camera');
  }

  private attachRemoteScreenShare(userId: string, track: RemoteVideoTrack): void {
    this.attachRemoteVisualTrack(userId, track, 'screen-share');
  }

  private attachRemoteVisualTrack(userId: string, track: RemoteVideoTrack, source: VoiceVideoSource): void {
    this.clearRemoteVisualForUser(userId, source);
    const trackMap = source === 'screen-share' ? this.remoteScreenShareTracks : this.remoteVideoTracks;
    const streamMap = source === 'screen-share' ? this.remoteScreenShareStreamsByUserId : this.remoteVideoStreamsByUserId;

    trackMap.set(userId, track);
    streamMap.set(userId, new MediaStream([track.mediaStreamTrack]));
    this.syncRemoteVisualParticipantMappings(source);

    track.mediaStreamTrack.onended = () => {
      if (trackMap.get(userId)?.sid === track.sid) {
        this.clearRemoteVisualForUser(userId, source);
      }
    };

    track.mediaStreamTrack.onmute = () => {
      if (trackMap.get(userId)?.sid === track.sid) {
        streamMap.delete(userId);
        this.syncRemoteVisualParticipantMappings(source);
      }
    };

    track.mediaStreamTrack.onunmute = () => {
      if (trackMap.get(userId)?.sid === track.sid && track.mediaStreamTrack.readyState === 'live') {
        streamMap.set(userId, new MediaStream([track.mediaStreamTrack]));
        this.syncRemoteVisualParticipantMappings(source);
      }
    };
  }

  private syncRemoteVideoParticipantMappings(): void {
    this.syncRemoteVisualParticipantMappings('camera');
  }

  private syncRemoteScreenShareParticipantMappings(): void {
    this.syncRemoteVisualParticipantMappings('screen-share');
  }

  private syncRemoteVisualParticipantMappings(source: VoiceVideoSource): void {
    const nextStreams: Record<string, MediaStream | null> = {};
    const streamMap = source === 'screen-share' ? this.remoteScreenShareStreamsByUserId : this.remoteVideoStreamsByUserId;

    for (const [participantId, userId] of this.participantUserIds.entries()) {
      const stream = streamMap.get(userId);
      if (stream) {
        nextStreams[participantId] = stream;
      }
    }

    if (source === 'screen-share') {
      this.remoteScreenShareStreams.set(nextStreams);
      return;
    }

    this.remoteVideoStreams.set(nextStreams);
  }

  private clearRemoteMediaForUser(userId: string): void {
    this.clearRemoteAudioForUser(userId);
    this.clearRemoteVideoForUser(userId);
    this.clearRemoteScreenShareForUser(userId);
  }

  private clearRemoteAudioForUser(userId: string): void {
    const remoteAudioOutput = this.remoteAudioOutputs.get(userId);
    if (!remoteAudioOutput) {
      return;
    }

    this.disposeRemoteAudioGraph(remoteAudioOutput);
    remoteAudioOutput.audioElement.srcObject = null;
    remoteAudioOutput.audioElement.remove();
    this.remoteAudioOutputs.delete(userId);
    this.pendingPlaybackUnlock.delete(userId);
    if (!this.pendingPlaybackUnlock.size) {
      this.detachUserGestureUnlock();
    }
  }

  private clearRemoteVideoForUser(userId: string): void {
    this.clearRemoteVisualForUser(userId, 'camera');
  }

  private clearRemoteScreenShareForUser(userId: string): void {
    this.clearRemoteVisualForUser(userId, 'screen-share');
  }

  private clearRemoteVisualForUser(userId: string, source: VoiceVideoSource): void {
    const trackMap = source === 'screen-share' ? this.remoteScreenShareTracks : this.remoteVideoTracks;
    const streamMap = source === 'screen-share' ? this.remoteScreenShareStreamsByUserId : this.remoteVideoStreamsByUserId;
    const track = trackMap.get(userId);
    if (track) {
      track.mediaStreamTrack.onended = null;
      track.mediaStreamTrack.onmute = null;
      track.mediaStreamTrack.onunmute = null;
      trackMap.delete(userId);
    }

    streamMap.delete(userId);
    this.syncRemoteVisualParticipantMappings(source);
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
      destination,
    };
    this.applyLocalMicrophoneGain();

    return destination.stream;
  }

  private createLocalAudioTrack(stream: MediaStream): LocalAudioTrack | null {
    const track = stream.getAudioTracks()[0] ?? null;
    if (!track) {
      return null;
    }

    return new LocalAudioTrack(track, undefined, true);
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

  private async openLocalStream(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Браузер не поддерживает доступ к микрофону');
    }

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      throw new Error('На телефоне микрофон и голосовой канал работают только через HTTPS или localhost. Откройте Altgramm по защищённому домену.');
    }

    const settings = this.settings();
    const withSelectedDevice: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    if (settings.inputDeviceId) {
      withSelectedDevice.deviceId = {
        exact: settings.inputDeviceId,
      };
    }

    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: withSelectedDevice,
      });
    } catch {
      if (settings.inputDeviceId) {
        this.settingsNotice.set('Выбранный микрофон недоступен, подключаемся через устройство по умолчанию');
      }

      return navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    }
  }

  private async cleanupCurrentSession(clearJoinContext = false): Promise<void> {
    this.clearReconnectTimer();
    this.reconnectMode = null;
    this.stopSocketKeepAlive();
    this.teardownControlSocket();
    await this.disconnectRoom();
    this.clearRemoteMedia();
    this.stopLocalStream();
    this.selfId = null;
    this.activeSpeakerUserIds.clear();
    this.participantUserIds.clear();
    this.pendingPlaybackUnlock.clear();
    this.detachUserGestureUnlock();
    this.remoteVideoStreams.set({});
    this.remoteScreenShareStreams.set({});

    if (clearJoinContext) {
      this.lastJoinContext = null;
    }
  }

  private clearRemoteMedia(): void {
    for (const userId of [...this.remoteAudioOutputs.keys()]) {
      this.clearRemoteAudioForUser(userId);
    }

    for (const userId of [...this.remoteVideoTracks.keys()]) {
      this.clearRemoteVideoForUser(userId);
    }

    for (const userId of [...this.remoteScreenShareTracks.keys()]) {
      this.clearRemoteScreenShareForUser(userId);
    }
  }

  private async disconnectRoom(): Promise<void> {
    const room = this.room;
    if (!room) {
      return;
    }

    this.detachRoomListeners();
    this.room = null;
    await room.disconnect(false).catch(() => undefined);
  }

  private teardownControlSocket(): void {
    if (!this.controlSocket) {
      return;
    }

    this.controlSocket.onclose = null;
    this.controlSocket.onerror = null;
    this.controlSocket.onmessage = null;
    this.controlSocket.close();
    this.controlSocket = null;
  }

  private stopLocalStream(): void {
    this.clearLocalCamera();
    this.clearLocalScreenShare();
    for (const track of this.rawLocalStream?.getTracks() ?? []) {
      track.stop();
    }
    if (this.localStream && this.localStream !== this.rawLocalStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
    }

    this.localAudioTrack = null;
    this.disposeLocalAudioPipeline();
    this.rawLocalStream = null;
    this.localStream = null;

    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
  }

  private clearLocalCamera(): void {
    if (this.localVideoTrackMedia) {
      this.localVideoTrackMedia.onended = null;
      this.localVideoTrackMedia.stop();
      this.localVideoTrackMedia = null;
    }

    if (this.localVideoStreamInternal) {
      for (const track of this.localVideoStreamInternal.getTracks()) {
        track.stop();
      }
      this.localVideoStreamInternal = null;
    }

    this.localVideoTrack = null;
    this.localVideoStream.set(null);
  }

  private clearLocalScreenShare(): void {
    if (this.localScreenShareTrackMedia) {
      this.localScreenShareTrackMedia.onended = null;
      this.localScreenShareTrackMedia.stop();
      this.localScreenShareTrackMedia = null;
    }

    if (this.localScreenShareStreamInternal) {
      for (const track of this.localScreenShareStreamInternal.getTracks()) {
        track.stop();
      }
      this.localScreenShareStreamInternal = null;
    }

    this.localScreenShareTrack = null;
    this.localScreenShareStream.set(null);
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

  private async failSession(message: string): Promise<void> {
    await this.cleanupCurrentSession();
    this.state.set('error');
    this.error.set(message);
    this.activeChannelId.set(null);
    this.participants.set([]);
    this.localMuted.set(false);
    this.remoteVideoStreams.set({});
    this.remoteScreenShareStreams.set({});
    this.clearTransientNotice();
  }

  private updateOperationalState(): void {
    if (!this.activeChannelId()) {
      return;
    }

    const roomConnected = this.room?.state === LiveKitConnectionState.Connected;
    const socketConnected = this.controlSocket?.readyState === WebSocket.OPEN;

    if (roomConnected && socketConnected) {
      this.state.set('connected');
      this.error.set(null);
      return;
    }

    if (this.state() !== 'error') {
      this.state.set('connecting');
    }
  }

  private clearReconnectNoticeIfReady(): void {
    if (this.room?.state !== LiveKitConnectionState.Connected || this.controlSocket?.readyState !== WebSocket.OPEN) {
      return;
    }

    if (this.settingsNotice() === CONTROL_RECONNECT_NOTICE || this.settingsNotice() === MEDIA_RECONNECT_NOTICE || this.settingsNotice() === RECONNECT_RETRY_NOTICE) {
      this.settingsNotice.set(null);
    }
  }

  private clearTransientNotice(): void {
    if (TRANSIENT_NOTICES.has(this.settingsNotice() ?? '')) {
      this.settingsNotice.set(null);
    }
  }

  private startSocketKeepAlive(): void {
    this.stopSocketKeepAlive();

    this.controlSocketPingIntervalId = window.setInterval(() => {
      this.sendControlMessage({
        type: 'ping',
      });
    }, VOICE_SOCKET_PING_INTERVAL_MS);
  }

  private stopSocketKeepAlive(): void {
    if (this.controlSocketPingIntervalId === null) {
      return;
    }

    window.clearInterval(this.controlSocketPingIntervalId);
    this.controlSocketPingIntervalId = null;
  }

  private scheduleReconnect(mode: ReconnectMode): void {
    if (typeof window === 'undefined' || !this.lastJoinContext) {
      return;
    }

    if (this.reconnectTimerId !== null) {
      if (mode === 'full' && this.reconnectMode === 'socket') {
        window.clearTimeout(this.reconnectTimerId);
        this.reconnectTimerId = null;
      } else {
        return;
      }
    }

    const delay = Math.min(VOICE_RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, VOICE_RECONNECT_MAX_MS);
    this.reconnectAttempt += 1;
    this.reconnectMode = mode;

    this.reconnectTimerId = window.setTimeout(() => {
      this.reconnectTimerId = null;
      if (mode === 'socket') {
        void this.reconnectControlSocket();
        return;
      }

      void this.performFullReconnect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimerId === null) {
      return;
    }

    window.clearTimeout(this.reconnectTimerId);
    this.reconnectTimerId = null;
  }

  private async reconnectControlSocket(): Promise<void> {
    const joinContext = this.lastJoinContext;
    if (!joinContext || this.controlSocket) {
      return;
    }

    try {
      await this.openControlSocket(joinContext.channelId, joinContext.token);
      this.reconnectAttempt = 0;
      this.reconnectMode = null;
      this.clearReconnectNoticeIfReady();
      this.updateOperationalState();
    } catch (error) {
      const message = this.describeError(error, 'Соединение голосового канала прервано');
      if (this.isFatalControlSocketMessage(message)) {
        await this.failSession(message);
        return;
      }

      this.settingsNotice.set(RECONNECT_RETRY_NOTICE);
      this.scheduleReconnect('socket');
    }
  }

  private async performFullReconnect(): Promise<void> {
    const joinContext = this.lastJoinContext;
    if (!joinContext) {
      return;
    }

    this.settingsNotice.set(RECONNECT_RETRY_NOTICE);
    await this.join(joinContext.channelId, joinContext.token, joinContext.currentUser, true);
  }

  private ensureAudioContext(): Promise<AudioContext | null> {
    return (async () => {
      if (typeof window === 'undefined') {
        return null;
      }

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
    })();
  }

  private createAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') {
      return null;
    }

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
    window.addEventListener('pointerdown', this.userGestureUnlockHandler, { passive: true });
    window.addEventListener('click', this.userGestureUnlockHandler);
  }

  private detachUserGestureUnlock(): void {
    if (typeof window === 'undefined' || !this.userGestureUnlockHandler) {
      return;
    }

    window.removeEventListener('touchstart', this.userGestureUnlockHandler);
    window.removeEventListener('pointerdown', this.userGestureUnlockHandler);
    window.removeEventListener('click', this.userGestureUnlockHandler);
    this.userGestureUnlockHandler = null;
  }

  private async retryPendingAudioPlayback(): Promise<void> {
    await this.ensureAudioContext().catch(() => null);
    await this.room?.startAudio().catch(() => undefined);

    for (const userId of [...this.pendingPlaybackUnlock]) {
      if (userId === '__room__') {
        this.pendingPlaybackUnlock.delete(userId);
        continue;
      }

      const audioElement = this.remoteAudioOutputs.get(userId)?.audioElement;
      if (!audioElement) {
        this.pendingPlaybackUnlock.delete(userId);
        continue;
      }

      try {
        await audioElement.play();
        this.pendingPlaybackUnlock.delete(userId);
      } catch {
        return;
      }
    }

    if (!this.pendingPlaybackUnlock.size) {
      if (this.settingsNotice() === AUDIO_UNLOCK_NOTICE) {
        this.settingsNotice.set(null);
      }
      this.detachUserGestureUnlock();
    }
  }

  private describeError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const detail = error.error?.detail;
      if (typeof detail === 'string' && detail.trim()) {
        return detail;
      }
      if (detail && typeof detail.message === 'string' && detail.message.trim()) {
        return detail.message;
      }
      if (typeof error.error?.message === 'string' && error.error.message.trim()) {
        return error.error.message;
      }
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return fallback;
  }

  private isFatalControlSocketCloseCode(code: number): boolean {
    return code === 4003 || code === 4401 || code === 4403 || code === 4404;
  }

  private isFatalControlSocketMessage(message: string): boolean {
    return (
      message === 'Владелец закрыл вам доступ к голосовому каналу'
      || message === 'Сессия голосового канала истекла, подключитесь заново'
      || message === 'У вас больше нет доступа к голосовому каналу'
      || message === 'Голосовой канал больше недоступен'
    );
  }

  private getControlSocketFailureMessage(code: number): string {
    if (code === 4003) {
      return 'Владелец закрыл вам доступ к голосовому каналу';
    }

    if (code === 4401) {
      return 'Сессия голосового канала истекла, подключитесь заново';
    }

    if (code === 4403) {
      return 'У вас больше нет доступа к голосовому каналу';
    }

    if (code === 4404) {
      return 'Голосовой канал больше недоступен';
    }

    return 'Не удалось установить signaling-соединение для голосового канала';
  }

  private getParticipant(participantId: string): VoiceParticipant | undefined {
    return this.participants().find((participant) => participant.id === participantId);
  }
}
