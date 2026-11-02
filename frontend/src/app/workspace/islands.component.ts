import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
  untracked,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { API_BASE_URL } from '../core/api/api-base';
import { UiIconComponent } from './ui-icon.component';

@Component({
  selector: 'app-islands',
  imports: [UiIconComponent],
  template: `
    <header>
      <strong>Острова</strong>
      <button type="button" (click)="closed.emit()" aria-label="Вернуться в Квачат">
        <app-ui-icon name="back" /> В Квачат
      </button>
    </header>
    @if (error()) {
      <div role="alert" class="notice">
        <span>{{ error() }}</span>
        <button type="button" [disabled]="busy()" (click)="authorize()">Повторить вход</button>
      </div>
    }
    <iframe
      #game
      [src]="url"
      title="Острова — настольная игра"
      referrerpolicy="no-referrer"
      (load)="frameLoaded()"
    ></iframe>
  `,
  styleUrl: './islands.component.scss',
})
export class IslandsComponent {
  readonly token = input.required<string>();
  readonly closed = output<void>();
  readonly game = viewChild<ElementRef<HTMLIFrameElement>>('game');
  readonly error = signal('');
  readonly busy = signal(false);
  private readonly destroyRef = inject(DestroyRef);
  private readonly localFrontend =
    ['localhost', '127.0.0.1'].includes(location.hostname) &&
    ['4200', '4217'].includes(location.port);
  private readonly source = new URL(
    '/plugins/islands/play.html',
    this.localFrontend ? location.origin : API_BASE_URL,
  );
  readonly url = inject(DomSanitizer).bypassSecurityTrustResourceUrl(this.source.href);
  private request: AbortController | null = null;
  private destroyed = false;
  private ready = false;
  private lastIssue = 0;

  constructor() {
    const message = (event: MessageEvent): void => {
      if (
        event.source !== this.game()?.nativeElement.contentWindow ||
        event.origin !== this.source.origin ||
        event.data?.type !== 'islands:ready'
      ) {
        return;
      }
      this.ready = true;
      if (Date.now() - this.lastIssue > 5000) void this.authorize();
    };
    window.addEventListener('message', message);
    const timer = window.setInterval(() => {
      if (this.ready) void this.authorize();
    }, 40000);
    const visibility = (): void => {
      if (!document.hidden && this.ready && Date.now() - this.lastIssue > 20000)
        void this.authorize();
    };
    document.addEventListener('visibilitychange', visibility);
    effect(() => {
      this.token();
      this.request?.abort();
      this.lastIssue = 0;
      if (this.ready) untracked(() => void this.authorize());
    });
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.request?.abort();
      window.clearInterval(timer);
      window.removeEventListener('message', message);
      document.removeEventListener('visibilitychange', visibility);
    });
  }

  frameLoaded(): void {
    this.game()?.nativeElement.contentWindow?.postMessage(
      { type: 'islands:hello' },
      this.source.origin,
    );
  }

  async authorize(): Promise<void> {
    if (this.destroyed || this.busy() || !this.ready) return;
    this.lastIssue = Date.now();
    const token = this.token();
    this.busy.set(true);
    this.error.set('');
    const request = new AbortController();
    this.request = request;
    const timeout = window.setTimeout(() => request.abort(), 10000);
    try {
      const response = await fetch(`${API_BASE_URL}/api/applications/islands/grant`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: request.signal,
      });
      if (!response.ok)
        throw new Error('Вход в игру недоступен. Проверьте подключение приложения.');
      const body: { grant?: unknown } = await response.json();
      if (typeof body.grant !== 'string' || body.grant.length > 2048)
        throw new Error('Не удалось получить разрешение на вход.');
      if (this.destroyed || token !== this.token()) return;
      this.game()?.nativeElement.contentWindow?.postMessage(
        { type: 'islands:grant', grant: body.grant },
        this.source.origin,
      );
      this.lastIssue = Date.now();
    } catch (error) {
      if (!this.destroyed && token === this.token())
        this.error.set(
          error instanceof Error && error.name !== 'AbortError'
            ? error.message
            : 'Сервер не отвечает. Повторите вход.',
        );
    } finally {
      window.clearTimeout(timeout);
      this.busy.set(false);
    }
  }
}
