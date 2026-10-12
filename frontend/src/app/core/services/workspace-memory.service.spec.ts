import { WorkspaceMemoryService } from './workspace-memory.service';

describe('workspace memory', () => {
  afterEach(() => { localStorage.removeItem('kva-workspace:ux-test-a'); localStorage.removeItem('kva-workspace:ux-test-b'); });
  it('restores drafts and reading positions without mixing users or channels', () => {
    const memory = new WorkspaceMemoryService();
    memory.useUser('ux-test-a');
    memory.remember('one', {draft: 'first draft', anchor: 'message-1', offset: -12});
    memory.remember('two', {draft: 'second draft'});
    memory.visit('space', 'two');
    memory.useUser('ux-test-b');
    expect(memory.channel('one').draft).toBeUndefined();
    const restored = new WorkspaceMemoryService();
    restored.useUser('ux-test-a');
    expect(restored.channel('one')).toEqual({draft: 'first draft', anchor: 'message-1', offset: -12});
    expect(restored.channel('two').draft).toBe('second draft');
    expect(restored.lastChannel('space')).toBe('two');
    expect(restored.last()).toEqual({spaceId: 'space', channelId: 'two'});
  });
  it('ignores corrupt data and keeps working when storage is unavailable', () => {
    localStorage.setItem('kva-workspace:ux-test-a', '{broken');
    const memory = new WorkspaceMemoryService();
    memory.useUser('ux-test-a');
    spyOn(localStorage, 'setItem').and.throwError('QuotaExceeded');
    expect(() => memory.remember('one', {draft: 'still here'})).not.toThrow();
    expect(memory.channel('one').draft).toBe('still here');
  });
});
