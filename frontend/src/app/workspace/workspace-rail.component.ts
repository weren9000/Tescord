import { Component, input, output } from '@angular/core';

export interface SpaceLink { id: string; name: string; icon: string | null; unread: number; }

@Component({
  selector: 'app-workspace-rail',
  standalone: true,
  template: `
    <nav aria-label="Основная навигация">
      <button class="home" [class.active]="homeActive()" aria-label="Сообщения" title="Сообщения" (click)="home.emit()"><span>КВА</span></button>
      <button aria-label="Быстрый переход" title="Быстрый переход (Ctrl+K)" (click)="search.emit()"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></button>
      <div class="divider"></div>
      <div class="spaces">
        @for (space of spaces(); track space.id) {
          <button class="space" [class.active]="selected() === space.id && !homeActive()" [attr.aria-label]="space.name" [attr.title]="space.name" [attr.aria-current]="selected() === space.id && !homeActive() ? 'page' : null" (click)="selectSpace.emit(space.id)">
            @if (space.icon) { <img [src]="space.icon" alt="" /> } @else { <span>{{ space.name.slice(0, 2).toUpperCase() }}</span> }
            @if (space.unread) { <small>{{ space.unread > 99 ? '99+' : space.unread }}</small> }
          </button>
        }
      </div>
      <button class="create" aria-label="Создать площадку" title="Создать площадку" (click)="create.emit()">+</button>
      <div class="spacer"></div>
      <button aria-label="Меню приложения" title="Меню приложения" (click)="menu.emit()">☰</button>
      <button aria-label="Уведомления" title="Уведомления" (click)="notifications.emit()"><svg viewBox="0 0 24 24"><path d="M5 17h14l-2-4V9a5 5 0 0 0-10 0v4l-2 4Zm5 3h4"/></svg></button>
      <button class="profile" aria-label="Мой профиль" title="Мой профиль" (click)="profile.emit()">{{ initials() }}</button>
    </nav>
  `,
  styles: [`
    :host{display:block;min-height:0;background:#0c1119;border-right:1px solid #263041}
    nav{height:100%;display:flex;flex-direction:column;align-items:center;gap:12px;padding:14px 8px;box-sizing:border-box}
    button{position:relative;width:48px;height:48px;flex-shrink:0;display:grid;place-items:center;border:0;border-radius:16px;background:#202a38;color:#cbd5e1;cursor:pointer;font:600 14px system-ui;transition:background .15s,border-radius .15s}
    button:hover,button.active{background:#29564e;color:#d6fff0;border-radius:12px}button.active:before{content:'';position:absolute;left:-8px;width:3px;height:26px;border-radius:3px;background:#72dfba}
    button:focus-visible{outline:2px solid #72dfba;outline-offset:3px}img{width:100%;height:100%;object-fit:cover;border-radius:inherit}.home img{object-fit:contain;padding:6px;box-sizing:border-box}
    svg{width:21px;fill:none;stroke:currentColor;stroke-width:1.8}.divider{width:30px;border-top:1px solid #303c4f}.spaces{display:flex;flex-direction:column;gap:12px;overflow-y:auto;overflow-x:hidden;padding:0 4px;scrollbar-width:thin}.create{color:#72dfba;font-size:27px}.spacer{flex:1}.profile{border-radius:50%;background:#35435a}
    small{position:absolute;right:-3px;bottom:-3px;background:#b83851;color:white;border:2px solid #0c1119;border-radius:12px;padding:1px 4px;font-size:10px}
    @media(max-width:980px){:host{display:none}}
  `]
})
export class WorkspaceRailComponent {
  readonly menu = output<void>();
  readonly spaces = input<SpaceLink[]>([]);
  readonly selected = input<string | null>(null);
  readonly homeActive = input(false);
  readonly initials = input('Я');
  readonly home = output<void>(); readonly search = output<void>(); readonly selectSpace = output<string>();
  readonly create = output<void>(); readonly profile = output<void>(); readonly notifications = output<void>();
}
