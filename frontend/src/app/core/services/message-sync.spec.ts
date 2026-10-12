import { synchronizeMessages } from './message-sync';
import { WorkspaceMessage, WorkspaceMessagePage } from '../models/workspace.models';

describe('message recovery', () => {
  const message = (id: number, content = 'text') => ({ id: String(id), content } as WorkspaceMessage);
  for (const total of [40, 100, 1000]) {
  it(`recovers ${total} messages and replaces changed messages`, async () => {
    const calls: Array<[string | null, string | null]> = [];
    const result = await synchronizeMessages([message(1)], async (from, after) => {
      calls.push([from, after]);
      const start = after ? Number(after) + 1 : 1;
      const end = Math.min(start + 24, total);
      return { items: Array.from({ length: end - start + 1 }, (_, i) => message(start + i, 'updated')), has_newer: end < total, next_after: String(end) } as WorkspaceMessagePage;
    });
    expect(result.length).toBe(total);
    expect(new Set(result.map(item => item.id)).size).toBe(total);
    expect(result[0].content).toBe('updated');
    expect(calls[0]).toEqual(['1', null]);
    expect(calls.length).toBe(Math.ceil(total / 25));
  });
  }
  it('stops fetching when the user switches chats', async () => {
    let current = true;
    let calls = 0;
    await synchronizeMessages([message(1)], async () => {
      calls++;
      current = false;
      return { items: [message(2)], has_newer: true, next_after: '2' } as WorkspaceMessagePage;
    }, () => current);
    expect(calls).toBe(1);
  });
  it('rejects a repeated pagination cursor', async () => {
    await expectAsync(synchronizeMessages([message(1)], async () => ({ items: [], has_newer: true, next_after: '1' } as unknown as WorkspaceMessagePage))).toBeRejectedWithError('Invalid message sync cursor');
  });
});
