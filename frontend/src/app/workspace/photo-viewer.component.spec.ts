import {TestBed, ComponentFixture} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {provideHttpClientTesting,HttpTestingController} from '@angular/common/http/testing';
import {PhotoViewerComponent} from './photo-viewer.component';
import {WorkspaceMessageAttachment} from '../core/models/workspace.models';

describe('photo original viewer',()=>{
  let fixture:ComponentFixture<PhotoViewerComponent>,http:HttpTestingController;
  const photo=(id:string):WorkspaceMessageAttachment=>({id,filename:id+'.png',mime_type:'image/png',size_bytes:1000,created_at:'2026-10-22',deleted_at:null});
  beforeEach(()=>{TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting()]});http=TestBed.inject(HttpTestingController);fixture=TestBed.createComponent(PhotoViewerComponent);fixture.componentRef.setInput('photos',[photo('one'),photo('two')]);fixture.componentRef.setInput('selectedId','one');fixture.componentRef.setInput('token','test-token');fixture.detectChanges();});
  afterEach(()=>{fixture.destroy();http.verify({ignoreCancelled:true});});
  it('loads only the selected original; zoom and refreshed message metadata do not reload it',()=>{
    const first=http.expectOne(r=>r.url.endsWith('/attachments/one'));expect(first.request.headers.get('Authorization')).toBe('Bearer test-token');first.flush(new Blob(['test'],{type:'image/png'}));fixture.detectChanges();
    fixture.componentInstance.zoom(2);fixture.detectChanges();expect(fixture.componentInstance.scale()).toBe(2);
    fixture.componentRef.setInput('photos',[photo('one'),photo('two')]);fixture.detectChanges();
    http.expectNone(r=>/\/attachments\/(one|two)$/.test(r.url));
  });
  it('cancels an unfinished original on navigation and releases it on close',()=>{
    const first=http.expectOne(r=>r.url.endsWith('/attachments/one'));
    fixture.componentRef.setInput('selectedId','two');fixture.detectChanges();expect(first.cancelled).toBeTrue();
    const second=http.expectOne(r=>r.url.endsWith('/attachments/two'));fixture.destroy();expect(second.cancelled).toBeTrue();
  });
});
