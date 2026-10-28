import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../core/api/api-base';
import { Wallet, WalletService } from './wallet.service';
import { UiIconComponent } from './ui-icon.component';
interface Person {
  id: string;
  name: string;
  public_id: number;
}
interface Pending {
  request_id: string;
  currency: 'coins' | 'crystals';
  action: 'credit' | 'debit';
  amount: number;
  reason: string;
  user_id: string;
  nick: string;
  before: number;
}
@Component({
  selector: 'app-wallet',
  standalone: true,
  imports: [CommonModule, FormsModule, UiIconComponent],
  templateUrl: './wallet.component.html',
  styleUrl: './wallet.component.scss',
})
export class WalletComponent {
  readonly target = input<Person | null>(null);
  readonly changed = output<void>();
  readonly token = input.required<string>();
  readonly admin = input(false);
  readonly actorId = input('');
  readonly close = output<void>();
  readonly wallet = signal<Wallet | null>(null);
  readonly people = signal<Person[]>([]);
  readonly selected = signal<Person | null>(null);
  readonly busy = signal(false);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly pending = signal<Pending | null>(null);
  readonly searched = signal(false);
  readonly uncertain = signal(false);
  query = '';
  currency: 'coins' | 'crystals' = 'coins';
  action: 'credit' | 'debit' = 'credit';
  amount: number | null = null;
  reason = '';
  private version = 0;
  private searchVersion = 0;
  private readonly http = inject(HttpClient);
  private readonly balances = inject(WalletService);
  constructor() {
    effect(() => {
      const token = this.token();
      const admin = this.admin();
      const target = this.target();
      this.actorId();
      untracked(() => {
        this.balances.connect(token);
        this.pending.set(null);
        this.selected.set(null);
        this.wallet.set(null);
        if (!admin) void this.load();
        else {
          if (target) this.choose(target);
          this.restore();
        }
      });
    });
  }
  private storageKey() {
    return 'kva.wallet.pending.' + this.actorId() + (this.target() ? '.' + this.target()!.id : '');
  }
  private restore() {
    try {
      const p = JSON.parse(localStorage.getItem(this.storageKey()) ?? 'null') as Pending | null;
      if (
        p?.request_id &&
        p.user_id &&
        ['coins', 'crystals'].includes(p.currency) &&
        ['credit', 'debit'].includes(p.action) &&
        Number.isSafeInteger(p.amount) &&
        Number.isSafeInteger(p.before)
      ) {
        this.selected.set({ id: p.user_id, name: p.nick, public_id: 0 });
        this.pending.set(p);
        this.uncertain.set(true);
        void this.load();
      }
    } catch {
      /* Storage is optional. */
    }
  }
  private headers() {
    return { Authorization: 'Bearer ' + this.token() };
  }
  private message(e: unknown) {
    return e instanceof HttpErrorResponse && typeof e.error?.detail === 'string'
      ? e.error.detail
      : 'Не удалось выполнить запрос. Повторите попытку.';
  }
  async search() {
    if (this.busy() || this.pending()) return;
    const version = ++this.searchVersion;
    this.error.set('');
    this.searched.set(false);
    try {
      const result = await firstValueFrom(
        this.http.get<{ items: Person[] }>(API_BASE_URL + '/api/admin/directory/users', {
          params: { q: this.query.trim(), size: 20 },
          headers: this.headers(),
        }),
      );
      if (version === this.searchVersion) {
        this.people.set(result.items);
        this.searched.set(true);
      }
    } catch (e) {
      if (version === this.searchVersion) this.error.set(this.message(e));
    }
  }
  choose(person: Person) {
    if (this.busy() || this.pending()) return;
    this.selected.set(person);
    this.wallet.set(null);
    this.success.set('');
    this.amount = null;
    this.reason = '';
    void this.load();
  }
  async load(page = 1) {
    if (this.busy()) return;
    const user = this.selected();
    if (this.admin() && !user) return;
    const version = ++this.version;
    this.loading.set(true);
    try {
      const result = await firstValueFrom(
        this.http.get<Wallet>(
          API_BASE_URL + (this.admin() ? '/api/admin/wallets/' + user!.id : '/api/wallet'),
          { params: { page }, headers: this.headers() },
        ),
      );
      if (version === this.version) this.wallet.set(result);
    } catch (e) {
      if (version === this.version) this.error.set(this.message(e));
    } finally {
      if (version === this.version) this.loading.set(false);
    }
  }
  prepare() {
    const w = this.wallet();
    if (!this.admin() || !w || this.busy() || this.loading()) return;
    this.error.set('');
    this.success.set('');
    const amount = this.amount;
    if (
      amount === null ||
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > 1000000000 ||
      !this.reason.trim()
    ) {
      this.error.set('Укажите целую сумму от 1 до 1 000 000 000 и причину.');
      return;
    }
    if (this.action === 'debit' && amount > w[this.currency]) {
      this.error.set('Недостаточно средств для списания');
      return;
    }
    this.uncertain.set(false);
    this.pending.set({
      request_id: crypto.randomUUID(),
      currency: this.currency,
      action: this.action,
      amount,
      reason: this.reason.trim(),
      user_id: w.user_id,
      nick: w.nick,
      before: w[this.currency],
    });
  }
  after(p: Pending) {
    return p.before + (p.action === 'credit' ? p.amount : -p.amount);
  }
  async confirm() {
    const p = this.pending();
    if (!p || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(p));
    } catch {
      /* Idempotency still protects retries within this screen. */
    }
    try {
      await firstValueFrom(
        this.http.post(
          API_BASE_URL + '/api/admin/wallets/' + p.user_id + '/adjust',
          {
            request_id: p.request_id,
            currency: p.currency,
            action: p.action,
            amount: p.amount,
            reason: p.reason,
            expected_balance: p.before,
          },
          { headers: this.headers() },
        ),
      );
      this.pending.set(null);
      this.amount = null;
      this.reason = '';
      this.success.set(p.action === 'credit' ? 'Начисление выполнено' : 'Списание выполнено');
      this.uncertain.set(false);
      void this.balances.refresh();
    } catch (e) {
      this.error.set(this.message(e));
      this.uncertain.set(!(e instanceof HttpErrorResponse) || e.status === 0 || e.status >= 500);
      if (!this.uncertain()) this.pending.set(null);
    } finally {
      this.busy.set(false);
      if (!this.pending()) {
        try {
          localStorage.removeItem(this.storageKey());
        } catch {}
        await this.load();
        this.changed.emit();
      }
    }
  }
}
