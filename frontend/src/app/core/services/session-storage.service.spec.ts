import { SessionStorageService } from './session-storage.service';
import { AuthSessionResponse } from '../models/auth.models';

describe('SessionStorageService', () => {
  const session = { access_token: 'test-token', user: { id: 'test-user' } } as AuthSessionResponse;
  let originalBridge: PropertyDescriptor | undefined;
  let originalSession: string | null;
  const storage = new SessionStorageService();

  beforeEach(() => {
    originalBridge = Object.getOwnPropertyDescriptor(window, 'kvaDesktop');
    originalSession = localStorage.getItem('tescord.session');
    Object.defineProperty(window, 'kvaDesktop', { configurable: true, value: undefined });
    localStorage.removeItem('tescord.session');
  });
  afterEach(() => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      if (jasmine.isSpy(Storage.prototype[method])) {
        (Storage.prototype[method] as jasmine.Spy).and.callThrough();
      }
    }
    if (originalBridge) Object.defineProperty(window, 'kvaDesktop', originalBridge);
    else delete window.kvaDesktop;
    if (originalSession === null) localStorage.removeItem('tescord.session');
    else localStorage.setItem('tescord.session', originalSession);
  });

  it('restores and clears a browser session', () => {
    storage.write(session);
    expect(storage.read()).toEqual(session);
    storage.clear();
    expect(storage.read()).toBeNull();
  });

  it('removes corrupt and structurally invalid sessions', () => {
    for (const raw of ['{', 'null', '{"access_token":12,"user":{"id":"a"}}', '{"access_token":"a","user":{}}']) {
      localStorage.setItem('tescord.session', raw);
      expect(storage.read()).toBeNull();
      expect(localStorage.getItem('tescord.session')).toBeNull();
    }
  });

  it('uses native storage without falling back to a stale browser token', () => {
    const writeSession = jasmine.createSpy('writeSession').and.returnValue(true);
    Object.defineProperty(window, 'kvaDesktop', { configurable: true, value: {
      readSession: () => null, writeSession,
    } });
    localStorage.setItem('tescord.session', JSON.stringify(session));
    expect(storage.read()).toBeNull();
    storage.write(session);
    expect(writeSession).toHaveBeenCalledWith(JSON.stringify(session));
    expect(localStorage.getItem('tescord.session')).toBeNull();
    storage.clear();
    expect(writeSession).toHaveBeenCalledWith(null);
  });

  it('does not break login when browser storage is disabled', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('Access denied');
    spyOn(Storage.prototype, 'setItem').and.throwError('Quota exceeded');
    spyOn(Storage.prototype, 'removeItem').and.throwError('Access denied');
    expect(storage.read()).toBeNull();
    expect(() => storage.write(session)).not.toThrow();
    expect(() => storage.clear()).not.toThrow();
  });
});
