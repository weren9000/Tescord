interface TescordRuntimeConfig {
  apiBaseUrl?: string;
  wsBaseUrl?: string;
  iceServers?: RTCIceServer[];
}

interface Window {
  __TESCORD_RUNTIME_CONFIG__?: TescordRuntimeConfig;
}
