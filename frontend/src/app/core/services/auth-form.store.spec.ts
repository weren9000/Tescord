import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AuthFormStore } from './auth-form.store';
import { AuthApiService } from '../api/auth-api.service';
import { AuthSessionResponse } from '../models/auth.models';

describe('AuthFormStore', () => {
  it('prevents duplicate requests and clears passwords on success', () => {
    const response = new Subject<AuthSessionResponse>();
    const login = jasmine.createSpy('login').and.returnValue(response);
    TestBed.configureTestingModule({ providers: [AuthFormStore, { provide: AuthApiService, useValue: { login } }] });
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
    TestBed.configureTestingModule({ providers: [AuthFormStore, { provide: AuthApiService, useValue: { register } }] });
    const store = TestBed.inject(AuthFormStore);
    Object.assign(store.registerForm, { email: 'a@example.test', nick: 'player', password: 'password-one', password_confirmation: 'password-two' });
    store.submitRegistration();
    expect(register).not.toHaveBeenCalled();
    expect(store.error()).toBeTruthy();
    expect(store.loading()).toBeFalse();
  });
});
