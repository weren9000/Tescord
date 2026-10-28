import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Subject, Subscription, defer, finalize } from 'rxjs';
import { WorkspaceApiService } from '../api/workspace-api.service';
import { WorkspaceMessageAttachment } from '../models/workspace.models';

export type AttachmentActionSurface = 'message' | 'chat';
export interface AttachmentPreviewOptions {
  openImageAfterLoad?: boolean;
  reportErrors?: boolean;
  surface?: AttachmentActionSurface;
}

/** Owns blob URLs and cancellable requests for the current chat only. */
@Injectable()
export class AttachmentPreviewStore {
  private readonly api = inject(WorkspaceApiService);
  private readonly previews = new Map<string, Subscription>();
  private readonly downloads = new Map<string, Subscription>();
  readonly urls = signal<Record<string, string>>({});
  readonly loadingIds = signal<string[]>([]);
  readonly downloadingIds = signal<string[]>([]);
  readonly availabilityLabels = signal<Record<string, string>>({});
  readonly openedImageId = signal<string | null>(null);
  readonly failed = new Subject<{
    error: unknown; attachmentId: string; surface: AttachmentActionSurface;
    fallback: string; reportErrors: boolean;
  }>();
  readonly downloadReady = new Subject<{url: string; filename: string}>();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.clear();
      this.failed.complete();
      this.downloadReady.complete();
    });
  }

  load(token: string, attachment: WorkspaceMessageAttachment, options: AttachmentPreviewOptions,
       keep: () => boolean): void {
    const id = attachment.id;
    if (attachment.deleted_at || this.availabilityLabels()[id]) return;
    if (this.urls()[id]) {
      if (options.openImageAfterLoad) this.openedImageId.set(this.openedImageId() === id ? null : id);
      return;
    }
    if (this.previews.has(id)) return;
    const request = new Subscription();
    this.previews.set(id, request);
    this.loadingIds.update(ids => [...ids, id]);
    request.add(defer(() => this.api.downloadAttachment(token, id)).pipe(
      finalize(() => {
        if (this.previews.get(id) !== request) return;
        this.previews.delete(id);
        this.loadingIds.update(ids => ids.filter(value => value !== id));
      }),
    ).subscribe({
      next: blob => {
        if (!keep()) return;
        const url = URL.createObjectURL(blob);
        const previous = this.urls()[id];
        if (previous) URL.revokeObjectURL(previous);
        this.clearAvailability(id);
        this.urls.update(urls => ({...urls, [id]: url}));
        if (options.openImageAfterLoad) this.openedImageId.set(id);
      },
      error: error => this.failed.next({
        error, attachmentId: id, surface: options.surface ?? 'message',
        fallback: 'Не удалось загрузить вложение', reportErrors: options.reportErrors !== false,
      }),
    }));
  }

  download(token: string, attachment: WorkspaceMessageAttachment, surface: AttachmentActionSurface): void {
    const id = attachment.id;
    if (attachment.deleted_at || this.downloads.has(id)) return;
    const request = new Subscription();
    this.downloads.set(id, request);
    this.downloadingIds.update(ids => [...ids, id]);
    request.add(defer(() => this.api.createAttachmentDownloadLink(token, id)).pipe(
      finalize(() => {
        if (this.downloads.get(id) !== request) return;
        this.downloads.delete(id);
        this.downloadingIds.update(ids => ids.filter(value => value !== id));
      }),
    ).subscribe({
      next: ({url}) => {
        this.clearAvailability(id);
        this.downloadReady.next({url, filename: attachment.filename});
      },
      error: error => this.failed.next({
        error, attachmentId: id, surface, fallback: 'Не удалось скачать файл', reportErrors: true,
      }),
    }));
  }

  clearAvailability(id: string): void {
    if (!this.availabilityLabels()[id]) return;
    this.availabilityLabels.update(labels => {
      const next = {...labels};
      delete next[id];
      return next;
    });
  }

  remove(id: string): void {
    this.previews.get(id)?.unsubscribe();
    this.downloads.get(id)?.unsubscribe();
    this.clearAvailability(id);
    const url = this.urls()[id];
    if (url) {
      URL.revokeObjectURL(url);
      this.urls.update(urls => {
        const next = {...urls};
        delete next[id];
        return next;
      });
    }
    if (this.openedImageId() === id) this.openedImageId.set(null);
  }

  clear(): void {
    for (const request of this.previews.values()) request.unsubscribe();
    for (const request of this.downloads.values()) request.unsubscribe();
    for (const url of Object.values(this.urls())) URL.revokeObjectURL(url);
    this.urls.set({});
    this.availabilityLabels.set({});
    this.openedImageId.set(null);
  }
}
