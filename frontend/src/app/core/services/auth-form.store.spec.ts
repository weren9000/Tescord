import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { AuthFormStore } from './auth-form.store';
import { AuthApiService } from '../api/auth-api.service';
import { AuthSessionResponse } from '../models/auth.models';

describe('AuthFormStore', () => {
  it('does not authenticate a password-only MFA challenge', () => {
    const api = {
      login: () =>
        of({ status: 'two_factor_required', challenge_token: 'challenge', expires_in: 300 }),
      verifyLogin: jasmine
        .createSpy('verifyLogin')
        .and.returnValue(of({ access_token: 'session' })),
    };
    TestBed.configureTestingModule({
      providers: [AuthFormStore, { provide: AuthApiService, useValue: api }],
    });
    const store = TestBed.inject(AuthFormStore);
    const authenticated = jasmine.createSpy('authenticated');
    store.authenticated.subscribe(authenticated);
    store.loginForm.email = 'user@example.test';
    store.loginForm.password = 'password';
    store.submitLogin();
    expect(authenticated).not.toHaveBeenCalled();
    expect(store.loginForm.password).toBe('');
    store.code = '123456';
    store.verifyLogin();
    expect(api.verifyLogin).toHaveBeenCalledWith('challenge', '123456');
    expect(authenticated).toHaveBeenCalledTimes(1);
    expect(store.loginChallenge()).toBeNull();
    expect(store.code).toBe('');
  });

  it('registers only with the email verified by the server', () => {
    const api = {
      startEmail: () => of({ challenge_token: 'email-token', expires_in: 600, resend_after: 60 }),
      verifyEmail: () => of({ registration_token: 'grant', email: 'owner@example.test' }),
      register: jasmine.createSpy('register').and.returnValue(of({ access_token: 'session' })),
    };
    TestBed.configureTestingModule({
      providers: [AuthFormStore, { provide: AuthApiService, useValue: api }],
    });
    const store = TestBed.inject(AuthFormStore);
    store.switchMode('register');
    store.registerForm.email = 'owner@example.test';
    store.startEmail();
    expect(store.registrationStep()).toBe('code');
    store.code = '123456';
    store.verifyEmail();
    expect(store.registrationStep()).toBe('profile');
    Object.assign(store.registerForm, {
      email: 'changed@example.test',
      nick: 'player',
      password: 'password1',
      password_confirmation: 'password1',
    });
    store.submitRegistration();
    expect(api.register.calls.mostRecent().args[0].email).toBe('owner@example.test');
    expect(api.register.calls.mostRecent().args[0].registration_token).toBe('grant');
    expect(store.registerForm.password).toBe('');
  });
  it('prevents duplicate requests and clears passwords on success', () => {
    const response = new Subject<AuthSessionResponse>();
    const login = jasmine.createSpy('login').and.returnValue(response);
    TestBed.configureTestingModule({
      providers: [AuthFormStore, { provide: AuthApiService, useValue: { login } }],
    });
    const store = TestBed.inject(AuthFormStore);
    store.loginForm.email = ' user@example.test ';
    store.loginForm.password = 'test-password';
    store.submitLogin();
    store.submitLogin();
    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith({ email: 'user@example.test', password: 'test-password' });
    response.next({ access_token: 'test' } as AuthSessionResponse);
    expect(store.loading()).toBeFalse();
    expect(store.loginForm.password).toBe('');
  });
  it('rejects mismatched registration passwords without an API call', () => {
    const register = jasmine.createSpy('register');
    TestBed.configureTestingModule({
      providers: [AuthFormStore, { provide: AuthApiService, useValue: { register } }],
    });
    const store = TestBed.inject(AuthFormStore);
    Object.assign(store.registerForm, {
      email: 'a@example.test',
      nick: 'player',
      password: 'password-one',
      password_confirmation: 'password-two',
    });
    store.submitRegistration();
    expect(register).not.toHaveBeenCalled();
    expect(store.error()).toBeTruthy();
    expect(store.loading()).toBeFalse();
  });
});
