import { Injectable, computed, signal } from '@angular/core';

import { VOICE_ICE_SERVERS, WS_BASE_URL } from '../api/api-base';
import { isIphoneLikeBrowser, prepareInlineMediaElement, requestCameraStream } from '../../shared/media-device.utils';

export interface DirectCallPeer {
  user_id: string;
  nick: string;
  avatar_updated_at: string | null;
}

type DirectCallState = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'connected';
type DirectCallSignalType = 'offer' | 'answer' | 'ice_candidate' | 'screen_share_state' | 'camera_state';

interface DirectCallReadyMessage {
  type: 'ready';
  user_id: string;
}

interface DirectCallRingingMessage {
  type: 'call_ringing';
  call_id: string;
  peer: DirectCallPeer;
}

interface DirectCallIncomingMessage {
  type: 'incoming_call';
  call_id: string;
  peer: DirectCallPeer;
}

interface DirectCallAcceptedMessage {
  type: 'call_accepted';
  call_id: string;
  peer: DirectCallPeer;
  should_create_offer: boolean;
}

interface DirectCallRejectedMessage {
  type: 'call_rejected';
  call_id: string | null;
  detail: string;
}

interface DirectCallEndedMessage {
  type: 'call_ended';
  call_id: string;
  detail: string;
}

interface DirectCallRelayedSignalMessage {
  type: DirectCallSignalType;
  call_id: string;
  from_user_id: string;
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit | { sharing?: boolean; enabled?: boolean };
}

interface DirectCallErrorMessage {
  type: 'error';
  detail: string;
}

type IncomingDirectCallMessage =
  | DirectCallReadyMessage
  | DirectCallRingingMessage
  | DirectCallIncomingMessage
  | DirectCallAcceptedMessage
  | DirectCallRejectedMessage
  | DirectCallEndedMessage
  | DirectCallRelayedSignalMessage
  | DirectCallErrorMessage
  | { type: 'pong' };

const DIRECT_CALL_PING_INTERVAL_MS = 25000;
const DIRECT_CALL_RECONNECT_BASE_MS = 1000;
const DIRECT_CALL_RECONNECT_MAX_MS = 10000;
const DIRECT_CALL_AUTH_CLOSE_CODES = new Set([4401, 4403]);
const DIRECT_CALL_AUDIO_UNLOCK_NOTICE =
  'На телефоне коснитесь экрана еще раз, если браузер не включил звук звонка автоматически.';

@Injectable({
  providedIn: 'root'
})
export class DirectCallService {
  private socket: WebSocket | null = null;
  private reconnectTimerId: number | null = null;
  private pingIntervalId: number | null = null;
  private reconnectAttempt = 0;
  private currentToken: string | null = null;
  private manuallyStopped = true;
  private currentUserId: string | null = null;

  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private cameraStream: MediaStream | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private screenShareStream: MediaStream | null = null;
  private screenShareTrack: MediaStreamTrack | null = null;
  private cameraTransceiver: RTCRtpTransceiver | null = null;
  private screenTransceiver: RTCRtpTransceiver | null = null;
  private remoteCameraTrack: MediaStreamTrack | null = null;
  private remoteScreenTrack: MediaStreamTrack | null = null;
  private remoteAudioElement: HTMLAudioElement | null = null;
  private activeCallId: string | null = null;
  private negotiationInFlight = false;
  private negotiationQueued = false;
  private pendingRemoteAudioPlayback = false;
  private userGestureUnlockHandler: (() => void) | null = null;
  private remoteCameraExpected = false;
  private remoteScreenExpected = false;

  readonly connected = signal(false);
  readonly state = signal<DirectCallState>('idle');
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly peer = signal<DirectCallPeer | null>(null);
  readonly localCameraStream = signal<MediaStream | null>(null);
  readonly remoteCameraStream = signal<MediaStream | null>(null);
  readonly localScreenStream = signal<MediaStream | null>(null);
  readonly remoteScreenStream = signal<MediaStream | null>(null);
  readonly localMuted = signal(false);
  readonly remoteVolume = signal(100);
  readonly canCall = computed(() => this.connected() && this.state() === 'idle');
  readonly cameraSupported = computed(() => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia);
  readonly screenShareSupported = computed(
    () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && !isIphoneLikeBrowser()
  );
  readonly isCameraEnabled = computed(() => this.localCameraStream() !== null);
  readonly hasRemoteCamera = computed(() => this.remoteCameraStream() !== null);
  readonly isScreenSharing = computed(() => this.localScreenStream() !== null);
  readonly hasRemoteScreenShare = computed(() => this.remoteScreenStream() !== null);
  readonly hasActiveCall = computed(() => {
    const state = this.state();
    return state === 'outgoing' || state === 'incoming' || state === 'connecting' || state === 'connected';
  });

