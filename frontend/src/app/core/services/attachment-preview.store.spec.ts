import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of } from 'rxjs';
import { WorkspaceApiService } from '../api/workspace-api.service';
import {
  WorkspaceAttachmentDownloadLink,
  WorkspaceMessageAttachment,
} from '../models/workspace.models';
import { AttachmentPreviewStore } from './attachment-preview.store';

export const previewAttachment: WorkspaceMessageAttachment = {
  id: 'image',
  filename: 'photo.png',
  mime_type: 'image/png',
  size_bytes: 10,
  created_at: '2026-10-29T00:00:00Z',
  deleted_at: null,
};

describe('AttachmentPreviewStore', () => {
  let store: AttachmentPreviewStore;
  let api: jasmine.SpyObj<WorkspaceApiService>;
  let request: Subject<Blob>;

  beforeEach(() => {
    request = new Subject();
    api = jasmine.createSpyObj<WorkspaceApiService>('WorkspaceApiService', [
      'downloadAttachment',
      'createAttachmentDownloadLink',
    ]);
    api.downloadAttachment.and.returnValue(request);
    TestBed.configureTestingModule({
      providers: [AttachmentPreviewStore, { provide: WorkspaceApiService, useValue: api }],
    });
    store = TestBed.inject(AttachmentPreviewStore);
    spyOn(URL, 'createObjectURL').and.returnValues('blob:first', 'blob:second');
    spyOn(URL, 'revokeObjectURL');
  });

  it('deduplicates previews, caches their URLs and toggles the image viewer', () => {
    store.load('token', previewAttachment, { openImageAfterLoad: true }, () => true);
    store.load('token', previewAttachment, {}, () => true);
    expect(api.downloadAttachment).toHaveBeenCalledTimes(1);
    expect(store.loadingIds()).toEqual(['image']);
    request.next(new Blob(['image']));
    request.complete();
    expect(store.urls()['image']).toBe('blob:first');
    expect(store.loadingIds()).toEqual([]);
    expect(store.openedImageId()).toBe('image');
    store.load('token', previewAttachment, { openImageAfterLoad: true }, () => true);
    expect(store.openedImageId()).toBeNull();
    expect(api.downloadAttachment).toHaveBeenCalledTimes(1);
  });

  it('cancels old previews on chat change and does not let late results replace a new request', () => {
    store.load('token', previewAttachment, { openImageAfterLoad: true }, () => true);
    store.clear();
    expect(request.observed).toBeFalse();
    const next = new Subject<Blob>();
    api.downloadAttachment.and.returnValue(next);
    store.load('token', previewAttachment, {}, () => true);
    request.next(new Blob(['stale']));
    request.complete();
    expect(store.loadingIds()).toEqual(['image']);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    next.next(new Blob(['current']));
    next.complete();
    expect(store.urls()['image']).toBe('blob:first');
    expect(store.openedImageId()).toBeNull();
  });

  it('releases object URLs and cancels pending work when an attachment is deleted', () => {
    store.load('token', previewAttachment, { openImageAfterLoad: true }, () => true);
    request.next(new Blob(['image']));
    store.remove('image');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnceWith('blob:first');
    expect(request.observed).toBeFalse();
    expect(store.urls()).toEqual({});
    expect(store.loadingIds()).toEqual([]);
    expect(store.openedImageId()).toBeNull();
    request.next(new Blob(['late']));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('does not retain media outside the current history or fetch deleted/unavailable files', () => {
    store.load('token', previewAttachment, {}, () => false);
    request.next(new Blob(['old']));
    request.complete();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    store.load('token', { ...previewAttachment, deleted_at: '2026-10-29' }, {}, () => true);
    store.availabilityLabels.set({ image: 'Нет доступа' });
    store.load('token', previewAttachment, {}, () => true);
    expect(api.downloadAttachment).toHaveBeenCalledTimes(1);
  });

  it('reports errors with their original surface and allows retry after transport failure', () => {
    const failed = jasmine.createSpy('failed');
    store.failed.subscribe(failed);
    store.load('token', previewAttachment, { surface: 'chat', reportErrors: false }, () => true);
    const error = new HttpErrorResponse({ status: 404 });
    request.error(error);
    expect(failed).toHaveBeenCalledWith(
      jasmine.objectContaining({ error, surface: 'chat', reportErrors: false }),
    );
    expect(store.loadingIds()).toEqual([]);
    api.downloadAttachment.and.returnValue(of(new Blob(['retry'])));
    store.load('token', previewAttachment, {}, () => true);
    expect(store.urls()['image']).toBe('blob:first');
  });

  it('allows different files to download concurrently without leaving pending indicators', () => {
    const first = new Subject<WorkspaceAttachmentDownloadLink>();
    const second = new Subject<WorkspaceAttachmentDownloadLink>();
    api.createAttachmentDownloadLink.and.returnValues(first, second);
    const ready = jasmine.createSpy('ready');
    store.downloadReady.subscribe(ready);
    store.download('token', previewAttachment, 'message');
    store.download('token', previewAttachment, 'message');
    store.download('token', { ...previewAttachment, id: 'other' }, 'chat');
    expect(api.createAttachmentDownloadLink).toHaveBeenCalledTimes(2);
    expect(store.downloadingIds()).toEqual(['image', 'other']);
    first.next({ url: '/download/first', expires_at: 'later' });
    first.complete();
    expect(ready).toHaveBeenCalledWith({ url: '/download/first', filename: 'photo.png' });
    second.error(new Error('offline'));
    expect(store.downloadingIds()).toEqual([]);
  });

  it('cleans up cached URLs and all requests when its owner is destroyed', () => {
    api.downloadAttachment.and.returnValue(of(new Blob(['cached'])));
    store.load('token', previewAttachment, {}, () => true);
    api.downloadAttachment.and.returnValue(request);
    store.load('token', { ...previewAttachment, id: 'pending' }, {}, () => true);
    const download = new Subject<WorkspaceAttachmentDownloadLink>();
    api.createAttachmentDownloadLink.and.returnValue(download);
    store.download('token', previewAttachment, 'chat');
    TestBed.resetTestingModule();
    expect(request.observed).toBeFalse();
    expect(download.observed).toBeFalse();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnceWith('blob:first');
    expect(store.loadingIds()).toEqual([]);
    expect(store.downloadingIds()).toEqual([]);
  });
});
