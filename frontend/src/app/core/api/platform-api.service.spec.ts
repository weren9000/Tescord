import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {PlatformApiService, PlatformSummary} from './platform-api.service';

describe('Platform account isolation', () => {
  let api: PlatformApiService;
  let http: HttpTestingController;
  const platform: PlatformSummary = {id:'private',name:'Private',description:null,owner_id:'owner',member_role:'owner',notifications_enabled:true};
  beforeEach(() => {
    TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting()]});
    api=TestBed.inject(PlatformApiService);
    http=TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('does not restore a signed-out account after a delayed response', async () => {
    const pending=api.refresh('old-account');
    const request=http.expectOne(r=>r.url.endsWith('/api/platforms'));
    api.clear();
    request.flush([platform]);
    await pending;
    expect(api.platforms()).toEqual([]);
  });

  it('does not overwrite the next account with an older response', async () => {
    const old=api.refresh('old-account');
    const oldRequest=http.expectOne(r=>r.headers.get('Authorization')==='Bearer old-account');
    const current=api.refresh('new-account');
    const currentRequest=http.expectOne(r=>r.headers.get('Authorization')==='Bearer new-account');
    currentRequest.flush([]);
    await current;
    oldRequest.flush([platform]);
    await old;
    expect(api.platforms()).toEqual([]);
  });
});
