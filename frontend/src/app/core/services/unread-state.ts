import { WritableSignal } from '@angular/core';

interface UnreadState {
  unread_count?: number;
  mention_unread_count?: number;
  first_unread_message_id?: string | null;
  first_mention_unread_message_id?: string | null;
}

type Counter = 'unread_count' | 'mention_unread_count';
type FirstMessage = 'first_unread_message_id' | 'first_mention_unread_message_id';

/** Applies read-state events to an existing collection without owning its lifecycle. */
export class UnreadStateCollection<T extends UnreadState> {
  constructor(
    private readonly items: WritableSignal<T[]>,
    private readonly identify: (item: T) => string,
  ) {}

  setUnreadCount(id: string, count: number): void {
    this.setCount(id, 'unread_count', count);
  }

  setMentionUnreadCount(id: string, count: number): void {
    this.setCount(id, 'mention_unread_count', count);
  }

  bumpUnreadCount(id: string, delta = 1): void {
    this.bumpCount(id, 'unread_count', delta);
  }

  bumpMentionUnreadCount(id: string, delta = 1): void {
    this.bumpCount(id, 'mention_unread_count', delta);
  }

  setFirstUnreadMessageId(id: string, messageId: string | null): void {
    this.setFirstMessage(id, 'first_unread_message_id', messageId);
  }

  setFirstMentionUnreadMessageId(id: string, messageId: string | null): void {
    this.setFirstMessage(id, 'first_mention_unread_message_id', messageId);
  }

  setFirstUnreadMessageIdIfMissing(id: string, messageId: string): void {
    this.setFirstMessage(id, 'first_unread_message_id', messageId, true);
  }

  setFirstMentionUnreadMessageIdIfMissing(id: string, messageId: string): void {
    this.setFirstMessage(id, 'first_mention_unread_message_id', messageId, true);
  }

  private setCount(id: string, field: Counter, count: number): void {
    this.update(id, item => ({...item, [field]: Math.max(0, count)}));
  }

  private bumpCount(id: string, field: Counter, delta: number): void {
    if (!delta) {
      return;
    }
    this.update(id, item => ({...item, [field]: Math.max(0, (item[field] ?? 0) + delta)}));
  }

  private setFirstMessage(id: string, field: FirstMessage, messageId: string | null, onlyIfMissing = false): void {
    this.update(id, item => onlyIfMissing && item[field] ? item : {...item, [field]: messageId});
  }

  private update(id: string, change: (item: T) => T): void {
    this.items.update(items => items.map(item => this.identify(item) === id ? change(item) : item));
  }
}
