import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { InterfaceStyleService } from './workspace/interface-style.service';
import { provideRouter } from '@angular/router';

import { coalesceReads } from './core/services/coalesce-reads.interceptor';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAppInitializer(() => {
      inject(InterfaceStyleService);
    }),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([coalesceReads])),
  ],
};
