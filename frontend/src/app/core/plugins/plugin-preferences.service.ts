import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { API_BASE_URL } from '../api/api-base';

export interface ConnectedApplication {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

/** Each opening reads the current account; no browser-wide cache of connections. */
@Injectable()
export class PluginPreferencesService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private generation = 0;
  private token = '';
  readonly items = signal<ConnectedApplication[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly loadFailed = signal(false);

  load(token: string): void {
    this.token = token;
    const generation = ++this.generation;
    this.items.set([]);
    this.error.set('');
    this.loadFailed.set(false);
    this.busy.set(false);
    this.loading.set(true);
    this.http
      .get<ConnectedApplication[]>(`${API_BASE_URL}/api/applications`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => {
          if (generation !== this.generation) return;
          this.items.set(items);
          this.loading.set(false);
        },
        error: () => {
          if (generation !== this.generation) return;
          this.loading.set(false);
          this.loadFailed.set(true);
          this.error.set('Не удалось загрузить приложения. Попробуйте ещё раз.');
        },
      });
  }

  setEnabled(item: ConnectedApplication, enabled: boolean): void {
    if (this.busy() || this.loading()) return;
    const generation = this.generation;
    this.busy.set(true);
    this.error.set('');
    this.items.update((items) =>
      items.map((entry) => (entry.id === item.id ? { ...entry, enabled } : entry)),
    );
    this.http
      .put<ConnectedApplication>(
        `${API_BASE_URL}/api/applications/${encodeURIComponent(item.id)}`,
        { enabled },
        {
          headers: { Authorization: `Bearer ${this.token}` },
        },
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (generation !== this.generation) return;
          this.items.update((items) =>
            items.map((entry) => (entry.id === result.id ? result : entry)),
          );
          this.busy.set(false);
        },
        error: () => {
          if (generation !== this.generation) return;
          this.items.update((items) => items.map((entry) => (entry.id === item.id ? item : entry)));
          this.busy.set(false);
          this.error.set('Не удалось сохранить подключение. Попробуйте ещё раз.');
        },
      });
  }
}
