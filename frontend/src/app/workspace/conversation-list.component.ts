import {ChatSkeletonComponent} from './chat-skeleton.component';
import {UserCardDirective} from './user-card.directive';
import { Component, input, output } from '@angular/core';

export interface ConversationLink { userId?:string; id: string; name: string; subtitle: string; icon: string | null; group: boolean; unread: number; mentions: number; online?: boolean; pinned?: boolean; }

@Component({
  selector: 'app-conversation-list', standalone: true, imports: [ChatSkeletonComponent, UserCardDirective], host: {'[class.compact]':'compact()'},
  template: `
    @if (loading() && !entries().length) {<app-chat-skeleton [compact]="compact()" />} @else {
    @for (entry of entries(); track entry.id; let first = $first; let index = $index) {
      @if (entry.pinned && first) { <h3>Закреплённые</h3> }
      @if (!entry.pinned && index > 0 && entries()[index - 1].pinned) { <h3>Все беседы</h3> }
      <div class="entry-row">
      <button class="entry" [title]="entry.name" [attr.aria-label]="entry.name" [class.selected]="selected() === entry.id" [attr.aria-current]="selected() === entry.id ? 'page' : null" (click)="open.emit(entry.id)">
        <span class="avatar" [appUserCard]="entry.group ? null : entry.userId" [class.group]="entry.group">@if(entry.icon){<img loading="lazy" decoding="async" [src]="entry.icon" alt="" />}@else{ {{ entry.name.slice(0,2).toUpperCase() }} }@if(!entry.group){<i class="presence" [class.online]="entry.online" [attr.title]="entry.online ? 'В сети' : 'Не в сети'"></i>}</span>
        <span class="copy"><strong>{{ entry.name }}</strong><span>{{ entry.subtitle || (entry.group ? 'Групповой чат' : 'Личная переписка') }}</span></span>
        @if(entry.mentions){<small class="mention">&#64;{{ entry.mentions }}</small>}@else if(entry.unread){<small>{{ entry.unread > 99 ? '99+' : entry.unread }}</small>}
      </button>
      <button type="button" class="pin" [class.pin--active]="entry.pinned" [attr.aria-label]="(entry.pinned ? 'Открепить ' : 'Закрепить ') + entry.name" [attr.title]="entry.pinned ? 'Открепить' : 'Закрепить'" [attr.aria-pressed]="!!entry.pinned" [disabled]="pending().includes(entry.id)" (click)="pin.emit(entry.id)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M9 3h6l-1 6 4 4v2H6v-2l4-4zM12 15v6" /></svg>
      </button>
      </div>
    } @empty { <p>{{ emptyLabel() }}</p> }
    }
  `,
  styles: [`
    :host{min-width:0;max-width:100%}.entry{box-sizing:border-box}.copy{width:0}
    .avatar{position:relative}.presence{position:absolute;bottom:-1px;right:-1px;width:8px;height:8px;border:2px solid var(--palette-surface);border-radius:50%;background:var(--palette-subtle)}.presence.online{background:var(--palette-cyan)}
    :host{display:block}.filters{display:flex;gap:5px;padding:4px 3px 14px}.filters button{border:0;background:transparent;color:var(--palette-muted);padding:7px 10px;border-radius:7px;font:inherit;font-size:12px;cursor:pointer}.filters .active{background:var(--palette-hover);color:var(--palette-text)}
    .entry{width:100%;display:flex;align-items:center;gap:10px;text-align:left;padding:10px 8px;border:0;border-radius:8px;background:transparent;color:var(--palette-text);cursor:pointer;margin-bottom:3px;min-height:62px}.entry:hover{background:var(--palette-raised)}.entry.selected{background:var(--palette-raised);box-shadow:inset 3px 0 var(--palette-cyan)}.avatar{width:44px;height:44px;flex:0 0 44px;display:grid;place-items:center;background:var(--palette-hover);border-radius:22%;font-size:12px;font-weight:600}.avatar.group{border-radius:22%}img{width:100%;height:100%;object-fit:cover;border-radius:inherit}.copy{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}.copy strong,.copy>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.copy strong{font-size:14px}.copy>span{font-size:12px;color:var(--palette-muted)}small{background:var(--palette-border);border-radius:12px;padding:2px 6px}.mention{background:var(--palette-danger-surface)}button:focus-visible{outline:2px solid var(--palette-cyan);outline-offset:-2px}p{font-size:13px;color:var(--palette-muted);padding:12px}
    .entry.selected{background:var(--palette-selected);box-shadow:inset 3px 0 var(--palette-primary)}
    .entry-row{position:relative}.entry{padding-right:36px}.pin{position:absolute;right:2px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:32px;height:36px;padding:7px;border:0;border-radius:6px;background:transparent;color:var(--palette-muted);cursor:pointer;opacity:0}.pin svg{width:18px;height:18px}.pin--active,.entry-row:hover .pin,.entry-row:focus-within .pin{opacity:1}.pin--active{color:var(--palette-primary)}.pin:hover{background:var(--palette-hover)}.pin:disabled{cursor:wait}h3{font-size:11px;color:var(--palette-muted);font-weight:500;margin:14px 8px 8px}
    @media(hover:none){.pin{opacity:1;width:36px;min-height:44px}}
    @media(min-width:981px){.entry{min-height:var(--conversation-height,62px);padding-top:var(--conversation-padding,10px);padding-bottom:var(--conversation-padding,10px)}.avatar{width:var(--conversation-avatar,44px);height:var(--conversation-avatar,44px);flex-basis:var(--conversation-avatar,44px)}}
    @media(min-width:981px){
      :host.compact h3,:host.compact .copy,:host.compact .pin{display:none}
      :host.compact .entry{position:relative;width:44px;height:44px;min-height:44px;padding:4px;margin:0 auto 8px;justify-content:center;gap:0}
      :host.compact .avatar{width:36px;height:36px;flex-basis:36px}
      :host.compact small{position:absolute;right:0;top:0;padding:1px 3px;font-size:9px;max-width:32px;line-height:12px;background:var(--palette-primary);color:white}
      :host.compact p{font-size:10px;padding:4px;overflow-wrap:anywhere}
    }
  `]
})
export class ConversationListComponent {
  readonly loading = input(false);
  readonly compact = input(false);
  readonly pin = output<string>();
  readonly pending = input<string[]>([]);
  readonly entries = input<ConversationLink[]>([]); readonly selected = input<string | null>(null); readonly open = output<string>();
  readonly emptyLabel = input('Здесь появятся ваши беседы');
}
