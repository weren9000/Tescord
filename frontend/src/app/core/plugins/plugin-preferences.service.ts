import { Injectable, signal } from '@angular/core';

const storageKey = 'kva.applications.game-calendar.v1';

@Injectable({ providedIn: 'root' })
export class PluginPreferencesService {
  private readonly enabledUsers = signal<string[]>(this.load());
  readonly saved = signal(true);

  calendarEnabled(userId: string | null | undefined): boolean {
    return !!userId && this.enabledUsers().includes(userId);
  }

  setCalendarEnabled(userId: string | null, enabled: boolean): void {
    if (!userId) return;
    const next = this.enabledUsers().filter((id) => id !== userId);
    if (enabled) next.push(userId);
    this.enabledUsers.set(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      this.saved.set(true);
    } catch {
      this.saved.set(false);
    }
  }

  private load(): string[] {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }
}
