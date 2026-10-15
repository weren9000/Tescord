interface AltgrammRuntimeConfig {
  apiBaseUrl?: string;
  wsBaseUrl?: string;
  sfuUrl?: string;
  iceServers?: RTCIceServer[];
}

interface Window {
  kvaDesktop?: {version: string; readSession(): string | null; writeSession(value: string | null): boolean};
  __TESCORD_RUNTIME_CONFIG__?: AltgrammRuntimeConfig;
}
