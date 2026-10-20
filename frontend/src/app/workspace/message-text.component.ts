import {ChangeDetectionStrategy, Component, input, output} from '@angular/core';

export interface RenderedMessageSegment {
  text: string;
  mentionUserId: string | null;
  chunks: {text: string; highlighted: boolean; links: {text:string;url:string|null}[]}[];
}

/** Isolate text rendering from audio levels, presence and unrelated workspace updates. */
@Component({
  selector: 'p[appMessageText]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for(segment of segments();track $index){
      @if(segment.mentionUserId){
        <button class="message-card__mention" type="button"
          [class.message-card__mention--current]="segment.mentionUserId===currentUserId()"
          (click)="mention.emit(segment)">
          @for(chunk of segment.chunks;track $index){
            @if(chunk.highlighted){<mark class="message-card__highlight">{{chunk.text}}</mark>}
            @else{<span>{{chunk.text}}</span>}
          }
        </button>
      }@else{
        @for(chunk of segment.chunks;track $index){
          @if(chunk.highlighted){<mark class="message-card__highlight">{{chunk.text}}</mark>}
          @else{
            @for(part of chunk.links;track $index){
              @if(part.url){<a class="message-link" [href]="part.url" target="_blank" rel="noopener noreferrer">{{part.text}}</a>}
              @else{<span>{{part.text}}</span>}
            }
          }
        }
      }
    }`,
  styles: [`
    .message-card__mention{display:inline;padding:0;border:0;background:transparent;color:var(--palette-secondary);font:inherit;font-weight:650;line-height:inherit;white-space:inherit;word-break:inherit;cursor:pointer}
    .message-card__mention--current{color:var(--palette-danger-text);font-weight:700}
    .message-card__mention:hover{text-decoration:underline;text-decoration-color:rgb(var(--rgb-cyan)/.52);text-underline-offset:2px}
    .message-card__highlight{display:inline;padding:0 .08em;border-radius:.26em;background:rgb(var(--rgb-warning)/.24);color:var(--palette-text)}
    .message-link{color:var(--palette-primary-text);text-decoration:underline;text-underline-offset:2px;overflow-wrap:anywhere}
  `],
})
export class MessageTextComponent {
  readonly segments = input.required<RenderedMessageSegment[]>();
  readonly currentUserId = input<string | null>(null);
  readonly mention = output<RenderedMessageSegment>();
}
