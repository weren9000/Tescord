import { isMessageContinuation } from './message-layout';
import { WorkspaceMessage } from '../models/workspace.models';

describe('message grouping', () => {
  const message = (author: string, date: string) => ({author: {id: author}, created_at: date} as WorkspaceMessage);
  const first = message('one', '2026-10-12T10:00:00');
  it('groups nearby messages from the same author', () => {
    expect(isMessageContinuation(message('one', '2026-10-12T10:04:59'), first)).toBeTrue();
  });
  it('separates authors, replies, days and five-minute gaps', () => {
    expect(isMessageContinuation(message('two', '2026-10-12T10:00:01'), first)).toBeFalse();
    expect(isMessageContinuation({...first, reply_to: {} as WorkspaceMessage['reply_to']}, first)).toBeFalse();
    expect(isMessageContinuation(message('one', '2026-10-12T10:05:00'), first)).toBeFalse();
    expect(isMessageContinuation(message('one', '2026-10-13T00:00:01'), message('one', '2026-10-12T23:59:59'))).toBeFalse();
  });
});
