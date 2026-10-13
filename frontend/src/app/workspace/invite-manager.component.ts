import { AfterViewInit, Component, DestroyRef, ElementRef, ViewChild, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { InviteSummary, InvitesApiService } from '../core/api/invites-api.service';

@Component({
  selector: 'app-invite-manager', imports: [CommonModule, FormsModule],
  template: `
    <dialog #dialog aria-labelledby="invite-title" (cancel)="$event.preventDefault(); dismiss()" (keydown.escape)="$event.stopPropagation()">
      <header><div><h2 id="invite-title">Пригласить по ссылке</h2><p>{{ space().name }}</p></div><button type="button" aria-label="Закрыть приглашения" (click)="dismiss()">×</button></header>
      <p class="hint">Человек с этой ссылкой вступит автоматически после входа или регистрации.</p>
      <form (ngSubmit)="create()">
        <div class="options"><label>Срок действия<select name="expiry" [(ngModel)]="days"><option [ngValue]="1">1 день</option><option [ngValue]="7">7 дней</option><option [ngValue]="30">30 дней</option><option [ngValue]="null">Бессрочно</option></select></label>
        <label>Число вступлений<select name="uses" [(ngModel)]="limit"><option [ngValue]="null">Без ограничения</option><option [ngValue]="1">Одноразовая</option><option [ngValue]="5">5 человек</option><option [ngValue]="10">10 человек</option><option [ngValue]="100">100 человек</option></select></label></div>
        <button class="primary" type="submit" [disabled]="busy()">{{ busy() ? 'Подождите…' : 'Создать ссылку' }}</button>
      </form>
      @if (link()) {
        <div class="link"><label>Ссылка приглашения<input #linkInput readonly [value]="link()" (click)="linkInput.select()" /></label><button type="button" (click)="copy()">{{ copied() ? 'Скопировано' : 'Копировать' }}</button></div>
        <p class="hint">Сохраните ссылку сейчас: после закрытия окна её текст не отображается повторно.</p>
      }
      @if (error()) {<p class="error" role="alert">{{ error() }}</p>}
      <h3>Приглашения</h3>
      @if (loading()) {<p class="hint" role="status">Загрузка…</p>}
      <div class="list">
        @for (invite of invites(); track invite.id) {
          <article><div><strong>{{ stateLabel(invite.state) }} · {{ invite.uses }}{{ invite.max_uses ? ' / ' + invite.max_uses : '' }} вступлений</strong>
          <small>{{ invite.created_by }} · {{ invite.created_at | date:'dd.MM.yyyy HH:mm' }}</small>
          <small>{{ invite.expires_at ? 'До ' + (invite.expires_at | date:'dd.MM.yyyy HH:mm') : 'Без срока действия' }}</small></div>
          @if (invite.state === 'active') {<button type="button" [disabled]="busy()" (click)="revoke(invite.id)">Отключить</button>}</article>
        } @empty { @if (!loading()) {<p class="hint">Ссылок пока нет.</p>} }
      </div>
    </dialog>
  `,
  styleUrl: './invite-manager.component.scss',
})
export class InviteManagerComponent implements AfterViewInit {
  readonly space = input.required<{id: string; name: string}>();
  readonly token = input.required<string>();
  readonly close = output<void>();
  private readonly api = inject(InvitesApiService);
  private readonly destroyRef = inject(DestroyRef);
  @ViewChild('dialog') private dialog!: ElementRef<HTMLDialogElement>;
  @ViewChild('linkInput') private linkInput?: ElementRef<HTMLInputElement>;
  readonly invites = signal<InviteSummary[]>([]);
  readonly link = signal('');
  readonly copied = signal(false);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly loading = signal(true);
  private linkId = '';
  days: number | null = 7;
  limit: number | null = null;
  ngAfterViewInit(): void { this.dialog.nativeElement.showModal(); this.reload(); }
  dismiss(): void { this.dialog.nativeElement.close(); this.close.emit(); }
  private message(error: unknown): string { return error instanceof HttpErrorResponse && typeof error.error?.detail === 'string' ? error.error.detail : 'Не удалось выполнить действие. Попробуйте ещё раз.'; }
  private reload(): void {
    this.api.list(this.token(), this.space().id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({next: rows => {this.invites.set(rows); this.loading.set(false);}, error: e => {this.loading.set(false); this.error.set(this.message(e));}});
  }
  create(): void {
    if (this.busy()) return;
    this.busy.set(true); this.error.set(''); this.copied.set(false);
    this.api.create(this.token(), this.space().id, this.days, this.limit).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {this.linkId = result.id; this.link.set(new URL('/invite/' + result.token, window.location.origin).href); this.busy.set(false); this.reload();},
      error: e => {this.busy.set(false); this.error.set(this.message(e));},
    });
  }
  revoke(id: string): void {
    if (this.busy()) return;
    this.busy.set(true); this.error.set('');
    this.api.revoke(this.token(), this.space().id, id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({next: () => {if (this.linkId === id) this.link.set(''); this.busy.set(false); this.reload();}, error: e => {this.busy.set(false); this.error.set(this.message(e));}});
  }
  async copy(): Promise<void> {
    try { await navigator.clipboard.writeText(this.link()); this.copied.set(true); }
    catch { this.linkInput?.nativeElement.select(); this.error.set('Выделили ссылку — скопируйте её вручную.'); }
  }
  stateLabel(state: InviteSummary['state']): string { return {active: 'Активна', revoked: 'Отключена', expired: 'Истекла', exhausted: 'Лимит исчерпан'}[state]; }
}
