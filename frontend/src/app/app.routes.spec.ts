import {TestBed} from '@angular/core/testing';
import {provideRouter, Router} from '@angular/router';
import {routes} from './app.routes';

describe('Workspace entry routes', () => {
  it('accepts a direct invitation URL without redirecting or dropping its token', async () => {
    TestBed.configureTestingModule({providers: [provideRouter(routes)]});
    const router = TestBed.inject(Router);
    expect(await router.navigateByUrl('/invite/test_invite-code')).toBeTrue();
    expect(router.url).toBe('/invite/test_invite-code');
  });
});
