function normalizeBaseUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed || null;
}

function getRuntimeConfig(): AltgrammRuntimeConfig {
  if (typeof window === 'undefined') {
    return {};
  }

  return window.__TESCORD_RUNTIME_CONFIG__ ?? {};
}

function buildDefaultApiBaseUrl(): string {
  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:8000';
  }

  const { hostname, port, origin } = window.location;
  if ((hostname === 'localhost' || hostname === '127.0.0.1') && port === '4200') {
    return 'http://127.0.0.1:8000';
  }

  return origin;
}

function buildDefaultWsBaseUrl(apiBaseUrl: string): string {
  if (apiBaseUrl.startsWith('http://') || apiBaseUrl.startsWith('https://')) {
    return apiBaseUrl.replace(/^http/i, 'ws');
  }

  if (typeof window === 'undefined') {
    return 'ws://127.0.0.1:8000';
  }

  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
}

function buildDefaultSfuUrl(wsBaseUrl: string): string {
  return `${wsBaseUrl}/livekit`;
}

const runtimeConfig = getRuntimeConfig();
export const API_BASE_URL = normalizeBaseUrl(runtimeConfig.apiBaseUrl) ?? buildDefaultApiBaseUrl();
export const WS_BASE_URL = normalizeBaseUrl(runtimeConfig.wsBaseUrl) ?? buildDefaultWsBaseUrl(API_BASE_URL);
export const SFU_BASE_URL = normalizeBaseUrl(runtimeConfig.sfuUrl) ?? buildDefaultSfuUrl(WS_BASE_URL);
export const VOICE_ICE_SERVERS: RTCIceServer[] = runtimeConfig.iceServers?.length
  ? runtimeConfig.iceServers
  : [
      {
        urls: 'stun:stun.l.google.com:19302'
      }
    ];
