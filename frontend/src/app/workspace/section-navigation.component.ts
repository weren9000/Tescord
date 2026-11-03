import { Component, inject, input, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { API_BASE_URL } from '../core/api/api-base';

export type WorkspaceSection = 'chats' | 'groups' | 'platforms';

@Component({
  selector: 'app-section-navigation',
  standalone: true,
  styleUrl: './section-navigation.scss',
  template: ` <nav aria-label="Основные разделы">
    <div class="brand">
      <img src="/assets/cosmic/frog-moonlight-128.webp" alt="" width="36" height="36" /><span
        class="brand-name"
        >Квачат</span
      >
      <small class="release-version" [title]="releaseTitle()" aria-label="Версия релиза">{{
        releaseLabel()
      }}</small>
    </div>
    <div class="sections">
      <button type="button" (click)="openRoom()">
        <img
          class="section-art"
          src="/assets/enamel-navigation/room-128.webp"
          width="36"
          height="36"
          alt=""
        /><span>Моя комната</span>
      </button>
      @for (section of sections; track section.id) {
        <button
          type="button"
          [attr.title]="section.label"
          [class.active]="!adminSelected() && selected() === section.id"
          [attr.aria-current]="!adminSelected() && selected() === section.id ? 'page' : null"
          (click)="selectSection.emit(section.id)"
        >
          <img
            class="section-art"
            [src]="'/assets/enamel-navigation/' + section.icon + '-128.webp'"
            width="36"
            height="36"
            alt=""
          /><span>{{ section.label }}</span>
        </button>
      }
      <button type="button" (click)="shop.emit()">
        <img
          class="section-art"
          src="/assets/enamel-navigation/inventory-128.webp"
          width="36"
          height="36"
          alt=""
        /><span
          >Предметы
          @if (inventoryUnread()) {
            · {{ inventoryUnread() }}
          }
        </span>
      </button>
      <button type="button" (click)="applications.emit()" title="Приложения">
        <img
          class="section-art"
          src="/assets/enamel-navigation/applications-128.webp"
          width="36"
          height="36"
          alt=""
        /><span>Приложения</span>
      </button>
      @if (isSystemAdmin() || isAvatarAdmin()) {
        <button
          type="button"
          [class.active]="adminSelected()"
          [attr.aria-current]="adminSelected() ? 'page' : null"
          (click)="admin.emit()"
        >
          <img
            class="section-art"
            src="/assets/enamel-navigation/security-128.webp"
            width="36"
            height="36"
            alt=""
          /><span>Админка</span>
        </button>
      }
    </div>
    <div class="utilities">
      <button
        type="button"
        title="Быстрый переход (Ctrl+K)"
        aria-label="Быстрый переход"
        (click)="search.emit()"
      >
        <img
          class="section-art"
          src="/assets/enamel-navigation/search-128.webp"
          width="36"
          height="36"
          alt=""
        /><span>Поиск</span>
      </button>
      <button
        class="notification"
        type="button"
        aria-label="Уведомления"
        (click)="notifications.emit()"
      >
        <img
          class="section-art"
          src="/assets/enamel-navigation/bell-128.webp"
          width="36"
          height="36"
          alt=""
        />
        @if (hasNotifications()) {
          <i></i>
        }
        <span>События</span>
      </button>
      <button
        class="profile"
        type="button"
        aria-label="Меню приложения"
        aria-haspopup="dialog"
        [attr.aria-expanded]="menuOpen()"
        title="Меню приложения"
        (click)="profile.emit()"
      >
        @if (avatarUrl()) {
          <img class="profile-avatar" [src]="avatarUrl()" alt="" width="44" height="44" />
        } @else {
          <b>{{ initials() }}</b>
        }
        <span>Профиль</span>
      </button>
    </div>
  </nav>`,
  styles: [
    `
      :host {
        display: block;
        min-height: 0;
        min-width: 0;
        margin: 6px 8px 6px 6px;
        color: var(--palette-muted);
      }
      nav {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 18px 4px 12px;
        box-sizing: border-box;
        gap: 30px;
      }
      .brand {
        position: relative;
        text-align: center;
        font: bold 18px system-ui;
        color: var(--palette-text);
        letter-spacing: -1px;
      }
      .brand img {
        display: block;
        width: 36px;
        height: 36px;
        margin: 0 auto 4px;
        object-fit: contain;
      }
      .brand .brand-name {
        font-size: 14px;
        font-weight: 750;
        letter-spacing: 0;
      }
      .section-art {
        display: block;
        object-fit: contain;
        flex-shrink: 0;
      }
      .release-version {
        display: block;
        margin-top: 5px;
        color: var(--palette-muted);
        font: 500 10px/1.3 var(--ui-font);
        letter-spacing: 0.2px;
        white-space: nowrap;
      }
      .brand span {
        font-weight: 400;
        color: var(--palette-muted);
      }
      .brand i {
        display: inline-block;
        width: 5px;
        height: 5px;
        margin-left: 2px;
        background: var(--palette-cyan);
        border-radius: 50%;
      }
      .sections,
      .utilities {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .utilities {
        margin-top: auto;
        gap: 4px;
      }
      button {
        position: relative;
        width: 100%;
        min-height: 66px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border: 1px solid transparent;
        border-radius: var(--ui-radius-button, 12px);
        background: transparent;
        color: inherit;
        font: 500 11px system-ui;
        cursor: pointer;
      }
      button:hover {
        background: color-mix(in srgb, var(--palette-text) 2.35%, transparent);
        color: var(--palette-text);
      }
      button.active {
        background: color-mix(in srgb, var(--palette-cyan) 7.06%, transparent);
        border-color: color-mix(in srgb, var(--palette-cyan) 14.9%, transparent);
        color: var(--palette-cyan);
      }
      button.active:before {
        content: '';
        position: absolute;
        left: 0;
        top: 20px;
        width: 3px;
        height: 26px;
        border-radius: 3px;
        background: var(--palette-cyan);
      }
      button:focus-visible {
        outline: 2px solid var(--palette-cyan);
        outline-offset: 2px;
      }
      .utilities button {
        min-height: 58px;
        font-size: 10px;
      }
      .profile b {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        border-radius: 22%;
        background: var(--palette-raised);
        color: var(--palette-cyan);
        font-size: 15px;
      }
      .notification i {
        position: absolute;
        top: 8px;
        right: 20px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--palette-cyan);
      }
      button.active {
        background: var(--palette-selected);
        border-color: transparent;
        color: var(--palette-primary-text);
      }
      button.active:before {
        background: var(--palette-primary);
      }
      .profile b {
        color: var(--palette-secondary);
        background: var(--palette-hover);
      }
      .profile-avatar {
        width: 44px;
        height: 44px;
        object-fit: cover;
        border-radius: 22%;
      }
      .brand img {
        display: block;
        width: 70px;
        height: 35px;
        object-fit: contain;
        mix-blend-mode: lighten;
      }
      nav {
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
        scrollbar-color: #b786d866 transparent;
      }
      .brand,
      .sections,
      .utilities {
        flex-shrink: 0;
      }
      @media (max-height: 850px) {
        nav {
          gap: 14px;
          padding: 10px 4px;
        }
        .sections {
          gap: 4px;
        }
        .sections button {
          min-height: 54px;
          gap: 5px;
        }
        .utilities button {
          min-height: 46px;
          gap: 4px;
        }
      }
      .utilities .profile {
        min-height: 68px;
        gap: 6px;
        flex-shrink: 0;
      }
      @media (max-width: 980px) {
        :host {
          display: none;
        }
      }
      @media (forced-colors: active) {
        :host {
          background: Canvas;
          border-color: CanvasText;
          box-shadow: none;
        }
      }
    `,
  ],
})
export class SectionNavigationComponent {
  readonly releaseLabel = signal('…');
  readonly releaseTitle = signal('Версия серверного релиза');
  constructor() {
    inject(HttpClient)
      .get<{ revision: string | null }>(API_BASE_URL + '/api/release')
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: ({ revision }) => {
          const valid = typeof revision === 'string' && /^[0-9a-f]{40}$/.test(revision);
          this.releaseLabel.set(valid ? 'r' + revision.slice(0, 7) : 'Локально');
          this.releaseTitle.set(valid ? 'Релиз ' + revision : 'Локальная сборка');
        },
        error: () => {
          this.releaseLabel.set('—');
          this.releaseTitle.set('Версия релиза недоступна');
        },
      });
  }
  readonly applications = output<void>();
  openRoom() {
    window.location.assign('/my-room');
  }
  readonly selected = input<WorkspaceSection>('chats');
  readonly isSystemAdmin = input(false);
  readonly adminSelected = input(false);
  readonly admin = output<void>();
  readonly isAvatarAdmin = input(false);
  readonly shop = output<void>();
  readonly inventoryUnread = input(0);
  readonly inventory = output<'inventory' | 'admin'>();
  readonly initials = input('Я');
  readonly menuOpen = input(false);
  readonly avatarUrl = input<string | null>(null);
  readonly hasNotifications = input(false);
  readonly selectSection = output<WorkspaceSection>();
  readonly search = output<void>();
  readonly profile = output<void>();
  readonly notifications = output<void>();
  readonly sections = [
    { id: 'chats' as const, label: 'Друзья', icon: 'friends' },
    { id: 'groups' as const, label: 'Группы', icon: 'groups' },
    { id: 'platforms' as const, label: 'Площадки', icon: 'platforms' },
  ];
}
