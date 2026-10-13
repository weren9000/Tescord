import { Component, input, output } from '@angular/core';
import { UiIconComponent } from './ui-icon.component';

export type WorkspaceSection = 'chats' | 'groups' | 'platforms';

@Component({
  selector: 'app-section-navigation', standalone: true, imports: [UiIconComponent],
  template: `
    <nav aria-label="Основные разделы">
      <div class="brand"><img src="/assets/kva-wordmark-v2.png" alt="Квачат" width="70" height="35" /></div>
      <div class="sections">
        @for (section of sections; track section.id) {
          <button type="button" [class.active]="selected() === section.id" [attr.aria-current]="selected() === section.id ? 'page' : null" (click)="selectSection.emit(section.id)">
            <app-ui-icon [name]="section.icon" /><span>{{ section.label }}</span>
          </button>
        }
        @if(isAvatarAdmin()) {<button type="button" (click)="inventory.emit('admin')"><app-ui-icon name="avatarAdmin"/><span>Админ-Аватарок</span></button>}
        <button type="button" (click)="inventory.emit('inventory')"><app-ui-icon name="inventory"/><span>Инвентарь @if(inventoryUnread()){· {{inventoryUnread()}}}</span></button>
      </div>
      <div class="utilities">
        <button type="button" title="Быстрый переход (Ctrl+K)" aria-label="Быстрый переход" (click)="search.emit()"><app-ui-icon name="search"/><span>Поиск</span></button>
        <button type="button" aria-label="Меню приложения" (click)="menu.emit()"><app-ui-icon name="menu"/><span>Меню</span></button>
        <button class="notification" type="button" aria-label="Уведомления" (click)="notifications.emit()"><app-ui-icon name="bell"/>@if (hasNotifications()) {<i></i>}<span>События</span></button>
        <button class="profile" type="button" aria-label="Мой профиль" (click)="profile.emit()">@if(avatarUrl()){<img class="profile-avatar" [src]="avatarUrl()" alt="" width="30" height="30" />}@else{<b>{{ initials() }}</b>}<span>Профиль</span></button>
      </div>
    </nav>`,
  styles: [`
    :host{display:block;min-height:0;background:var(--palette-surface);border-right:1px solid color-mix(in srgb, var(--palette-text) 3.53%, transparent);color:var(--palette-muted)}
    nav{display:flex;flex-direction:column;height:100%;padding:24px 10px 16px;box-sizing:border-box;gap:30px}
    .brand{position:relative;text-align:center;font:bold 18px system-ui;color:var(--palette-text);letter-spacing:-1px}.brand span{font-weight:400;color:var(--palette-muted)}.brand i{display:inline-block;width:5px;height:5px;margin-left:2px;background:var(--palette-cyan);border-radius:50%}
    .sections,.utilities{display:flex;flex-direction:column;gap:8px}.utilities{margin-top:auto;gap:4px}
    button{position:relative;width:100%;min-height:66px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border:1px solid transparent;border-radius:12px;background:transparent;color:inherit;font:500 11px system-ui;cursor:pointer}
    button:hover{background:color-mix(in srgb, var(--palette-text) 2.35%, transparent);color:var(--palette-text)}button.active{background:color-mix(in srgb, var(--palette-cyan) 7.06%, transparent);border-color:color-mix(in srgb, var(--palette-cyan) 14.90%, transparent);color:var(--palette-cyan)}button.active:before{content:'';position:absolute;left:-11px;top:20px;width:3px;height:26px;border-radius:3px;background:var(--palette-cyan)}
    button:focus-visible{outline:2px solid var(--palette-cyan);outline-offset:2px}.utilities button{min-height:58px;font-size:10px}.profile b{display:grid;place-items:center;width:30px;height:30px;border-radius:22%;background:var(--palette-raised);color:var(--palette-cyan);font-size:11px}.notification i{position:absolute;top:8px;right:20px;width:6px;height:6px;border-radius:50%;background:var(--palette-cyan)}
    button.active{background:var(--palette-selected);border-color:transparent;color:var(--palette-primary-text)}button.active:before{background:var(--palette-primary)}
    .profile b{color:var(--palette-secondary);background:var(--palette-hover)}
    .profile-avatar{width:30px;height:30px;object-fit:cover;border-radius:22%}
    .brand img{display:block;width:70px;height:35px;object-fit:contain;mix-blend-mode:lighten}
    nav{overflow-y:auto}.brand,.sections,.utilities{flex-shrink:0}
    @media(max-height:850px){nav{gap:14px;padding:14px 10px}.sections{gap:4px}.sections button{min-height:54px;gap:5px}.utilities button{min-height:46px;gap:4px}}
    @media(max-width:980px){:host{display:none}}
  `],
})
export class SectionNavigationComponent {
  readonly selected = input<WorkspaceSection>('chats');
  readonly isAvatarAdmin = input(false);
  readonly inventoryUnread = input(0);
  readonly inventory = output<'inventory' | 'admin'>();
  readonly initials = input('Я');
  readonly avatarUrl = input<string | null>(null);
  readonly hasNotifications = input(false);
  readonly selectSection = output<WorkspaceSection>();
  readonly search = output<void>();
  readonly menu = output<void>();
  readonly profile = output<void>();
  readonly notifications = output<void>();
  readonly sections = [
    {id:'chats' as const, label:'Друзья', icon:'friends'},
    {id:'groups' as const, label:'Группы', icon:'groups'},
    {id:'platforms' as const, label:'Площадки', icon:'platforms'},
  ];
}
