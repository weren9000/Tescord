import { signal } from '@angular/core';
import { WorkspaceMessage } from '../models/workspace.models';

export interface MessageEditSession {
  message: WorkspaceMessage;
  text: string;
  draft: string;
  files: File[];
  reply: WorkspaceMessage | null;
  notice: string;
  error: string | null;
  saving: boolean;
  conflict?: WorkspaceMessage;
}

/** In-memory only, scoped to the signed-in account and cleared on logout. */
export class MessageEditState {
  readonly active = signal<MessageEditSession | null>(null);
  private readonly sessions = new Map<string, MessageEditSession>();
  private readonly completed = new Map<string, MessageEditSession>();

  reconcile(
    update: Pick<
      WorkspaceMessage,
      'id' | 'content' | 'edited_at' | 'deleted_at' | 'mentioned_user_ids'
    >,
  ): void {
    for (const session of this.sessions.values()) {
      if (session.reply?.id === update.id)
        this.update(session, { reply: { ...session.reply, ...update } });
      if (session.message.id === update.id && update.deleted_at) {
        this.update(session, {
          message: { ...session.message, deleted_at: update.deleted_at },
          error: 'Сообщение удалено. Ваш текст остался в поле ввода.',
        });
      }
    }
  }

  takeCompleted(channelId: string): MessageEditSession | undefined {
    const session = this.completed.get(channelId);
    this.completed.delete(channelId);
    return session;
  }

  open(session: MessageEditSession): void {
    this.sessions.set(session.message.channel_id, session);
    this.active.set(session);
  }

  visit(channelId: string): MessageEditSession | null {
    const session = this.sessions.get(channelId) ?? null;
    this.active.set(session);
    return session;
  }

  update(session: MessageEditSession, patch: Partial<MessageEditSession>): void {
    const current = this.sessions.get(session.message.channel_id);
    if (current?.message.id !== session.message.id) return;
    const next = { ...current, ...patch };
    this.sessions.set(session.message.channel_id, next);
    if (this.active()?.message.id === session.message.id) this.active.set(next);
  }

  finish(session: MessageEditSession): MessageEditSession {
    session = this.sessions.get(session.message.channel_id) ?? session;
    if (this.active()?.message.id !== session.message.id)
      this.completed.set(session.message.channel_id, session);
    this.sessions.delete(session.message.channel_id);
    if (this.active()?.message.id === session.message.id) this.active.set(null);
    return session;
  }

  clear(): void {
    this.sessions.clear();
    this.completed.clear();
    this.active.set(null);
  }
}
