import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { WorkspaceApiService, WorkspaceMessageUploadEvent } from '../api/workspace-api.service';
import { WorkspaceMessage } from '../models/workspace.models';
import { MessageUploadStore } from './message-upload.store';

const message: WorkspaceMessage = {
  id: 'message', channel_id: 'chat', type: 'text', content: 'hello',
  created_at: '2026-10-29T00:00:00Z', edited_at: null,
  author: {id: 'user', public_id: 1, login: 'user', nick: 'User', avatar_updated_at: null},
  reply_to: null, attachments: [], reactions: [], read_by: [], mentioned_user_ids: [],
};

describe('MessageUploadStore', () => {
  let store: MessageUploadStore;
  let api: jasmine.SpyObj<WorkspaceApiService>;
  let request: Subject<WorkspaceMessageUploadEvent>;
  const file = new File(['image'], 'image.png', {type: 'image/png', lastModified: 1});
  const draft = {content: 'hello', files: [file], replyToMessageId: null};

  beforeEach(() => {
    request = new Subject();
    api = jasmine.createSpyObj<WorkspaceApiService>('WorkspaceApiService', ['sendMessage']);
    api.sendMessage.and.returnValue(request);
    TestBed.configureTestingModule({providers: [MessageUploadStore, {provide: WorkspaceApiService, useValue: api}]});
    store = TestBed.inject(MessageUploadStore);
  });

  it('tracks progress and emits the submitted snapshot on success', () => {
    const sent = jasmine.createSpy('sent');
    store.sent.subscribe(sent);
    store.send('token', 'chat', draft);
    expect(store.submitting()).toBeTrue();
    expect(store.outcome()).toBe('uploading');
    request.next({kind: 'progress', loaded: 50, total: 100, percent: 50});
    expect(store.progress()).toEqual({loaded: 50, total: 100, percent: 50});
    request.next({kind: 'response', message});
    request.complete();
    expect(sent).toHaveBeenCalledWith(jasmine.objectContaining({channelId: 'chat', message}));
    expect(sent.calls.mostRecent().args[0].payload.files).not.toBe(draft.files);
    expect(store.submitting()).toBeFalse();
    expect(store.progress()).toBeNull();
    expect(store.outcome()).toBe('idle');
  });

  it('cancels transport, retains selected files and reuses the id for a retry', () => {
    const sent = jasmine.createSpy('sent');
    store.sent.subscribe(sent);
    store.files.set([file]);
    store.send('token', 'chat', draft);
    const firstId = api.sendMessage.calls.mostRecent().args[2].clientMessageId;
    store.cancel();
    expect(request.observed).toBeFalse();
    expect(store.outcome()).toBe('cancelled');
    expect(store.submitting()).toBeFalse();
    expect(store.files()).toEqual([file]);
    request.next({kind: 'response', message});
    expect(sent).not.toHaveBeenCalled();
    api.sendMessage.and.returnValue(new Subject());
    store.send('token', 'chat', draft);
    expect(api.sendMessage.calls.mostRecent().args[2].clientMessageId).toBe(firstId);
  });

  it('retries failures with the same id but gives edited messages a new id', () => {
    const failed = jasmine.createSpy('failed');
    store.failed.subscribe(failed);
    store.send('token', 'chat', draft);
    const firstId = api.sendMessage.calls.mostRecent().args[2].clientMessageId;
    request.error(new Error('offline'));
    expect(store.outcome()).toBe('failed');
    expect(failed).toHaveBeenCalled();
    api.sendMessage.and.returnValue(throwError(() => new Error('offline')));
    store.send('token', 'chat', draft);
    expect(api.sendMessage.calls.mostRecent().args[2].clientMessageId).toBe(firstId);
    store.send('token', 'chat', {...draft, content: 'edited'});
    expect(api.sendMessage.calls.mostRecent().args[2].clientMessageId).not.toBe(firstId);
  });

  it('blocks double submission and cancels old work when the chat is reset', () => {
    const failed = jasmine.createSpy('failed');
    store.failed.subscribe(failed);
    store.send('token', 'chat', draft);
    store.send('token', 'chat', draft);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    store.resetView();
    expect(request.observed).toBeFalse();
    expect(store.files()).toEqual([]);
    expect(store.outcome()).toBe('idle');
    const next = new Subject<WorkspaceMessageUploadEvent>();
    api.sendMessage.and.returnValue(next);
    store.send('token', 'other-chat', draft);
    request.error(new Error('late error'));
    expect(failed).not.toHaveBeenCalled();
    expect(store.submitting()).toBeTrue();
    expect(store.outcome()).toBe('uploading');
  });

  it('releases completed ids and resets retry identity when the account changes', () => {
    api.sendMessage.and.returnValue(of({kind: 'response', message}));
    store.send('token', 'chat', draft);
    const firstId = api.sendMessage.calls.mostRecent().args[2].clientMessageId;
    store.send('token', 'chat', draft);
    expect(api.sendMessage.calls.mostRecent().args[2].clientMessageId).not.toBe(firstId);
    api.sendMessage.and.returnValue(request);
    store.send('token', 'chat', draft);
    const pendingId = api.sendMessage.calls.mostRecent().args[2].clientMessageId;
    store.resetSession();
    store.send('other-token', 'chat', draft);
    expect(api.sendMessage.calls.mostRecent().args[2].clientMessageId).not.toBe(pendingId);
  });

  it('cancels outstanding work when its owning injector is destroyed', () => {
    store.send('token', 'chat', draft);
    TestBed.resetTestingModule();
    expect(request.observed).toBeFalse();
    expect(store.submitting()).toBeFalse();
  });
});
