import { API_BASE_URL } from '../api/api-base';

/** Trusted, separately deployed applications. This is not a loader for arbitrary third-party code. */
export const GAME_CALENDAR_PLUGIN = {
  id: 'game-calendar',
  name: 'Календарь игр',
  path: '/plugins/game-calendar/',
} as const;

export function openGameCalendar(): void {
  const localFrontend =
    ['localhost', '127.0.0.1'].includes(location.hostname) &&
    ['4200', '4217'].includes(location.port);
  const base = localFrontend ? location.origin : API_BASE_URL;
  const url = new URL(GAME_CALENDAR_PLUGIN.path, base);
  window.open(url.href, '_blank', 'noopener,noreferrer');
}
