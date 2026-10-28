import { API_BASE_URL } from '../core/api/api-base';
import { CIRCULAR_FRAME_IDS } from './circular-frames';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { AssetPreviewComponent } from './asset-preview.component';
import { RarityBadgeComponent } from './rarity-badge.component';
import type { Offer } from './shop.component';

@Component({
  selector: 'app-store-product-card',
  standalone: true,
  imports: [AssetPreviewComponent, DecimalPipe, RarityBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <div class="product">
    <button
      class="card"
      [disabled]="disabled()"
      (click)="open.emit($event)"
      [attr.aria-label]="item().name + ', ' + (item().price ?? 'Цена не задана')"
    >
      <div class="art">
        <app-asset-preview
          [avatar]="item().kind === 'frame' ? rawAvatar() : null"
          [circular]="circularFrames.has(item().id)"
          [src]="src()"
          [retry]="retry()"
          (error)="failed.emit()"
        />
        @if (item().rarity) {
          <app-rarity-badge class="badge" [value]="item().rarity" />
        }
      </div>
      <strong [title]="item().name">{{ item().name }}</strong>
      @if (showKind()) {
        <small class="kind">{{ kindLabel() }}</small>
      }
      <div class="foot">
        @if (item().price) {
          <span class="price"
            ><img src="/assets/crystal.svg" alt="Кристаллы" />{{ item().price | number }}</span
          >
        } @else {
          <small>Цена не задана</small>
        }
        @if (item().owned) {
          <small>У вас: {{ item().owned }}</small>
        }
      </div>
      @if (managed()) {
        <small
          >{{
            item().status === 'published'
              ? 'В продаже'
              : item().status === 'withdrawn'
                ? 'Снято с продажи'
                : 'Черновик'
          }}
          · Покупок: {{ item().sales ?? 0 }}</small
        >
      }
    </button>
    @if (!managed()) {
      <button
        class="favorite"
        [class.saved]="item().favorite"
        [attr.aria-pressed]="!!item().favorite"
        [attr.aria-label]="
          (item().favorite ? 'Убрать из избранного: ' : 'В избранное: ') + item().name
        "
        [disabled]="disabled() || favoriteBusy()"
        (click)="favorite.emit()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"
          />
        </svg>
      </button>
    }
  </div>`,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
        height: 100%;
      }
      .card {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: 100%;
        height: 100%;
        padding: 7px;
        border: 1px solid var(--palette-border);
        border-radius: 12px;
        color: var(--palette-text);
        background: var(--palette-surface);
        text-align: left;
        font: inherit;
        cursor: pointer;
      }
      .card:hover {
        border-color: var(--palette-primary);
        background: var(--palette-raised);
      }
      .card:focus-visible {
        outline: 2px solid var(--palette-primary);
        outline-offset: 2px;
      }
      .card:disabled {
        opacity: 0.55;
        cursor: wait;
      }
      .art {
        position: relative;
        width: 100%;
        aspect-ratio: 1;
        overflow: hidden;
        border-radius: 9px;
        background: var(--palette-raised);
      }
      app-asset-preview {
        display: block;
        width: 100%;
        height: 100%;
      }
      strong {
        font-size: 12px;
        line-height: 1.3;
        overflow-wrap: anywhere;
      }
      small {
        font-size: 11px;
        color: var(--palette-muted);
        line-height: 1.4;
      }
      .badge {
        position: absolute;
        bottom: 5px;
        left: 5px;
        max-width: calc(100% - 10px);
        box-sizing: border-box;
        font-size: 10px;
      }
      .frame-portrait {
        position: absolute;
        height: 83%;
        width: auto;
        aspect-ratio: 1;
        object-fit: cover;
        border-radius: 22%;
        top: 8.5%;
        left: 50%;
        transform: translateX(-50%);
      }
      .frame-portrait.circular {
        height: 76%;
        top: 12%;
        border-radius: 50%;
      }
      app-asset-preview {
        position: relative;
      }
      .foot {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 4px;
        margin-top: auto;
      }
      .price {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        font-weight: 600;
      }
      .price img {
        width: 16px;
        height: 16px;
      }
      .art {
        height: 92px;
        aspect-ratio: auto;
      }
      strong {
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .product {
        position: relative;
        height: 100%;
      }
      .favorite {
        position: absolute;
        right: 9px;
        top: 9px;
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        padding: 4px;
        border: 0;
        border-radius: 8px;
        background: color-mix(in srgb, var(--palette-surface) 85%, transparent);
        color: var(--palette-text);
        cursor: pointer;
      }
      .favorite svg {
        width: 18px;
        height: 18px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.7;
      }
      .favorite.saved {
        color: var(--palette-primary-text);
        background: var(--palette-selected);
      }
      .favorite.saved svg {
        fill: currentColor;
      }
      .favorite:focus-visible {
        outline: 2px solid var(--palette-primary);
      }
      .favorite:disabled {
        opacity: 0.5;
      }
      .kind {
        font-size: 10px;
      }
      .art {
        border: 1px solid var(--palette-border);
        box-sizing: border-box;
      }
      @media (max-width: 980px) {
        .art {
          height: 112px;
        }
        .favorite {
          width: 36px;
          height: 36px;
        }
        .card {
          padding: 7px;
        }
        strong {
          font-size: 12px;
        }
      }
    `,
  ],
})
export class StoreProductCardComponent {
  readonly circularFrames = CIRCULAR_FRAME_IDS;
  readonly avatarUrl = input<string | null>(null);
  rawAvatar() {
    const url = this.avatarUrl();
    return url
      ? url + (url.includes('?') ? '&' : '?') + 'include_frame=false'
      : API_BASE_URL + '/api/avatar-presets/cat';
  }
  readonly item = input.required<Offer>();
  readonly src = input.required<string>();
  readonly kindLabel = input('');
  readonly retry = input(0);
  readonly disabled = input(false);
  readonly managed = input(false);
  readonly showKind = input(false);
  readonly favoriteBusy = input(false);
  readonly favorite = output<void>();
  rarityLabel(value?: string | null) {
    return (
      (
        {
          common: 'Обычный',
          uncommon: 'Необычный',
          rare: 'Редкий',
          epic: 'Эпический',
          legendary: 'Легендарный',
        } as Record<string, string>
      )[value ?? ''] ?? ''
    );
  }
  readonly open = output<Event>();
  readonly failed = output<void>();
}
