import {HttpEvent, HttpInterceptorFn} from '@angular/common/http';
import {Observable, finalize, shareReplay} from 'rxjs';

const pending = new Map<string, Observable<HttpEvent<unknown>>>();
let generation = 0;
export function invalidateReads() {generation++;}
export const coalesceReads: HttpInterceptorFn = (request, next) => {
  if (request.method !== 'GET') {generation++; return next(request);}
  if (!/\/api\/(inventory|wallet|wallpapers|friends\/users)(\/|\?|$)/.test(request.urlWithParams)) return next(request);
  const key = JSON.stringify([generation, request.urlWithParams, request.headers.get('Authorization')]);
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= 128) return next(request);
  const response = next(request).pipe(
    finalize(() => pending.delete(key)),
    shareReplay({bufferSize: 1, refCount: true}),
  );
  pending.set(key, response);
  return response;
};
