import {invalidateReads} from './coalesce-reads.interceptor';
import {DestroyRef, Injectable, inject} from '@angular/core';
import {Subject, auditTime} from 'rxjs';
import {AppEventsService} from './app-events.service';

/** One fallback clock per app; call/control heartbeats are deliberately independent. */
@Injectable({providedIn: 'root'})
export class ResourceRefreshService {
  private readonly changes = new Subject<void>();
  readonly changes$ = this.changes.pipe(auditTime(200));
  constructor() {
    const events = inject(AppEventsService).events$.subscribe(event => {
      if (['ready', 'resync_required', 'resources_changed', 'friend_requests_changed',
        'members_updated', 'servers_changed'].includes(event.type)) {invalidateReads(); this.changes.next();}
    });
    const refresh = () => {if (!document.hidden) this.changes.next();};
    const timer = setInterval(refresh, 120000);
    document.addEventListener('visibilitychange', refresh);
    inject(DestroyRef).onDestroy(() => {
      events.unsubscribe(); clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    });
  }
}
