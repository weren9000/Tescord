import {TestBed, fakeAsync, flushMicrotasks} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {provideHttpClientTesting, HttpTestingController} from '@angular/common/http/testing';
import {UploadQueueService, UploadPayload} from './upload-queue.service';

describe('upload queue',()=>{
  let queue:UploadQueueService;let http:HttpTestingController;
  const payload=(count:number):UploadPayload=>({content:'caption',files:Array.from({length:count},(_,i)=>new File(['file-'+i],i+'.txt')),clientMessageId:crypto.randomUUID()});
  beforeEach(()=>{TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting()]});queue=TestBed.inject(UploadQueueService);http=TestBed.inject(HttpTestingController);});
  afterEach(()=>http.verify());
  it('limits concurrency to three and retries only failed files before publishing once',fakeAsync(()=>{
    const data=payload(5);let failed=false;let result=false;
    queue.send('token','channel',data).subscribe({error:()=>failed=true});
    const first=http.match(r=>r.method==='PUT');expect(first.length).toBe(3);
    first[0].flush({id:'ok'});first[1].flush({detail:'Unavailable'},{status:503,statusText:'Unavailable'});first[2].flush({id:'ok'});flushMicrotasks();
    const last=http.match(r=>r.method==='PUT');expect(last.length).toBe(2);last.forEach(r=>r.flush({id:'ok'}));flushMicrotasks();
    expect(failed).toBeTrue();expect(queue.ready()).toBe(4);http.expectNone(r=>r.method==='POST');
    queue.send('token','channel',data).subscribe(e=>{if(e.kind==='response')result=true;});
    const retry=http.expectOne(r=>r.method==='PUT');expect(retry.request.url).toBe(first[1].request.url);retry.flush({id:'ok'});flushMicrotasks();
    const post=http.expectOne(r=>r.method==='POST');expect(post.request.body.getAll('upload_ids').length).toBe(5);expect(post.request.body.get('client_message_id')).toBe(data.clientMessageId);post.flush({id:'message'});flushMicrotasks();
    expect(result).toBeTrue();expect(queue.job()?.status).toBe('done');
  }));
  it('rejects eleven before making requests',()=>{let failed=false;queue.send('token','channel',payload(11)).subscribe({error:()=>failed=true});expect(failed).toBeTrue();http.expectNone(()=>true);});
  it('cancels active requests and retains ready files for resume',fakeAsync(()=>{
    const data=payload(5);const sub=queue.send('token','channel',data).subscribe();const first=http.match(r=>r.method==='PUT');first[0].flush({id:'ok'});flushMicrotasks();const next=http.match(r=>r.method==='PUT');sub.unsubscribe();flushMicrotasks();expect(first[1].cancelled).toBeTrue();expect(next[0].cancelled).toBeTrue();expect(queue.job()?.status).toBe('paused');expect(queue.ready()).toBe(1);
  }));
  it('retries an uncertain final response with the same nonce and without uploading again',fakeAsync(()=>{
    const data=payload(1);queue.send('token','channel',data).subscribe({error:()=>{}});http.expectOne(r=>r.method==='PUT').flush({id:'ok'});flushMicrotasks();http.expectOne(r=>r.method==='POST').error(new ProgressEvent('error'));flushMicrotasks();
    queue.send('token','channel',data).subscribe();flushMicrotasks();http.expectNone(r=>r.method==='PUT');const post=http.expectOne(r=>r.method==='POST');expect(post.request.body.get('client_message_id')).toBe(data.clientMessageId);post.flush({id:'same-message'});flushMicrotasks();
  }));
});
