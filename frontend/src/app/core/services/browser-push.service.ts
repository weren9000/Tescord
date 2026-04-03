import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Subject } from 'rxjs';

import { WorkspaceApiService } from '../api/workspace-api.service';
import { PushConfigResponse } from '../models/push.models';

interface PushNavigationMessage {
  type: 'open_conversation';
  conversationId: string;
}

export interface BrowserPushEnableResult {
  warning: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class BrowserPushService {
  private readonly workspaceApi = inject(WorkspaceApiService);
  private readonly navigationRequestsSubject = new Subject<string>();
  private serviceWorkerListenerBound = false;
  private pushConfigPromise: Promise<PushConfigResponse> | null = null;

  readonly navigationRequests$ = this.navigationRequestsSubject.asObservable();

  async initialize(token: string): Promise<void> {
    this.bindServiceWorkerMessages();
    this.emitConversationFromLocation();

    if (
      !this.isSupported()
      || !this.isSecureContextAvailable()
      || this.requiresStandaloneMode()
      || typeof Notification === 'undefined'
      || Notification.permission !== 'granted'
    ) {
      return;
    }

    const config = await this.getPushConfig(token);
    if (!config.enabled || !config.vapid_public_key) {
      return;
    }

    const registration = await this.ensureServiceWorkerRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      return;
    }

    await this.syncSubscription(token, subscription);
  }

  isSupported(): boolean {
    return (
      typeof window !== 'undefined'
      && typeof navigator !== 'undefined'
      && 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window
    );
  }

  async enableConversationPush(token: string, conversationId: string): Promise<BrowserPushEnableResult> {
    const config = await this.getPushConfig(token);
    if (!config.enabled || !config.vapid_public_key) {
      throw new Error('Push-уведомления еще не настроены на сервере');
    }

    let warning = this.getCapabilityWarning();
    if (!warning) {
      try {
        await this.ensureBrowserSubscription(token, config);
      } catch (error) {
        warning = this.describePushSetupIssue(error);
      }
    }

    await firstValueFrom(
      this.workspaceApi.updateConversationPushSetting(token, conversationId, { push_enabled: true })
    );

    return { warning };
  }

  async disableConversationPush(token: string, conversationId: string): Promise<void> {
    await firstValueFrom(
      this.workspaceApi.updateConversationPushSetting(token, conversationId, { push_enabled: false })
    );
  }

  private bindServiceWorkerMessages(): void {
    if (this.serviceWorkerListenerBound || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    navigator.serviceWorker.addEventListener('message', (event: MessageEvent<PushNavigationMessage>) => {
      if (event.data?.type !== 'open_conversation' || !event.data.conversationId) {
        return;
      }

      this.navigationRequestsSubject.next(event.data.conversationId);
    });
    this.serviceWorkerListenerBound = true;
  }

  private emitConversationFromLocation(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    const conversationId = url.searchParams.get('pushConversation');
    if (!conversationId) {
      return;
    }

    url.searchParams.delete('pushConversation');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    this.navigationRequestsSubject.next(conversationId);
  }

  private async getPushConfig(token: string): Promise<PushConfigResponse> {
    if (!this.pushConfigPromise) {
      this.pushConfigPromise = firstValueFrom(this.workspaceApi.getPushConfig(token));
    }

    return this.pushConfigPromise;
  }

  private async ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
    const registration = await navigator.serviceWorker.register('/push-sw.js');
    await navigator.serviceWorker.ready;
    return registration;
  }

  private async ensureBrowserSubscription(token: string, config: PushConfigResponse): Promise<void> {
    if (!this.isSupported()) {
      throw new Error('Этот браузер не поддерживает web push-уведомления');
    }

    if (!this.isSecureContextAvailable()) {
      throw new Error('Для push нужен защищенный HTTPS-домен с доверенным сертификатом');
    }

    if (this.requiresStandaloneMode()) {
      throw new Error('На iPhone push работают после добавления сайта на экран домой');
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Браузер не разрешил уведомления. Разрешите их в настройках сайта');
    }

    const registration = await this.ensureServiceWorkerRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(config.vapid_public_key ?? ''),
      });
    }

    await this.syncSubscription(token, subscription);
  }

  private async syncSubscription(token: string, subscription: PushSubscription): Promise<void> {
    const serialized = subscription.toJSON();
    const endpoint = serialized.endpoint;
    const p256dh = serialized.keys?.['p256dh'];
    const auth = serialized.keys?.['auth'];

    if (!endpoint || !p256dh || !auth) {
      throw new Error('Не удалось подготовить push-подписку браузера');
    }

    await firstValueFrom(
      this.workspaceApi.registerPushSubscription(token, {
        endpoint,
        keys: { p256dh, auth },
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      })
    );
  }

  private isSecureContextAvailable(): boolean {
    return typeof window !== 'undefined' && window.isSecureContext === true;
  }

  private requiresStandaloneMode(): boolean {
    return this.isAppleMobileDevice() && !this.isStandaloneDisplayMode();
  }

  private isAppleMobileDevice(): boolean {
    if (typeof navigator === 'undefined') {
      return false;
    }

    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  private isStandaloneDisplayMode(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
    return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
  }

  private getCapabilityWarning(): string | null {
    if (!this.isSupported()) {
      return 'Этот браузер не поддерживает web push-уведомления';
    }

    if (!this.isSecureContextAvailable()) {
      return 'Для реальных push нужен защищенный HTTPS-домен с доверенным сертификатом';
    }

    if (this.requiresStandaloneMode()) {
      return 'На iPhone push работают после добавления сайта на экран домой';
    }

    return null;
  }

  private describePushSetupIssue(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return 'Не удалось подготовить push-уведомления в браузере';
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const normalized = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(normalized);
    const outputArray = new Uint8Array(rawData.length);
    for (let index = 0; index < rawData.length; index += 1) {
      outputArray[index] = rawData.charCodeAt(index);
    }
    return outputArray;
  }
}
