import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, finalize, take } from 'rxjs';
import { AuthApiService } from '../api/auth-api.service';
import { AuthChallenge, AuthSessionResponse } from '../models/auth.models';

/** Intermediate challenges stay in memory and never become an app session. */
@Injectable()
export class AuthFormStore {
  private readonly api = inject(AuthApiService);
  private readonly destroyRef = inject(DestroyRef);
  readonly mode = signal<'login' | 'register'>('login');
  readonly registrationStep = signal<'email' | 'code' | 'profile'>('email');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly authenticated = new Subject<AuthSessionResponse>();
  readonly loginChallenge = signal<AuthChallenge | null>(null);
  readonly emailChallenge = signal<AuthChallenge | null>(null);
  readonly verifiedEmail = signal('');
  private registrationToken = '';
  private readonly clock = signal(Date.now());
  private readonly resendAt = signal(0);
  readonly resendSeconds = computed(() =>
    Math.max(0, Math.ceil((this.resendAt() - this.clock()) / 1000)),
  );
  readonly loginForm = { email: '', password: '' };
  readonly registerForm = { email: '', password: '', password_confirmation: '', nick: '' };
  code = '';
  recoveryMode = false;

  constructor() {
    const timer = setInterval(() => this.clock.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  switchMode(mode: 'login' | 'register'): void {
    if (this.loading()) return;
    this.mode.set(mode);
    this.registrationStep.set('email');
    this.emailChallenge.set(null);
    this.loginChallenge.set(null);
    this.verifiedEmail.set('');
    this.registrationToken = '';
    this.code = '';
    this.recoveryMode = false;
    this.clearPasswords();
    this.error.set(null);
    this.notice.set(null);
  }

  submitLogin(): void {
    const payload = { email: this.loginForm.email.trim(), password: this.loginForm.password };
    if (!payload.email || !payload.password) {
      this.error.set('Введите email и пароль');
      return;
    }
    this.request(
      () => this.api.login(payload),
      (result) => {
        this.clearPasswords();
        if ('access_token' in result) this.complete(result);
        else {
          this.loginChallenge.set(result);
          this.code = '';
        }
      },
    );
  }

  startEmail(resend = false): void {
    const email = this.registerForm.email.trim();
    if (!email) {
      this.error.set('Введите email');
      return;
    }
    this.request(
      () => this.api.startEmail(email, resend ? this.emailChallenge()?.challenge_token : undefined),
      (result) => {
        this.emailChallenge.set(result);
        this.verifiedEmail.set(email);
        this.registrationStep.set('code');
        this.resendAt.set(Date.now() + (result.resend_after ?? 60) * 1000);
        this.clock.set(Date.now());
        this.code = '';
        this.notice.set('Письмо с кодом отправлено. Проверьте также папку «Спам».');
      },
    );
  }

  verifyEmail(): void {
    const challenge = this.emailChallenge();
    if (!challenge || !this.code.trim()) return;
    this.request(
      () => this.api.verifyEmail(challenge.challenge_token, this.code.trim()),
      (result) => {
        this.registrationToken = result.registration_token;
        this.verifiedEmail.set(result.email);
        this.registrationStep.set('profile');
        this.emailChallenge.set(null);
        this.code = '';
        this.notice.set('Почта подтверждена. Завершите регистрацию.');
      },
    );
  }

  verifyLogin(): void {
    const challenge = this.loginChallenge();
    if (!challenge || !this.code.trim()) return;
    this.request(
      () => this.api.verifyLogin(challenge.challenge_token, this.code.trim()),
      (session) => this.complete(session),
    );
  }

  submitRegistration(): void {
    const payload = {
      ...this.registerForm,
      email: this.verifiedEmail(),
      nick: this.registerForm.nick.trim(),
      registration_token: this.registrationToken,
    };
    if (
      !payload.email ||
      !payload.nick ||
      !payload.password ||
      !payload.password_confirmation ||
      !payload.registration_token
    ) {
      this.error.set('Подтвердите почту и заполните ник и оба поля пароля');
      return;
    }
    if (payload.password !== payload.password_confirmation) {
      this.error.set('Пароли не совпадают');
      return;
    }
    this.request(
      () => this.api.register(payload),
      (session) => this.complete(session),
    );
  }

  private clearPasswords(): void {
    this.loginForm.password = '';
    this.registerForm.password = '';
    this.registerForm.password_confirmation = '';
  }

  private complete(session: AuthSessionResponse): void {
    this.clearPasswords();
    this.loginChallenge.set(null);
    this.emailChallenge.set(null);
    this.registrationToken = '';
    this.code = '';
    this.authenticated.next(session);
  }

  private request<T>(request: () => Observable<T>, success: (value: T) => void): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    this.notice.set(null);
    request()
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: success,
        error: (error) => {
          this.error.set(
            error instanceof HttpErrorResponse && typeof error.error?.detail === 'string'
              ? error.error.detail
              : 'Не удалось выполнить запрос. Попробуйте ещё раз.',
          );
          if (error instanceof HttpErrorResponse && error.status === 429) {
            const retry = Number(error.headers.get('Retry-After'));
            if (retry > 0) this.resendAt.set(Date.now() + retry * 1000);
          }
        },
      });
  }
}
