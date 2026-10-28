import { Component, effect, inject, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { WalletService } from './wallet.service';
@Component({
  selector: 'app-wallet-balance',
  standalone: true,
  imports: [DecimalPipe],
  template: ` <button type="button" aria-label="Открыть кошелёк" (click)="open.emit()">
    <span
      ><img src="/assets/coin.svg" alt="Монеты" width="20" height="20" />{{
        wallet.balance() ? (wallet.balance()!.coins | number: '1.0-0') : '—'
      }}</span
    >
    <span
      ><img src="/assets/crystal.svg" alt="Кристаллы" width="20" height="20" />{{
        wallet.balance() ? (wallet.balance()!.crystals | number: '1.0-0') : '—'
      }}</span
    >
    @if (wallet.error()) {
      <small>Обновить</small>
    }
  </button>`,
  styles: [
    `
      :host {
        display: block;
      }
      button {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 16px;
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--palette-border);
        border-radius: 10px;
        background: var(--palette-canvas);
        color: var(--palette-text);
        font: inherit;
        cursor: pointer;
        min-height: 44px;
      }
      span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-variant-numeric: tabular-nums;
      }
      small {
        font-size: 11px;
        color: var(--palette-muted);
      }
      button:focus-visible {
        outline: 2px solid var(--palette-primary);
        outline-offset: 2px;
      }
    `,
  ],
})
export class WalletBalanceComponent {
  readonly token = input.required<string>();
  readonly open = output<void>();
  readonly wallet = inject(WalletService);
  constructor() {
    effect(() => this.wallet.connect(this.token()));
  }
}
