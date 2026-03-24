import { Injectable, computed, signal } from '@angular/core';

import { VOICE_ICE_SERVERS, WS_BASE_URL } from '../api/api-base';

export interface DirectCallPeer {
  user_id: string;
  nick: string;
  full_name: string;
  character_name: string | null;
  avatar_updated_at: string | null;
}

type DirectCallState = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'connected';
type DirectCallSignalType = 'offer' | 'answer' | 'ice_candidate';

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
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
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
  private remoteAudioElement: HTMLAudioElement | null = null;
  private activeCallId: string | null = null;

  readonly connected = signal(false);
  readonly state = signal<DirectCallState>('idle');
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly peer = signal<DirectCallPeer | null>(null);
  readonly canCall = computed(() => this.connected() && this.state() === 'idle');
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

    socket.addEventListener('close', () => {
      if (this.socket !== socket) {
        return;
      }

      this.connected.set(false);
      this.stopPing();
      this.socket = null;

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
        await this.ensureLocalStream();
        const connection = await this.ensurePeerConnection(message.peer.user_id);
        if (message.should_create_offer) {
          const offer = await connection.createOffer({
            offerToReceiveAudio: true,
          });
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
      const [stream] = event.streams;
      if (!stream) {
        return;
      }

      this.attachRemoteStream(stream);
    });

    connection.addEventListener('connectionstatechange', () => {
      const state = connection.connectionState;
      if (state === 'connected') {
        this.state.set('connected');
        this.notice.set('Связь установлена');
        return;
      }

      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        if (this.hasActiveCall()) {
          this.notice.set('Соединение личного звонка прервано');
          void this.hangUp();
        }
      }
    });

    return connection;
  }

  private attachRemoteStream(stream: MediaStream): void {
    if (this.remoteAudioElement === null) {
      this.remoteAudioElement = document.createElement('audio');
      this.remoteAudioElement.autoplay = true;
      this.remoteAudioElement.setAttribute('playsinline', 'true');
    }

    this.remoteAudioElement.srcObject = stream;
    void this.remoteAudioElement.play().catch(() => undefined);
  }

  private resetCallState(): void {
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

  private teardownPeerConnection(): void {
    if (!this.peerConnection) {
      return;
    }

    this.peerConnection.onicecandidate = null;
    this.peerConnection.ontrack = null;
    this.peerConnection.onconnectionstatechange = null;
    this.peerConnection.close();
    this.peerConnection = null;
  }

  private teardownRemoteAudio(): void {
    if (!this.remoteAudioElement) {
      return;
    }

    this.remoteAudioElement.pause();
    this.remoteAudioElement.srcObject = null;
    this.remoteAudioElement = null;
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
}
