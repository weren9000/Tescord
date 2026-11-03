import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { NewsApiService, NewsPost, newsDate } from '../core/api/news-api.service';
import { GuestHeaderComponent } from './guest-header.component';
import { NewsFeedComponent } from './news-feed.component';

@Component({
  selector: 'app-root',
  host: { class: 'kva-app' },
  imports: [GuestHeaderComponent, NewsFeedComponent],
  templateUrl: './news-page.component.html',
  styleUrl: './landing.component.css',
})
export class NewsPageComponent {
  readonly id = location.pathname.replace(/\/$/, '').split('/')[2] ?? '';
  readonly post = signal<NewsPost | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly imageFailed = signal(false);
  readonly api = inject(NewsApiService);
  readonly date = newsDate;
  private readonly destroyRef = inject(DestroyRef);
  constructor() {
    document.title = 'Новости — Квачат';
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical) canonical.href = 'https://kvachat.ru' + location.pathname;
    if (this.id) this.load();
  }
  load() {
    this.loading.set(true);
    this.error.set('');
    this.api
      .detail(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (post) => {
          this.post.set(post);
          this.loading.set(false);
          document.title = `${post.title} — Квачат`;
        },
        error: (error: HttpErrorResponse) => {
          this.loading.set(false);
          this.error.set(
            error.status === 404 || error.status === 422
              ? 'Новость не найдена или снята с публикации.'
              : 'Не удалось загрузить новость. Попробуйте ещё раз.',
          );
        },
      });
  }
}
