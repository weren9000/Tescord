import {Component, input} from '@angular/core';

@Component({
  selector: 'app-chat-skeleton',
  standalone: true,
  host: {'role': 'status', '[attr.aria-label]': 'label()', 'aria-live': 'polite', '[class.compact]': 'compact()'},
  template: `
    <div class="skeleton" [class.messages]="kind() === 'messages'" [class.history]="kind() === 'history'" aria-hidden="true">
      @for (width of widths().slice(0, count()); track $index) {
        <div class="row">
          <span class="avatar bone"></span>
          <div class="copy"><span class="bone title" [style.width.%]="width * .6"></span><span class="bone line" [style.width.%]="width"></span>
            @if(kind() === 'messages' && $index % 2 === 0){<span class="bone line" [style.width.%]="width * .75"></span>}
          </div>
          @if(kind() === 'list'){<span class="bone time"></span>}
        </div>
      }
    </div>
  `,
  styles: [`
    :host{display:block;min-width:0;width:100%;pointer-events:none}
    .skeleton{opacity:0;animation:reveal .15s ease .18s forwards}
    .row{display:flex;align-items:center;gap:10px;padding:10px 8px;min-height:var(--conversation-height,62px);box-sizing:border-box;margin-bottom:3px}
    .avatar{width:var(--conversation-avatar,44px);height:var(--conversation-avatar,44px);flex-shrink:0;border-radius:22%}
    .copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:8px}
    .bone{display:block;background:color-mix(in srgb,var(--palette-text) 10%,var(--palette-surface));animation:pulse 1.8s ease-in-out infinite;border-radius:5px}
    .title{height:13px}.line{height:11px}.time{width:25px;height:9px;align-self:flex-start;margin-top:6px}
    .messages{padding:16px 10px;max-width:900px}.messages .row{align-items:flex-start;min-height:88px;padding:12px 8px}.messages .avatar{width:36px;height:36px}.messages .copy{gap:12px}.messages .line{height:14px}.messages .title{height:10px;max-width:120px}
    .history .row{padding:2px 8px;min-height:28px;margin:0}.history .avatar{display:none}.history .copy{flex-direction:row;gap:12px;align-items:center}.history .title{max-width:70px;height:8px}.history .line{max-width:210px;height:8px}
    @keyframes reveal{to{opacity:1}}@keyframes pulse{50%{opacity:.45}}
    @media(min-width:981px){:host.compact .copy,:host.compact .time{display:none}:host.compact .row{justify-content:center;padding:4px;min-height:44px}:host.compact .avatar{width:36px;height:36px}}
    @media(max-width:600px){.messages{padding:12px 0}.messages .row{min-height:80px}.messages .avatar{width:30px;height:30px}}
    @media(prefers-reduced-motion:reduce){.skeleton{animation:none;opacity:1}.bone{animation:none}}
  `],
})
export class ChatSkeletonComponent {
  readonly kind = input<'list'|'messages'|'members'|'history'>('list');
  readonly count = input(6);
  readonly compact = input(false);
  readonly label = input('Загрузка чатов');
  readonly widths = () => [82, 58, 94, 68, 79, 48, 87, 63];
}
