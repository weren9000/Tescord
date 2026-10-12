import { Component, input, output } from '@angular/core';

export interface ConversationLink { id: string; name: string; subtitle: string; icon: string | null; group: boolean; unread: number; mentions: number; online?: boolean; }

@Component({
  selector: 'app-conversation-list', standalone: true,
  template: `
    @for (entry of entries(); track entry.id) {
      <button class="entry" [class.selected]="selected() === entry.id" [attr.aria-current]="selected() === entry.id ? 'page' : null" (click)="open.emit(entry.id)">
        <span class="avatar" [class.group]="entry.group">@if(entry.icon){<img [src]="entry.icon" alt="" />}@else{ {{ entry.name.slice(0,2).toUpperCase() }} }@if(!entry.group){<i class="presence" [class.online]="entry.online" [attr.title]="entry.online ? 'В сети' : 'Не в сети'"></i>}</span>
        <span class="copy"><strong>{{ entry.name }}</strong><span>{{ entry.subtitle || (entry.group ? 'Групповой чат' : 'Личная переписка') }}</span></span>
        @if(entry.mentions){<small class="mention">&#64;{{ entry.mentions }}</small>}@else if(entry.unread){<small>{{ entry.unread > 99 ? '99+' : entry.unread }}</small>}
      </button>
    } @empty { <p>{{ emptyLabel() }}</p> }
  `,
  styles: [`
    :host{min-width:0;max-width:100%}.entry{box-sizing:border-box}.copy{width:0}
    .avatar{position:relative}.presence{position:absolute;bottom:-1px;right:-1px;width:8px;height:8px;border:2px solid #171d27;border-radius:50%;background:#677387}.presence.online{background:#91d4b2}
    :host{display:block}.filters{display:flex;gap:5px;padding:4px 3px 14px}.filters button{border:0;background:transparent;color:#a7b4c7;padding:7px 10px;border-radius:7px;font:inherit;font-size:12px;cursor:pointer}.filters .active{background:#2c394b;color:#fff}
    .entry{width:100%;display:flex;align-items:center;gap:10px;text-align:left;padding:10px 8px;border:0;border-radius:8px;background:transparent;color:#e5eaf2;cursor:pointer;margin-bottom:3px;min-height:62px}.entry:hover{background:#232f40}.entry.selected{background:#24443f;box-shadow:inset 3px 0 #72dfba}.avatar{width:38px;height:38px;flex:0 0 38px;display:grid;place-items:center;background:#35435a;border-radius:50%;font-size:12px;font-weight:600}.avatar.group{border-radius:11px}img{width:100%;height:100%;object-fit:cover;border-radius:inherit}.copy{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}.copy strong,.copy>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.copy strong{font-size:14px}.copy>span{font-size:12px;color:#aab8c9}small{background:#48576d;border-radius:12px;padding:2px 6px}.mention{background:#b83851}button:focus-visible{outline:2px solid #72dfba;outline-offset:-2px}p{font-size:13px;color:#aab8c9;padding:12px}
  `]
})
export class ConversationListComponent {
  readonly entries = input<ConversationLink[]>([]); readonly selected = input<string | null>(null); readonly open = output<string>();
  readonly emptyLabel = input('Здесь появятся ваши беседы');
}
