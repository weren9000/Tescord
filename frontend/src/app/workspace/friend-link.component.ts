import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../core/api/api-base';

interface FriendLink {
  code: string | null;
  expires_at: string | null;
}

@Component({
  selector: 'app-friend-link',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: ` <section aria-label="Пригласить в друзья">
    <strong>Пригласить в друзья</strong>
    <p>
      По ссылке вас можно добавить без подтверждения. Ею могут воспользоваться несколько человек до
      окончания срока.
    </p>
    <label
      >Срок действия
      <select aria-label="Срок действия" [(ngModel)]="duration" [disabled]="busy()">
        <option value="1">1 час</option>
        <option value="24">24 часа</option>
        <option value="168">7 дней</option>
        <option value="custom">Свой срок</option>
      </select>
    </label>
    @if (duration === 'custom') {
      <label
        >Количество часов (1–720)<input
          type="number"
          min="1"
          max="720"
          step="1"
          [(ngModel)]="customHours"
          [disabled]="busy()"
      /></label>
    }
    @if (link()?.code) {
      <label
        >Ссылка приглашения<input #urlInput readonly [value]="url()" (click)="urlInput.select()"
      /></label>
      <small>Действует до {{ link()?.expires_at | date: 'dd.MM.yyyy HH:mm' }}</small>
      <div class="actions">
        <button type="button" [disabled]="busy()" (click)="copy(urlInput)">
          {{ copied() ? 'Скопировано' : 'Копировать' }}
        </button>
        @if (canShare) {
          <button type="button" [disabled]="busy()" (click)="share()">Поделиться</button>
        }
        <button type="button" [disabled]="busy()" (click)="revoke()">Отозвать</button>
      </div>
    }
    <button type="button" [disabled]="busy() || !validHours()" (click)="create()">
      {{ busy() ? 'Подождите…' : link()?.code ? 'Создать новую ссылку' : 'Создать ссылку' }}
    </button>
    @if (link()?.code) {
      <small>Новая ссылка заменит предыдущую.</small>
    }
    @if (notice()) {
      <p role="status">{{ notice() }}</p>
    }
  </section>`,
  styles: [
    `
      :host {
        display: block;
        margin-top: 12px;
      }
      section {
        border-top: 1px solid var(--palette-border);
        padding-top: 12px;
      }
      strong {
        font-size: 14px;
      }
      p,
      small {
        font-size: 12px;
        line-height: 1.5;
        color: var(--palette-muted);
      }
      small {
        display: block;
        margin-top: 6px;
      }
      label {
        display: grid;
        gap: 6px;
        font-size: 13px;
        margin: 10px 0;
        color: var(--palette-muted);
      }
      input,
      select {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        padding: 9px;
        border: 1px solid var(--palette-border);
        border-radius: 7px;
        background: var(--palette-canvas);
        color: var(--palette-text);
        font: inherit;
      }
      button {
        padding: 9px 12px;
        min-height: 44px;
        border: 1px solid var(--palette-border);
        border-radius: 7px;
        background: var(--palette-raised);
        color: var(--palette-text);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 10px 0;
      }
      button:disabled {
        opacity: 0.5;
        cursor: default;
      }
      button:focus-visible,
      input:focus-visible,
      select:focus-visible {
        outline: 2px solid var(--palette-primary);
        outline-offset: 2px;
      }
    `,
  ],
})
export class FriendLinkComponent {
  readonly token = input.required<string>();
  readonly link = signal<FriendLink | null>(null);
  readonly url = computed(
    () => window.location.origin + '/?friend=' + encodeURIComponent(this.link()?.code ?? ''),
  );
  readonly copied = signal(false);
  readonly notice = signal('');
  readonly busy = signal(false);
  readonly canShare = typeof navigator.share === 'function';
  duration = '24';
  customHours = 24;
  private readonly http = inject(HttpClient);
  private readonly endpoint = API_BASE_URL + '/api/friends/invite-link';
  constructor() {
    effect(() => {
      const token = this.token();
      void this.load(token);
    });
  }
  private headers() {
    return { Authorization: 'Bearer ' + this.token() };
  }
  validHours() {
    const n = this.duration === 'custom' ? this.customHours : Number(this.duration);
    return Number.isInteger(n) && n >= 1 && n <= 720;
  }
  private async load(token: string) {
    this.busy.set(true);
    try {
      const link = await firstValueFrom(
        this.http.get<FriendLink>(this.endpoint, { headers: { Authorization: 'Bearer ' + token } }),
      );
      if (token === this.token()) this.link.set(link);
    } catch {
      this.notice.set('Не удалось загрузить ссылку.');
    } finally {
      this.busy.set(false);
    }
  }
  async create() {
    if (this.busy() || !this.validHours()) return;
    this.busy.set(true);
    this.notice.set('');
    this.copied.set(false);
    try {
      this.link.set(
        await firstValueFrom(
          this.http.post<FriendLink>(
            this.endpoint,
            { hours: this.duration === 'custom' ? this.customHours : Number(this.duration) },
            { headers: this.headers() },
          ),
        ),
      );
      this.notice.set('Ссылка создана и уже сохранена.');
    } catch {
      this.notice.set('Не удалось создать ссылку. Повторите попытку.');
    } finally {
      this.busy.set(false);
    }
  }
  async revoke() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.delete(this.endpoint, { headers: this.headers() }));
      this.link.set(null);
      this.notice.set('Ссылка отозвана.');
    } catch {
      this.notice.set('Не удалось отозвать ссылку.');
    } finally {
      this.busy.set(false);
    }
  }
  async copy(input: HTMLInputElement) {
    try {
      await navigator.clipboard.writeText(this.url());
      this.copied.set(true);
    } catch {
      input.focus();
      input.select();
      this.notice.set('Выделите и скопируйте ссылку вручную.');
    }
  }
  async share() {
    this.busy.set(true);
    try {
      await navigator.share({ title: 'Добавить в друзья в Квачате', url: this.url() });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        this.notice.set('Не удалось поделиться. Скопируйте ссылку.');
    } finally {
      this.busy.set(false);
    }
  }
}
