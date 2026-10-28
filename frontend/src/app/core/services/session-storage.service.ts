import { Injectable } from '@angular/core';
import { AuthSessionResponse } from '../models/auth.models';

const SESSION_KEY = 'tescord.session';

/** Keeps native encrypted storage authoritative; storage failures must not break login. */
@Injectable({ providedIn: 'root' })
export class SessionStorageService {
  read(): AuthSessionResponse | null {
    try {
      const raw = window.kvaDesktop
        ? window.kvaDesktop.readSession()
        : localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw) as AuthSessionResponse | null;
      if (!session || typeof session.access_token !== 'string' || !session.access_token ||
          !session.user || typeof session.user.id !== 'string' || !session.user.id) {
        throw new Error('Invalid stored session');
      }
      return session;
    } catch {
      this.clear();
      return null;
    }
  }

  write(session: AuthSessionResponse): void {
    try {
      if (window.kvaDesktop) {
        window.kvaDesktop.writeSession(JSON.stringify(session));
        this.clearBrowserStorage();
      } else {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      }
    } catch {
      // The active session remains in memory when persistence is unavailable.
    }
  }

  clear(): void {
    try {
      window.kvaDesktop?.writeSession(null);
    } catch {
      // Browser cleanup must still run if the native bridge fails.
    }
    this.clearBrowserStorage();
  }

  private clearBrowserStorage(): void {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* Storage can be disabled. */ }
  }
}
