import {TestBed} from '@angular/core/testing';
import {HttpClient, provideHttpClient, withInterceptors} from '@angular/common/http';
import {provideHttpClientTesting, HttpTestingController} from '@angular/common/http/testing';
import {coalesceReads} from './coalesce-reads.interceptor';

describe('coalesced reads', () => {
  beforeEach(() => TestBed.configureTestingModule({providers:[
    provideHttpClient(withInterceptors([coalesceReads])), provideHttpClientTesting(),
  ]}));
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('shares in-flight requests, but never caches completed responses or crosses accounts', () => {
    const http=TestBed.inject(HttpClient), backend=TestBed.inject(HttpTestingController);
    const headers={Authorization:'Bearer first'};
    let results=0;
    http.get('/api/wallet',{headers}).subscribe(()=>results++);
    http.get('/api/wallet',{headers}).subscribe(()=>results++);
    backend.expectOne('/api/wallet').flush({coins:5});
    expect(results).toBe(2);
    http.get('/api/wallet',{headers}).subscribe();
    http.get('/api/wallet',{headers:{Authorization:'Bearer second'}}).subscribe();
    const requests=backend.match('/api/wallet'); expect(requests.length).toBe(2);
    requests.forEach(r=>r.flush({}));
  });
  it('does not reuse a pre-mutation response for a refresh', () => {
    const http=TestBed.inject(HttpClient), backend=TestBed.inject(HttpTestingController);
    http.get('/api/inventory').subscribe();
    http.post('/api/inventory/equip',{}).subscribe();
    backend.expectOne('/api/inventory/equip').flush({});
    http.get('/api/inventory').subscribe();
    const requests=backend.match('/api/inventory');expect(requests.length).toBe(2);
    requests.forEach(r=>r.flush({}));
  });
});
