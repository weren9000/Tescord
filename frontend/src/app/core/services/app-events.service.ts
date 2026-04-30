import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

import { WS_BASE_URL } from '../api/api-base';
import { AppEventsMessage } from '../models/app-events.models';

const APP_EVENTS_PING_INTERVAL_MS = 25000;
const APP_EVENTS_RECONNECT_BASE_MS = 1000;
const APP_EVENTS_RECONNECT_MAX_MS = 10000;
const APP_EVENTS_AUTH_CLOSE_CODES = new Set([4401, 4403]);

@Injectable({
  providedIn: 'root'
})
export class AppEventsService {
  private socket: WebSocket | null = null;
  private reconnectTimerId: number | null = null;
  private pingIntervalId: number | null = null;
  private reconnectAttempt = 0;
  private currentToken: string | null = null;
  private activeServerId: string | null = null;
  private manuallyStopped = true;
  private readonly eventSubject = new Subject<AppEventsMessage>();

  readonly connected = signal(false);
  readonly connectionError = signal<string | null>(null);
  readonly events$ = this.eventSubject.asObservable();

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
    this.activeServerId = null;
    this.connectionError.set(null);
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    this.stopPing();
    this.closeSocket();
    this.connected.set(false);
  }

  sendActivity(): void {
    this.send({
      type: 'activity'
    });
  }

  setActiveServer(serverId: string | null): void {
    this.activeServerId = serverId;
    this.sendServerSubscription();
  }

  private openSocket(): void {
    if (typeof window === 'undefined' || !this.currentToken) {
      return;
    }

    const websocketUrl = `${WS_BASE_URL}/api/events/ws?token=${encodeURIComponent(this.currentToken)}`;
    const socket = new WebSocket(websocketUrl);
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return;
      }

      this.connected.set(true);
      this.connectionError.set(null);
      this.reconnectAttempt = 0;
      this.startPing();
      this.sendActivity();
      this.sendServerSubscription();
    });

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        return;
      }

      try {
        const payload = JSON.parse(event.data) as AppEventsMessage;
        this.eventSubject.next(payload);
      } catch {
        // Ignore malformed payloads instead of breaking reconnect flow.
      }
    });

    socket.addEventListener('error', () => {
      if (this.socket !== socket) {
        return;
      }

      this.connectionError.set('Не удалось подключить realtime-канал');
    });

    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) {
        return;
      }

      this.connected.set(false);
      this.stopPing();
      this.socket = null;

      if (APP_EVENTS_AUTH_CLOSE_CODES.has(event.code)) {
        this.manuallyStopped = true;
        this.currentToken = null;
        this.reconnectAttempt = 0;
        this.connectionError.set('Сессия устарела. Войдите снова.');
        return;
      }

      if (this.manuallyStopped) {
        return;
      }

      this.scheduleReconnect();
    });
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
    }, APP_EVENTS_PING_INTERVAL_MS);
  }

  private sendServerSubscription(): void {
    this.send({
      type: 'subscribe_server',
      server_id: this.activeServerId
    });
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
      APP_EVENTS_RECONNECT_BASE_MS * 2 ** this.reconnectAttempt,
      APP_EVENTS_RECONNECT_MAX_MS
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
