import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, finalize, take } from 'rxjs';
import { AuthApiService } from '../api/auth-api.service';
import { AuthSessionResponse } from '../models/auth.models';

/** Owns form validation and in-flight authentication, independently of the chat UI. */
@Injectable()
export class AuthFormStore {
  private readonly api = inject(AuthApiService);
  private readonly destroyRef = inject(DestroyRef);
  readonly mode = signal<'login' | 'register'>('login');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly authenticated = new Subject<AuthSessionResponse>();
  readonly loginForm = { email: '', password: '' };
  readonly registerForm = { email: '', password: '', password_confirmation: '', nick: '' };

  switchMode(mode: 'login' | 'register'): void {
    this.mode.set(mode);
    this.error.set(null);
  }

  submitLogin(): void {
    const payload = { email: this.loginForm.email.trim(), password: this.loginForm.password };
    if (!payload.email || !payload.password) {
      this.error.set('Введите email и пароль');
      return;
    }
    this.submit(() => this.api.login(payload), 'Не удалось выполнить вход');
  }

  submitRegistration(): void {
    const payload = { ...this.registerForm, email: this.registerForm.email.trim(), nick: this.registerForm.nick.trim() };
    if (!payload.email || !payload.nick || !payload.password || !payload.password_confirmation) {
      this.error.set('Заполните email, ник и оба поля пароля');
      return;
    }
    if (payload.password !== payload.password_confirmation) {
      this.error.set('Пароли не совпадают');
      return;
    }
    this.submit(() => this.api.register(payload), 'Не удалось зарегистрироваться');
  }

  private submit(request: () => ReturnType<AuthApiService['login']>, fallback: string): void {
    if (this.loading()) { return; }
    this.loading.set(true);
    this.error.set(null);
    request().pipe(take(1), takeUntilDestroyed(this.destroyRef), finalize(() => this.loading.set(false))).subscribe({
      next: session => {
        this.loginForm.password = '';
        this.registerForm.password = '';
        this.registerForm.password_confirmation = '';
        this.authenticated.next(session);
      },
      error: error => this.error.set(error instanceof HttpErrorResponse && typeof error.error?.detail === 'string' ? error.error.detail : fallback),
    });
  }
}
