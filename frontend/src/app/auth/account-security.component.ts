import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, finalize } from 'rxjs';
import { API_BASE_URL } from '../core/api/api-base';
import { AccountSecurity, TotpSetup } from '../core/models/auth.models';

@Component({
  selector: 'app-account-security',
  imports: [FormsModule],
  templateUrl: './account-security.component.html',
  styleUrl: './account-security.component.scss',
})
export class AccountSecurityComponent implements OnInit {
  readonly token = input.required<string>();
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  readonly status = signal<AccountSecurity | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly setup = signal<TotpSetup | null>(null);
  readonly codes = signal<string[]>([]);
  readonly action = signal<'enable' | 'disable' | 'renew' | null>(null);
  password = '';
  code = '';

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.run(
      this.http.get<AccountSecurity>(`${API_BASE_URL}/api/auth/security`, this.options()),
      (value) => this.status.set(value),
    );
  }

  choose(action: 'enable' | 'disable' | 'renew'): void {
    this.clear();
    this.action.set(action);
  }

  clear(): void {
    this.action.set(null);
    this.setup.set(null);
    this.codes.set([]);
    this.password = '';
    this.code = '';
    this.error.set('');
    this.notice.set('');
    this.focusFirst();
  }

  submit(): void {
    const action = this.action();
    if (action === 'enable') {
      this.run(
        this.http.post<TotpSetup>(
          `${API_BASE_URL}/api/auth/totp/setup`,
          { password: this.password },
          this.options(),
        ),
        (value) => {
          this.password = '';
          this.setup.set(value);
          this.focusFirst();
        },
      );
      return;
    }
    if (!action) return;
    const path = action === 'renew' ? 'recovery-codes' : 'disable';
    this.run(
      this.http.post<{ recovery_codes: string[] } | null>(
        `${API_BASE_URL}/api/auth/totp/${path}`,
        { password: this.password, code: this.code.trim() },
        this.options(),
      ),
      (value) => {
        this.clear();
        if (value) this.codes.set(value.recovery_codes);
        const status = this.status();
        if (status)
          this.status.set({
            ...status,
            two_factor_enabled: action === 'renew',
            recovery_codes_remaining: value?.recovery_codes.length ?? 0,
          });
        this.notice.set(
          action === 'renew'
            ? 'Резервные коды заменены. Другие сессии завершены.'
            : '2FA отключена. Другие сессии завершены.',
        );
      },
    );
  }

  confirm(): void {
    const setup = this.setup();
    if (!setup) return;
    this.run(
      this.http.post<{ recovery_codes: string[] }>(
        `${API_BASE_URL}/api/auth/totp/confirm`,
        { challenge_token: setup.challenge_token, code: this.code.trim() },
        this.options(),
      ),
      (value) => {
        this.clear();
        this.codes.set(value.recovery_codes);
        const status = this.status();
        if (status)
          this.status.set({
            ...status,
            two_factor_enabled: true,
            recovery_codes_remaining: value.recovery_codes.length,
          });
        this.notice.set('2FA включена. Другие сессии завершены.');
      },
    );
  }

  downloadCodes(): void {
    const url = URL.createObjectURL(
      new Blob(
        [
          'Квачат — резервные коды 2FA\nКаждый код используется один раз. Храните отдельно от пароля.\n\n' +
            this.codes().join('\n'),
        ],
        { type: 'text/plain;charset=utf-8' },
      ),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'kvachat-recovery-codes.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private options(): { headers: { Authorization: string } } {
    return { headers: { Authorization: `Bearer ${this.token()}` } };
  }

  private focusFirst(): void {
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>('input:not([readonly]), button:not([disabled])')
          ?.focus(),
      { injector: this.injector },
    );
  }

  private run<T>(request: Observable<T>, success: (value: T) => void): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    request
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: success,
        error: (error: unknown) =>
          this.error.set(
            error instanceof HttpErrorResponse && typeof error.error?.detail === 'string'
              ? error.error.detail
              : 'Не удалось выполнить запрос. Попробуйте ещё раз.',
          ),
      });
  }
}
