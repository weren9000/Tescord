import { Component, DestroyRef, OnInit, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NewsApiService, NewsPage, newsDate } from '../core/api/news-api.service';

@Component({
  selector: 'app-news-feed',
  templateUrl: './news-feed.component.html',
  styleUrl: './news-feed.component.css',
})
export class NewsFeedComponent implements OnInit {
  readonly limit = input(12);
  readonly archive = input(false);
  readonly featured = input(false);
  readonly result = signal<NewsPage | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly date = newsDate;
  readonly api = inject(NewsApiService);
  readonly failedImages = signal<ReadonlySet<string>>(new Set());
  private readonly destroyRef = inject(DestroyRef);
  ngOnInit() {
    this.load();
  }
  imageFailed(id: string) {
    this.failedImages.update((ids) => new Set([...ids, id]));
  }
  load(page = 1) {
    if (this.result() && this.loading()) return;
    this.loading.set(true);
    this.error.set(false);
    this.api
      .list(page, this.limit())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.result.set(result);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });
  }
}
