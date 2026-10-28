import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Subject, Subscription, defer, finalize } from 'rxjs';
import { WorkspaceApiService } from '../api/workspace-api.service';
import { WorkspaceMessage } from '../models/workspace.models';

export interface MessageUploadProgressState {
  loaded: number;
  total: number | null;
  percent: number | null;
}

type UploadPayload = Parameters<WorkspaceApiService['sendMessage']>[2];
export interface MessageUploadResult {
  channelId: string;
  payload: UploadPayload;
  message: WorkspaceMessage;
}

/** Component-scoped upload lifetime, including idempotent retries after cancellation. */
@Injectable()
export class MessageUploadStore {
  private readonly api = inject(WorkspaceApiService);
  private readonly pendingIds = new Map<string, {signature: string; id: string}>();
  private active: Subscription | null = null;
  readonly submitting = signal(false);
  readonly progress = signal<MessageUploadProgressState | null>(null);
  readonly outcome = signal<'idle' | 'uploading' | 'cancelled' | 'failed'>('idle');
  readonly files = signal<File[]>([]);
  readonly sent = new Subject<MessageUploadResult>();
  readonly failed = new Subject<{channelId: string; error: unknown}>();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.resetSession();
      this.sent.complete();
      this.failed.complete();
    });
  }

  send(token: string, channelId: string, draft: Omit<UploadPayload, 'clientMessageId'>): void {
    if (this.submitting()) return;
    const signature = JSON.stringify([
      draft.content, draft.replyToMessageId ?? null,
      draft.files.map(file => [file.name, file.size, file.lastModified]),
    ]);
    const pending = this.pendingIds.get(channelId);
    const clientMessageId = pending?.signature === signature ? pending.id : crypto.randomUUID();
    this.pendingIds.set(channelId, {signature, id: clientMessageId});
    const payload = {...draft, files: [...draft.files], clientMessageId};
    this.submitting.set(true);
    this.outcome.set(payload.files.length ? 'uploading' : 'idle');
    this.progress.set(payload.files.length ? {loaded: 0, total: null, percent: null} : null);

    // Register the subscription before subscribing, including synchronous test transports.
    const active = new Subscription();
    this.active = active;
    active.add(defer(() => this.api.sendMessage(token, channelId, payload)).pipe(
      finalize(() => {
        if (this.active !== active) return;
        this.active = null;
        this.submitting.set(false);
        this.progress.set(null);
      }),
    ).subscribe({
      next: event => {
        if (event.kind === 'progress') {
          this.progress.set({loaded: event.loaded, total: event.total, percent: event.percent});
          return;
        }
        this.pendingIds.delete(channelId);
        this.outcome.set('idle');
        this.sent.next({channelId, payload, message: event.message});
      },
      error: error => {
        this.outcome.set('failed');
        this.failed.next({channelId, error});
      },
    }));
  }

  cancel(): void {
    if (!this.submitting()) return;
    this.outcome.set('cancelled');
    this.active?.unsubscribe();
  }

  resetView(): void {
    this.cancel();
    this.files.set([]);
    this.outcome.set('idle');
  }

  resetSession(): void {
    this.resetView();
    this.pendingIds.clear();
  }
}
