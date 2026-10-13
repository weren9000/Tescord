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
    .avatar{position:relative}.presence{position:absolute;bottom:-1px;right:-1px;width:8px;height:8px;border:2px solid var(--palette-surface);border-radius:50%;background:var(--palette-subtle)}.presence.online{background:var(--palette-cyan)}
    :host{display:block}.filters{display:flex;gap:5px;padding:4px 3px 14px}.filters button{border:0;background:transparent;color:var(--palette-muted);padding:7px 10px;border-radius:7px;font:inherit;font-size:12px;cursor:pointer}.filters .active{background:var(--palette-hover);color:var(--palette-text)}
    .entry{width:100%;display:flex;align-items:center;gap:10px;text-align:left;padding:10px 8px;border:0;border-radius:8px;background:transparent;color:var(--palette-text);cursor:pointer;margin-bottom:3px;min-height:62px}.entry:hover{background:var(--palette-raised)}.entry.selected{background:var(--palette-raised);box-shadow:inset 3px 0 var(--palette-cyan)}.avatar{width:38px;height:38px;flex:0 0 38px;display:grid;place-items:center;background:var(--palette-hover);border-radius:22%;font-size:12px;font-weight:600}.avatar.group{border-radius:22%}img{width:100%;height:100%;object-fit:cover;border-radius:inherit}.copy{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}.copy strong,.copy>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.copy strong{font-size:14px}.copy>span{font-size:12px;color:var(--palette-muted)}small{background:var(--palette-border);border-radius:12px;padding:2px 6px}.mention{background:var(--palette-danger-surface)}button:focus-visible{outline:2px solid var(--palette-cyan);outline-offset:-2px}p{font-size:13px;color:var(--palette-muted);padding:12px}
    .entry.selected{background:var(--palette-selected);box-shadow:inset 3px 0 var(--palette-primary)}
  `]
})
export class ConversationListComponent {
  readonly entries = input<ConversationLink[]>([]); readonly selected = input<string | null>(null); readonly open = output<string>();
  readonly emptyLabel = input('Здесь появятся ваши беседы');
}
