interface AltgrammRuntimeConfig {
  apiBaseUrl?: string;
  wsBaseUrl?: string;
  sfuUrl?: string;
  iceServers?: RTCIceServer[];
}

interface Window {
  __TESCORD_RUNTIME_CONFIG__?: AltgrammRuntimeConfig;
}
