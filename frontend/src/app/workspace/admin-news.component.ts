import { Component, DestroyRef, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { AdminNewsPost, NewsApiService, NewsPage, newsDate } from '../core/api/news-api.service';

@Component({
  selector: 'app-admin-news',
  imports: [FormsModule],
  templateUrl: './admin-news.component.html',
  styleUrl: './admin-news.component.css',
})
export class AdminNewsComponent implements OnInit {
  readonly token = input.required<string>();
  readonly forbidden = output<void>();
  readonly result = signal<NewsPage<AdminNewsPost> | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly editing = signal(false);
  readonly error = signal('');
  readonly listError = signal('');
  readonly notice = signal('');
  readonly preview = signal('');
  readonly date = newsDate;
  private readonly api = inject(NewsApiService);
  private readonly destroyRef = inject(DestroyRef);
  private imageRequest?: Subscription;
  private original = '';
  private file: File | null = null;
  id: string | null = null;
  version = 0;
  published = false;
  removeImage = false;
  form = { title: '', excerpt: '', body: '' };

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.imageRequest?.unsubscribe();
      this.setPreview('');
    });
  }
  ngOnInit() {
    this.load();
  }
  load(page = 1) {
    this.loading.set(true);
    this.listError.set('');
    this.api
      .adminList(this.token(), page)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.result.set(result);
          this.loading.set(false);
        },
        error: (error) => {
          this.listError.set(this.message(error));
          this.loading.set(false);
        },
      });
  }
  private message(error: HttpErrorResponse) {
    if (error.status === 401 || error.status === 403) this.forbidden.emit();
    return typeof error.error?.detail === 'string'
      ? error.error.detail
      : 'Не удалось выполнить действие. Попробуйте ещё раз.';
  }
  private canLeave() {
    return (
      !this.editing() ||
      (JSON.stringify(this.form) === this.original && !this.file && !this.removeImage) ||
      window.confirm('Есть несохранённые изменения. Закрыть их без сохранения?')
    );
  }
  edit(post?: AdminNewsPost) {
    if (this.saving() || !this.canLeave()) return;
    this.imageRequest?.unsubscribe();
    this.setPreview('');
    this.file = null;
    this.removeImage = false;
    this.id = post?.id ?? null;
    this.version = post?.version ?? 0;
    this.published = post?.published ?? false;
    this.form = { title: post?.title ?? '', excerpt: post?.excerpt ?? '', body: post?.body ?? '' };
    this.original = JSON.stringify(this.form);
    this.error.set('');
    this.notice.set('');
    this.editing.set(true);
    if (post?.has_image) {
      this.imageRequest = this.api
        .adminImage(this.token(), post.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (blob) => this.setPreview(URL.createObjectURL(blob)),
          error: (error) => this.error.set(this.message(error)),
        });
    }
  }
  close() {
    if (this.saving() || !this.canLeave()) return;
    this.imageRequest?.unsubscribe();
    this.editing.set(false);
    this.setPreview('');
  }
  keydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.editing()) {
      event.stopPropagation();
      this.close();
    }
  }
  private setPreview(url: string) {
    if (this.preview()) URL.revokeObjectURL(this.preview());
    this.preview.set(url);
  }
  chooseImage(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 4 * 1024 * 1024
    ) {
      this.error.set('Выберите PNG, JPEG или WebP не больше 4 МБ.');
      return;
    }
    this.imageRequest?.unsubscribe();
    this.file = file;
    this.removeImage = false;
    this.error.set('');
    this.setPreview(URL.createObjectURL(file));
  }
  clearImage() {
    this.imageRequest?.unsubscribe();
    this.file = null;
    this.removeImage = true;
    this.setPreview('');
  }
  save(published: boolean) {
    if (this.saving()) return;
    if (!Object.values(this.form).every((value) => value.trim())) {
      this.error.set('Заполните заголовок, короткое описание и текст.');
      return;
    }
    const payload = new FormData();
    for (const [key, value] of Object.entries(this.form)) payload.set(key, value.trim());
    payload.set('published', String(published));
    payload.set('version', String(this.version));
    payload.set('remove_image', String(this.removeImage));
    if (this.file) payload.set('image', this.file);
    this.saving.set(true);
    this.error.set('');
    this.notice.set('');
    this.api
      .save(this.token(), this.id, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (post) => {
          this.id = post.id;
          this.version = post.version;
          this.published = post.published;
          this.form = { title: post.title, excerpt: post.excerpt, body: post.body };
          this.original = JSON.stringify(this.form);
          this.file = null;
          this.removeImage = false;
          this.saving.set(false);
          this.notice.set(published ? 'Новость опубликована.' : 'Черновик сохранён.');
          this.load();
        },
        error: (error) => {
          this.error.set(this.message(error));
          this.saving.set(false);
        },
      });
  }
}
