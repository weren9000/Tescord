interface AltgrammRuntimeConfig {
  apiBaseUrl?: string;
  wsBaseUrl?: string;
  sfuUrl?: string;
  iceServers?: RTCIceServer[];
}

interface Window {
  kvaAndroid?: {
    pendingCall(): string | null;
    directAudio?(active: boolean): void;
    audioRoutes?(): { id: string; label: string; selected: boolean }[];
    selectAudioRoute?(id: string): boolean;
  };
  kvaDesktop?: {
    beginSecretDownload?(name: string, size: number): Promise<string | null>;
    writeSecretDownload?(id: string, index: number, data: Uint8Array): Promise<boolean>;
    endSecretDownload?(id: string, commit: boolean): Promise<boolean>;
    readSecretVault?(userId: string): string | null;
    writeSecretVault?(userId: string, value: string | null): boolean;
    version: string;
    readSession(): string | null;
    writeSession(value: string | null): boolean;
    notify?(value: { id: string; title: string; body: string; target: string }): Promise<boolean>;
    clearNotifications?(target?: string): void;
    onNotificationOpen?(callback: (target: string) => void): () => void;
  };
  __TESCORD_RUNTIME_CONFIG__?: AltgrammRuntimeConfig;
}
