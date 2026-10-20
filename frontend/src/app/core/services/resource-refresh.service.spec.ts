import {TestBed, fakeAsync, tick} from '@angular/core/testing';
import {Subject} from 'rxjs';
import {AppEventsService} from './app-events.service';
import {ResourceRefreshService} from './resource-refresh.service';

describe('resource refresh', () => {
  it('coalesces changes, ignores heartbeats and pauses fallback in hidden tabs', fakeAsync(() => {
    const events = new Subject<{type:string}>();
    let hidden = false;
    spyOnProperty(document, 'hidden', 'get').and.callFake(() => hidden);
    TestBed.configureTestingModule({providers:[{provide:AppEventsService,useValue:{events$:events}}]});
    const service = TestBed.inject(ResourceRefreshService);
    let calls = 0; service.changes$.subscribe(() => calls++);
    events.next({type:'pong'}); tick(250); expect(calls).toBe(0);
    events.next({type:'resources_changed'}); events.next({type:'ready'});
    tick(250); expect(calls).toBe(1);
    hidden = true; tick(120000); expect(calls).toBe(1);
    hidden = false; document.dispatchEvent(new Event('visibilitychange'));
    tick(250); expect(calls).toBe(2);
    TestBed.resetTestingModule();
  }));
});
