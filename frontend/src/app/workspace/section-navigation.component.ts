import { Component, input, output } from '@angular/core';
import { UiIconComponent } from './ui-icon.component';

export type WorkspaceSection = 'chats' | 'groups' | 'platforms';

@Component({
  selector: 'app-section-navigation', standalone: true, imports: [UiIconComponent],
  template: `
    <nav aria-label="Основные разделы">
      <div class="brand" aria-label="Квачат">ква<span>чат</span><i></i></div>
      <div class="sections">
        @for (section of sections; track section.id) {
          <button type="button" [class.active]="selected() === section.id" [attr.aria-current]="selected() === section.id ? 'page' : null" (click)="selectSection.emit(section.id)">
            <app-ui-icon [name]="section.icon" /><span>{{ section.label }}</span>
          </button>
        }
      </div>
      <div class="utilities">
        <button type="button" title="Быстрый переход (Ctrl+K)" aria-label="Быстрый переход" (click)="search.emit()"><app-ui-icon name="search"/><span>Поиск</span></button>
        <button type="button" aria-label="Меню приложения" (click)="menu.emit()"><app-ui-icon name="menu"/><span>Меню</span></button>
        <button class="notification" type="button" aria-label="Уведомления" (click)="notifications.emit()"><app-ui-icon name="bell"/>@if (hasNotifications()) {<i></i>}<span>События</span></button>
        <button class="profile" type="button" aria-label="Мой профиль" (click)="profile.emit()"><b>{{ initials() }}</b><span>Профиль</span></button>
      </div>
    </nav>`,
  styles: [`
    :host{display:block;min-height:0;background:#10151e;border-right:1px solid #ffffff09;color:#99a5b7}
    nav{display:flex;flex-direction:column;height:100%;padding:24px 10px 16px;box-sizing:border-box;gap:30px}
    .brand{position:relative;text-align:center;font:bold 18px system-ui;color:#edf3ef;letter-spacing:-1px}.brand span{font-weight:400;color:#aebbac}.brand i{display:inline-block;width:5px;height:5px;margin-left:2px;background:#92d6b4;border-radius:50%}
    .sections,.utilities{display:flex;flex-direction:column;gap:8px}.utilities{margin-top:auto;gap:4px}
    button{position:relative;width:100%;min-height:66px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border:1px solid transparent;border-radius:12px;background:transparent;color:inherit;font:500 11px system-ui;cursor:pointer}
    button:hover{background:#ffffff06;color:#e9f1ed}button.active{background:#8dcfa412;border-color:#8dcfa426;color:#b0e3c6}button.active:before{content:'';position:absolute;left:-11px;top:20px;width:3px;height:26px;border-radius:3px;background:#91d4b2}
    button:focus-visible{outline:2px solid #91d4b2;outline-offset:2px}.utilities button{min-height:58px;font-size:10px}.profile b{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#2b3b37;color:#bfdecf;font-size:11px}.notification i{position:absolute;top:8px;right:20px;width:6px;height:6px;border-radius:50%;background:#91d4b2}
    @media(max-width:980px){:host{display:none}}
  `],
})
export class SectionNavigationComponent {
  readonly selected = input<WorkspaceSection>('chats');
  readonly initials = input('Я');
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
