interface AltgrammRuntimeConfig {
  apiBaseUrl?: string;
  wsBaseUrl?: string;
  sfuUrl?: string;
  iceServers?: RTCIceServer[];
}

interface Window {
  kvaAndroid?: {pendingCall(): string | null};
  kvaDesktop?: {
    version: string; readSession(): string | null; writeSession(value: string | null): boolean;
    notify?(value: {id: string; title: string; body: string; target: string}): Promise<boolean>;
    clearNotifications?(target?: string): void;
    onNotificationOpen?(callback: (target: string) => void): () => void;
  };
  __TESCORD_RUNTIME_CONFIG__?: AltgrammRuntimeConfig;
}