  start(token: string): void {
    if (!token) {
      return;
    }

    const normalizedToken = token.trim();
    if (!normalizedToken) {
      return;
    }

    const shouldReconnectImmediately = this.currentToken !== normalizedToken;
    this.currentToken = normalizedToken;
    this.manuallyStopped = false;

    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
      if (!shouldReconnectImmediately) {
        return;
      }

      this.closeSocket();
    }

    this.clearReconnectTimer();
    this.openSocket();
  }

  stop(): void {
    this.manuallyStopped = true;
    this.currentToken = null;
    this.currentUserId = null;
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    this.stopPing();
    this.closeSocket();
    this.connected.set(false);
    this.resetCallState();
  }

  openCall(peer: DirectCallPeer): void {
    if (!this.connected()) {
      this.error.set('Личный звонок пока недоступен');
      return;
    }

    if (!peer.user_id || peer.user_id === this.currentUserId) {
      this.error.set('Нельзя позвонить самому себе');
      return;
    }

    if (this.hasActiveCall()) {
      this.error.set('Сначала завершите текущий личный звонок');
      return;
    }

    this.error.set(null);
    this.notice.set(null);
    this.peer.set(peer);
    this.state.set('outgoing');
    this.send({
      type: 'call_request',
      target_user_id: peer.user_id
    });
  }

  acceptIncoming(): void {
    if (this.state() !== 'incoming' || !this.activeCallId) {
      return;
    }

    this.error.set(null);
    this.notice.set(null);
    this.send({
      type: 'call_response',
      call_id: this.activeCallId,
      action: 'accept'
    });
  }

  rejectIncoming(): void {
    if (this.state() !== 'incoming' || !this.activeCallId) {
      return;
    }

    this.send({
      type: 'call_response',
      call_id: this.activeCallId,
      action: 'reject'
    });
    this.resetCallState();
  }

  async hangUp(): Promise<void> {
    const callId = this.activeCallId;
    this.resetCallState();

    if (!callId) {
      return;
    }

    this.send({
      type: 'hangup',
      call_id: callId
    });
  }

  clearFeedback(): void {
    this.error.set(null);
    this.notice.set(null);
  }

  setLocalMuted(muted: boolean): void {
    this.localMuted.set(muted);
    this.applyLocalMuteState();
  }

  toggleLocalMute(): void {
    this.setLocalMuted(!this.localMuted());
  }

  updateRemoteVolume(value: number | string): void {
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue)) {
      return;
    }

    this.remoteVolume.set(Math.max(0, Math.min(100, Math.round(numericValue))));
    this.applyRemoteVolume();
  }

  async startCamera(): Promise<void> {
    if (!this.cameraSupported()) {
      this.error.set('Браузер не поддерживает доступ к камере');
      return;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      this.error.set('Камера работает только через HTTPS или localhost');
      return;
    }

    if (this.state() !== 'connected' || !this.peerConnection || !this.peer() || !this.activeCallId) {
      this.error.set('Сначала установите личный звонок');
      return;
    }

    if (this.cameraTrack) {
      return;
    }

    try {
      const stream = await requestCameraStream({
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 24, max: 30 },
        facingMode: 'user'
      });
      const [track] = stream.getVideoTracks();
      if (!track) {
        throw new Error('Не удалось получить видеодорожку камеры');
      }

      track.onended = () => {
        if (this.cameraTrack?.id === track.id) {
          void this.stopCamera();
        }
      };

      this.cameraStream = stream;
      this.cameraTrack = track;
      this.localCameraStream.set(stream);

      const cameraTransceiver = this.ensureCameraTransceiver();
      await cameraTransceiver.sender.replaceTrack(track);
      cameraTransceiver.direction = 'sendrecv';
      this.sendCameraState(true);
      this.error.set(null);
      this.notice.set('Вы включили камеру');
      await this.renegotiate();
    } catch (error) {
      this.clearLocalCamera();
      this.error.set(error instanceof Error ? error.message : 'Не удалось включить камеру');
    }
  }

  async stopCamera(): Promise<void> {
    const hadCamera = !!this.cameraTrack || !!this.localCameraStream();
    await this.detachCameraFromConnection();
    this.clearLocalCamera();

    if (!hadCamera || !this.peerConnection || !this.peer() || !this.activeCallId) {
      return;
    }

    if (this.state() === 'connected') {
      this.sendCameraState(false);
      this.notice.set('Камера выключена');
      await this.renegotiate();
    }
  }

  async startScreenShare(): Promise<void> {
    if (!this.screenShareSupported()) {
      this.error.set('Браузер не поддерживает показ экрана');
      return;
    }

    if (this.state() !== 'connected' || !this.peerConnection || !this.peer() || !this.activeCallId) {
      this.error.set('Сначала установите личный звонок');
      return;
    }

    if (this.screenShareTrack) {
      return;
    }

    try {
      if (isIphoneLikeBrowser()) {
        throw new Error('На iPhone браузер не дает полноценно запустить показ экрана из звонка.');
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: {
            ideal: 15,
            max: 30
          }
        },
        audio: false
      });
      const [track] = stream.getVideoTracks();
      if (!track) {
        throw new Error('Не удалось получить видеодорожку экрана');
      }

      track.onended = () => {
        if (this.screenShareTrack?.id === track.id) {
          void this.stopScreenShare();
        }
      };

      this.screenShareStream = stream;
      this.screenShareTrack = track;
      this.localScreenStream.set(stream);

      const screenTransceiver = this.ensureScreenTransceiver();
      await screenTransceiver.sender.replaceTrack(track);
      screenTransceiver.direction = 'sendrecv';
      this.sendScreenShareState(true);
      this.error.set(null);
      this.notice.set('Вы показываете экран');
      await this.renegotiate();
    } catch (error) {
      this.clearLocalScreenShare();
      this.error.set(error instanceof Error ? error.message : 'Не удалось начать показ экрана');
    }
  }

  async stopScreenShare(): Promise<void> {
    const hadScreenShare = !!this.screenShareTrack || !!this.localScreenStream();
    await this.detachScreenShareFromConnection();
    this.clearLocalScreenShare();

    if (!hadScreenShare || !this.peerConnection || !this.peer() || !this.activeCallId) {
      return;
    }

    if (this.state() === 'connected') {
      this.sendScreenShareState(false);
      this.notice.set('Показ экрана остановлен');
      await this.renegotiate();
    }
  }

  private openSocket(): void {
    if (typeof window === 'undefined' || !this.currentToken) {
      return;
    }

    const websocketUrl = `${WS_BASE_URL}/api/calls/ws?token=${encodeURIComponent(this.currentToken)}`;
    const socket = new WebSocket(websocketUrl);
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return;
      }

      this.connected.set(true);
      this.reconnectAttempt = 0;
      this.startPing();
    });

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        return;
      }

      try {
        const payload = JSON.parse(event.data) as IncomingDirectCallMessage;
        void this.handleMessage(payload);
      } catch {
        // Ignore malformed payloads.
      }
    });

    socket.addEventListener('error', () => {
      if (this.socket !== socket) {
        return;
      }

      this.error.set('Не удалось подключить личный звонок');
    });

    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) {
        return;
      }

      this.connected.set(false);
      this.stopPing();
      this.socket = null;

      if (DIRECT_CALL_AUTH_CLOSE_CODES.has(event.code)) {
        this.manuallyStopped = true;
        this.currentToken = null;
        this.currentUserId = null;
        this.reconnectAttempt = 0;
        this.error.set('Сессия устарела. Войдите снова.');
        if (this.hasActiveCall()) {
          this.resetCallState();
        }
        return;
      }

      if (this.hasActiveCall()) {
        this.resetCallState();
        this.notice.set('Личный звонок прерван');
      }

      if (this.manuallyStopped) {
        return;
      }

      this.scheduleReconnect();
    });
  }

  private async handleMessage(message: IncomingDirectCallMessage): Promise<void> {
    if (message.type === 'ready') {
      this.currentUserId = message.user_id;
      return;
    }

    if (message.type === 'call_ringing') {
      this.activeCallId = message.call_id;
      this.peer.set(message.peer);
      this.state.set('outgoing');
      this.error.set(null);
      this.notice.set('Ожидаем ответа собеседника');
      return;
    }

    if (message.type === 'incoming_call') {
      this.activeCallId = message.call_id;
      this.peer.set(message.peer);
      this.state.set('incoming');
      this.error.set(null);
      this.notice.set(null);
      return;
    }

    if (message.type === 'call_accepted') {
      this.activeCallId = message.call_id;
      this.peer.set(message.peer);
      this.state.set('connecting');
      this.error.set(null);
      this.notice.set('Соединяем личный звонок');

      try {
        this.remoteCameraExpected = false;
        this.remoteScreenExpected = false;
        await this.ensureLocalStream();
        const connection = await this.ensurePeerConnection(message.peer.user_id);
        if (message.should_create_offer) {
          const offer = await connection.createOffer();
          await connection.setLocalDescription(offer);
          this.send({
            type: 'offer',
            call_id: message.call_id,
            target_user_id: message.peer.user_id,
            payload: connection.localDescription,
          });
        }
      } catch (error) {
        this.error.set(error instanceof Error ? error.message : 'Не удалось подключить личный звонок');
        await this.hangUp();
      }
      return;
    }

    if (message.type === 'call_rejected') {
      this.resetCallState();
      this.error.set(message.detail);
      return;
    }

    if (message.type === 'call_ended') {
      this.resetCallState();
      this.notice.set(message.detail);
      return;
    }

    if (message.type === 'offer') {
      try {
        const connection = await this.ensurePeerConnection(message.from_user_id);
        if (connection.signalingState !== 'stable') {
          try {
            await connection.setLocalDescription({ type: 'rollback' });
          } catch {
            // Ignore rollback failures and continue with the remote offer.
          }
        }
        await connection.setRemoteDescription(new RTCSessionDescription(message.payload as RTCSessionDescriptionInit));
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        this.send({
          type: 'answer',
          call_id: message.call_id,
          target_user_id: message.from_user_id,
          payload: connection.localDescription,
        });
      } catch (error) {
        this.error.set(error instanceof Error ? error.message : 'Не удалось принять личный звонок');
        await this.hangUp();
      }
      return;
    }

    if (message.type === 'answer') {
      if (!this.peerConnection) {
        return;
      }

      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription(message.payload as RTCSessionDescriptionInit)
      );
      return;
    }

    if (message.type === 'ice_candidate') {
      if (!this.peerConnection || !message.payload) {
        return;
      }

      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(message.payload as RTCIceCandidateInit));
      } catch {
        // Ignore malformed ICE candidates instead of breaking the call.
      }
      return;
    }

    if (message.type === 'camera_state') {
      const payload = message.payload as { enabled?: unknown } | null;
      const enabled = Boolean(payload?.enabled);
      this.remoteCameraExpected = enabled;

      if (!enabled) {
        this.clearRemoteCamera();
        if (this.state() === 'connected') {
          this.notice.set('Камера собеседника выключена');
        }
      } else if (this.state() === 'connected') {
        this.notice.set('Собеседник включил камеру');
      }
      return;
    }

    if (message.type === 'screen_share_state') {
      const payload = message.payload as { sharing?: unknown } | null;
      const sharing = Boolean(payload?.sharing);
      this.remoteScreenExpected = sharing;

      if (!sharing) {
        this.clearRemoteScreenShare();
        if (this.state() === 'connected') {
          this.notice.set('Показ экрана собеседника остановлен');
        }
      } else if (this.state() === 'connected') {
        this.notice.set('Собеседник начал показ экрана');
      }
      return;
    }

    if (message.type === 'error') {
      this.error.set(message.detail);
      if (this.state() === 'outgoing') {
        this.resetCallState();
      }
    }
  }

  private async ensureLocalStream(): Promise<void> {
    if (this.localStream) {
      return;
    }

    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });
    this.applyLocalMuteState();
  }

  private async ensurePeerConnection(targetUserId: string): Promise<RTCPeerConnection> {
    if (this.peerConnection) {
      return this.peerConnection;
    }

    const connection = new RTCPeerConnection({
      iceServers: VOICE_ICE_SERVERS
    });
    this.peerConnection = connection;

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        connection.addTrack(track, this.localStream);
      }
    }

    if (this.cameraTrack) {
      const cameraTransceiver = this.ensureCameraTransceiver();
      await cameraTransceiver.sender.replaceTrack(this.cameraTrack);
      cameraTransceiver.direction = 'sendrecv';
    }

    if (this.screenShareTrack) {
      const screenTransceiver = this.ensureScreenTransceiver();
      await screenTransceiver.sender.replaceTrack(this.screenShareTrack);
      screenTransceiver.direction = 'sendrecv';
    }

    connection.addEventListener('icecandidate', (event) => {
      if (!event.candidate || !this.activeCallId) {
        return;
      }

      this.send({
        type: 'ice_candidate',
        call_id: this.activeCallId,
        target_user_id: targetUserId,
        payload: event.candidate.toJSON()
      });
    });

    connection.addEventListener('track', (event) => {
      if (event.track.kind === 'video') {
        this.routeIncomingVideoTrack(event.track, event.transceiver);
        return;
      }

      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.attachRemoteStream(stream);
    });

    connection.addEventListener('connectionstatechange', () => {
      const state = connection.connectionState;
      if (state === 'connected') {
        this.state.set('connected');
        this.notice.set('Связь установлена');
        return;
      }

      if (state === 'disconnected') {
        if (this.hasActiveCall()) {
          this.notice.set('Соединение просело, пытаемся восстановить звонок');
        }
        return;
      }

      if (state === 'failed' || state === 'closed') {
        if (this.hasActiveCall()) {
          this.notice.set('Соединение личного звонка прервано');
          void this.hangUp();
        }
      }
    });

    connection.addEventListener('signalingstatechange', () => {
      if (connection.signalingState === 'stable' && this.negotiationQueued) {
        this.negotiationQueued = false;
        void this.renegotiate();
      }
    });

    return connection;
  }

  private ensureCameraTransceiver(): RTCRtpTransceiver {
    if (this.cameraTransceiver) {
      return this.cameraTransceiver;
    }

    if (!this.peerConnection) {
      throw new Error('Соединение звонка еще не готово');
    }

    this.cameraTransceiver = this.peerConnection.addTransceiver('video', {
      direction: this.cameraTrack ? 'sendrecv' : 'recvonly'
    });
    return this.cameraTransceiver;
  }

  private ensureScreenTransceiver(): RTCRtpTransceiver {
    if (this.screenTransceiver) {
      return this.screenTransceiver;
    }

    if (!this.peerConnection) {
      throw new Error('Соединение звонка еще не готово');
    }

    this.screenTransceiver = this.peerConnection.addTransceiver('video', {
      direction: this.screenShareTrack ? 'sendrecv' : 'recvonly'
    });
    return this.screenTransceiver;
  }

  private routeIncomingVideoTrack(track: MediaStreamTrack, transceiver: RTCRtpTransceiver): void {
    if (transceiver === this.screenTransceiver || transceiver.mid === this.screenTransceiver?.mid) {
      this.attachRemoteScreenTrack(track);
      return;
    }

    if (transceiver === this.cameraTransceiver || transceiver.mid === this.cameraTransceiver?.mid) {
      this.attachRemoteCameraTrack(track);
      return;
    }

    if (this.remoteScreenExpected && !this.remoteScreenTrack) {
      this.attachRemoteScreenTrack(track);
      return;
    }

    if (this.remoteCameraExpected && !this.remoteCameraTrack) {
      this.attachRemoteCameraTrack(track);
      return;
    }

    if (this.remoteScreenTrack && !this.remoteCameraTrack) {
      this.attachRemoteCameraTrack(track);
      return;
    }

    this.attachRemoteCameraTrack(track);
  }

  private attachRemoteStream(stream: MediaStream): void {
    if (this.remoteAudioElement === null) {
      this.remoteAudioElement = document.createElement('audio');
      prepareInlineMediaElement(this.remoteAudioElement);
      this.remoteAudioElement.style.display = 'none';
      document.body.appendChild(this.remoteAudioElement);
    }

    this.remoteAudioElement.srcObject = stream;
    this.applyRemoteVolume();
    void this.playRemoteAudio();
  }

  private attachRemoteCameraTrack(track: MediaStreamTrack): void {
    const stream = new MediaStream([track]);
    this.remoteCameraTrack = track;
    this.remoteCameraStream.set(stream);
    track.onended = () => {
      if (this.remoteCameraTrack?.id === track.id) {
        this.clearRemoteCamera();
      }
    };
  }

  private attachRemoteScreenTrack(track: MediaStreamTrack): void {
    const stream = new MediaStream([track]);
    this.remoteScreenTrack = track;
    this.remoteScreenStream.set(stream);
    this.notice.set('Собеседник показывает экран');
    track.onended = () => {
      if (this.remoteScreenTrack?.id === track.id) {
        this.clearRemoteScreenShare();
        if (this.state() === 'connected' && this.notice() === 'Собеседник показывает экран') {
          this.notice.set('Показ экрана собеседника остановлен');
        }
      }
    };
  }

  private resetCallState(): void {
    void this.detachCameraFromConnection();
    void this.detachScreenShareFromConnection();
    this.clearLocalCamera();
    this.clearRemoteCamera();
    this.clearLocalScreenShare();
    this.clearRemoteScreenShare();
    this.remoteCameraExpected = false;
    this.remoteScreenExpected = false;
    this.localMuted.set(false);
    this.remoteVolume.set(100);
    this.stopLocalStream();
    this.teardownPeerConnection();
    this.teardownRemoteAudio();
    this.activeCallId = null;
    this.peer.set(null);
    this.state.set('idle');
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

  private applyLocalMuteState(): void {
    if (!this.localStream) {
      return;
    }

    const enabled = !this.localMuted();
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = enabled;
    }
  }

  private applyRemoteVolume(): void {
    if (!this.remoteAudioElement) {
      return;
    }

    this.remoteAudioElement.volume = Math.max(0, Math.min(1, this.remoteVolume() / 100));
  }

  private teardownPeerConnection(): void {
    if (!this.peerConnection) {
      return;
    }

    this.peerConnection.onicecandidate = null;
    this.peerConnection.ontrack = null;
    this.peerConnection.onconnectionstatechange = null;
    this.peerConnection.close();
    this.peerConnection = null;
    this.cameraTransceiver = null;
    this.screenTransceiver = null;
    this.negotiationInFlight = false;
    this.negotiationQueued = false;
  }

  private teardownRemoteAudio(): void {
    if (!this.remoteAudioElement) {
      this.pendingRemoteAudioPlayback = false;
      this.detachUserGestureUnlock();
      return;
    }

    this.remoteAudioElement.pause();
    this.remoteAudioElement.srcObject = null;
    this.remoteAudioElement.remove();
    this.remoteAudioElement = null;
    this.pendingRemoteAudioPlayback = false;
    this.detachUserGestureUnlock();
  }

  private send(payload: object): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(payload));
  }

  private startPing(): void {
    if (typeof window === 'undefined' || this.pingIntervalId !== null) {
      return;
    }

    this.pingIntervalId = window.setInterval(() => {
      this.send({ type: 'ping' });
    }, DIRECT_CALL_PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingIntervalId !== null) {
      window.clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
  }

  private scheduleReconnect(): void {
    if (typeof window === 'undefined' || this.reconnectTimerId !== null || !this.currentToken) {
      return;
    }

    const delay = Math.min(
      DIRECT_CALL_RECONNECT_BASE_MS * 2 ** this.reconnectAttempt,
      DIRECT_CALL_RECONNECT_MAX_MS
    );
    this.reconnectAttempt += 1;

    this.reconnectTimerId = window.setTimeout(() => {
      this.reconnectTimerId = null;
      this.openSocket();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimerId !== null) {
      window.clearTimeout(this.reconnectTimerId);
      this.reconnectTimerId = null;
    }
  }

  private closeSocket(): void {
    if (!this.socket) {
      return;
    }

    const socket = this.socket;
    this.socket = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(1000, 'client_closed');
    }
  }

  private async renegotiate(): Promise<void> {
    if (!this.peerConnection || !this.activeCallId) {
      return;
    }

    if (this.negotiationInFlight || this.peerConnection.signalingState !== 'stable') {
      this.negotiationQueued = true;
      return;
    }

    const peer = this.peer();
    if (!peer) {
      return;
    }

    this.negotiationInFlight = true;

    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      if (!this.peerConnection.localDescription) {
        return;
      }

      this.send({
        type: 'offer',
        call_id: this.activeCallId,
        target_user_id: peer.user_id,
        payload: this.peerConnection.localDescription
      });
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Не удалось обновить звонок');
    } finally {
      this.negotiationInFlight = false;
    }
  }

  private async detachCameraFromConnection(): Promise<void> {
    if (!this.cameraTransceiver) {
      return;
    }

    try {
      await this.cameraTransceiver.sender.replaceTrack(null);
    } catch {
      // Ignore sender replacement failures when connection is already closed.
    }

    this.cameraTransceiver.direction = 'recvonly';
  }

  private async detachScreenShareFromConnection(): Promise<void> {
    if (!this.screenTransceiver) {
      return;
    }

    try {
      await this.screenTransceiver.sender.replaceTrack(null);
    } catch {
      // Ignore sender replacement failures when connection is already closed.
    }

    this.screenTransceiver.direction = 'recvonly';
  }

  private clearLocalCamera(): void {
    if (this.cameraTrack) {
      this.cameraTrack.onended = null;
      this.cameraTrack = null;
    }

    if (this.cameraStream) {
      for (const track of this.cameraStream.getTracks()) {
        track.stop();
      }
      this.cameraStream = null;
    }

    this.localCameraStream.set(null);
  }

  private clearRemoteCamera(): void {
    if (this.remoteCameraTrack) {
      this.remoteCameraTrack.onended = null;
      this.remoteCameraTrack = null;
    }

    this.remoteCameraStream.set(null);
  }

  private clearLocalScreenShare(): void {
    if (this.screenShareTrack) {
      this.screenShareTrack.onended = null;
      this.screenShareTrack = null;
    }

    if (this.screenShareStream) {
      for (const track of this.screenShareStream.getTracks()) {
        track.stop();
      }
      this.screenShareStream = null;
    }

    this.localScreenStream.set(null);
  }

  private clearRemoteScreenShare(): void {
    if (this.remoteScreenTrack) {
      this.remoteScreenTrack.onended = null;
      this.remoteScreenTrack = null;
    }

    this.remoteScreenStream.set(null);
  }

  private async playRemoteAudio(): Promise<void> {
    if (!this.remoteAudioElement) {
      return;
    }

    try {
      await this.remoteAudioElement.play();
      this.pendingRemoteAudioPlayback = false;
      if (this.notice() === DIRECT_CALL_AUDIO_UNLOCK_NOTICE) {
        this.notice.set(null);
      }
      this.detachUserGestureUnlock();
    } catch {
      this.pendingRemoteAudioPlayback = true;
      this.attachUserGestureUnlock();
      if (this.state() === 'connected') {
        this.notice.set(DIRECT_CALL_AUDIO_UNLOCK_NOTICE);
      }
    }
  }

  private attachUserGestureUnlock(): void {
    if (typeof window === 'undefined' || this.userGestureUnlockHandler) {
      return;
    }

    this.userGestureUnlockHandler = () => {
      void this.retryPendingRemoteAudioPlayback();
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

  private async retryPendingRemoteAudioPlayback(): Promise<void> {
    if (!this.pendingRemoteAudioPlayback || !this.remoteAudioElement) {
      this.detachUserGestureUnlock();
      return;
    }

    try {
      await this.remoteAudioElement.play();
      this.pendingRemoteAudioPlayback = false;
      if (this.notice() === DIRECT_CALL_AUDIO_UNLOCK_NOTICE) {
        this.notice.set(null);
      }
      this.detachUserGestureUnlock();
    } catch {
      // Wait for the next explicit gesture if playback is still blocked.
    }
  }

  private sendScreenShareState(sharing: boolean): void {
    const peer = this.peer();
    if (!peer || !this.activeCallId) {
      return;
    }

    this.send({
      type: 'screen_share_state',
      call_id: this.activeCallId,
      target_user_id: peer.user_id,
      payload: {
        sharing
      }
    });
  }

  private sendCameraState(enabled: boolean): void {
    const peer = this.peer();
    if (!peer || !this.activeCallId) {
      return;
    }

    this.send({
      type: 'camera_state',
      call_id: this.activeCallId,
      target_user_id: peer.user_id,
      payload: {
        enabled
      }
    });
  }
}



