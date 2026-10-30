import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  input,
  output,
  signal,
} from '@angular/core';
import { WorkspaceMessageReactionCode } from '../core/models/workspace.models';
import { UiIconComponent } from './ui-icon.component';
import { EmojiPickerComponent } from './emoji-picker.component';

@Component({
  selector: 'app-message-actions',
  standalone: true,
  imports: [EmojiPickerComponent, UiIconComponent],
  template: `<dialog
    #dialog
    aria-labelledby="message-actions-title"
    (cancel)="cancel($event)"
    (pointerdown)="backdropDown = $event.target === dialog"
    (click)="backdrop($event)"
  >
    <h2 id="message-actions-title">Действия с сообщением</h2>
    @if (expanded()) {
      <button type="button" (click)="expanded.set(false)">‹ Назад</button>
      <app-emoji-picker
        [token]="token()"
        [embedded]="true"
        (choose)="react.emit($event)"
        (close)="expanded.set(false)"
      />
    } @else {
      <div class="quick-reactions">
        @for (item of reactions; track item.code) {
          <button type="button" [attr.aria-label]="item.label" (click)="react.emit(item.code)">
            {{ item.emoji }}
          </button>
        }
        <button type="button" aria-label="Все эмодзи" (click)="expanded.set(true)">
          <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
      <div class="actions">
        <button type="button" aria-label="Ответить" title="Ответить" (click)="choose.emit('reply')">
          <app-ui-icon name="reply" />
        </button>
        @if (canEdit()) {
          <button
            type="button"
            aria-label="Редактировать"
            title="Редактировать"
            (click)="choose.emit('edit')"
          >
            <app-ui-icon name="edit" />
          </button>
        }
        @if (text()) {
          <button
            type="button"
            aria-label="Копировать текст"
            title="Копировать текст"
            (click)="copy()"
          >
            <app-ui-icon name="copy" />
          </button>
        }
        @if (hasImage()) {
          <button
            type="button"
            aria-label="Открыть изображение"
            title="Открыть изображение"
            (click)="choose.emit('open-image')"
          >
            <app-ui-icon name="eye" />
          </button>
          <button
            type="button"
            aria-label="Сохранить изображение"
            title="Сохранить изображение"
            (click)="choose.emit('download-image')"
          >
            <app-ui-icon name="download" />
          </button>
        }
        @if (canDelete()) {
          <button
            type="button"
            aria-label="Удалить сообщение"
            title="Удалить сообщение"
            (click)="choose.emit('delete')"
          >
            <app-ui-icon name="trash" />
          </button>
        }
        @if (error()) {
          <p role="status">{{ error() }}</p>
        }
      </div>
    }
  </dialog>`,
  styles: [
    `
      dialog {
        width: 248px;
        max-width: calc(100vw - 16px);
        max-height: calc(100dvh - 16px);
        box-sizing: border-box;
        padding: 0;
        border: 0;
        border-radius: 12px;
        background: transparent;
        color: var(--palette-text);
        overflow: auto;
      }
      dialog::backdrop {
        background: rgb(0 0 0 / 0.12);
      }
      h2 {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
      }
      button {
        width: 100%;
        text-align: left;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      button:hover {
        background: var(--palette-hover);
      }
      button:focus-visible {
        outline: 2px solid var(--palette-primary);
        outline-offset: -2px;
      }
      p {
        font-size: 13px;
      }
      .quick-reactions {
        display: flex;
        gap: 2px;
      }
      .quick-reactions button {
        min-width: 0;
        text-align: center;
        font-size: 22px;
      }
      dialog:has(app-emoji-picker) {
        width: 296px;
        padding: 8px;
        background: var(--palette-surface);
      }
      button {
        min-height: 34px;
        height: 34px;
        margin: 0;
        padding: 0 10px;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      svg {
        width: 18px;
        height: 18px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.6;
        stroke-linecap: round;
        stroke-linejoin: round;
        flex: none;
      }
      .quick-reactions {
        border: 0;
        padding: 4px;
        margin-bottom: 6px;
        border-radius: 24px;
        background: var(--palette-surface);
      }
      .quick-reactions button {
        display: grid;
        place-items: center;
        width: 38px;
        padding: 0;
        border-radius: 50%;
        line-height: 1;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        padding: 5px;
        border-radius: 10px;
        background: var(--palette-surface);
      }
      .actions button {
        width: 44px;
        height: 42px;
        justify-content: center;
        padding: 0;
      }
      .actions p {
        flex-basis: 100%;
      }
      @media (pointer: coarse) {
        button {
          min-height: 42px;
          height: 42px;
        }
      }
    `,
  ],
})
export class MessageActionsComponent implements AfterViewInit, OnDestroy {
  readonly canDelete = input(false);
  readonly canEdit = input(false);
  readonly text = input('');
  readonly token = input.required<string>();
  readonly hasImage = input(false);
  readonly expanded = signal(false);
  readonly anchor = input<{ x: number; y: number } | null>(null);
  readonly react = output<WorkspaceMessageReactionCode>();
  readonly reactions: { code: WorkspaceMessageReactionCode; emoji: string; label: string }[] = [
    { code: 'heart', emoji: '❤️', label: 'Сердце' },
    { code: 'like', emoji: '👍', label: 'Нравится' },
    { code: 'laugh', emoji: '😂', label: 'Смешно' },
    { code: 'fire', emoji: '🔥', label: 'Огонь' },
    { code: 'wow', emoji: '😮', label: 'Удивление' },
  ];
  readonly choose = output<'edit' | 'reply' | 'open-image' | 'download-image' | 'delete'>();
  readonly close = output<void>();
  readonly error = signal('');
  backdropDown = false;
  cancel(event: Event) {
    event.preventDefault();
    if (this.expanded()) this.expanded.set(false);
    else this.close.emit();
  }
  @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  ngAfterViewInit(): void {
    const dialog = this.dialog.nativeElement;
    dialog.showModal();
    this.observer = new ResizeObserver(this.position);
    this.observer.observe(dialog);
    window.visualViewport?.addEventListener('resize', this.position);
    this.position();
  }

  private observer?: ResizeObserver;
  private position = () => {
    const d = this.dialog.nativeElement,
      r = d.getBoundingClientRect(),
      v = window.visualViewport,
      w = v?.width ?? innerWidth,
      h = v?.height ?? innerHeight,
      p = this.anchor() ?? { x: w / 2 - r.width / 2, y: h / 2 - r.height / 2 };
    d.style.margin = '0';
    d.style.left = Math.max(8, Math.min(p.x, w - r.width - 8)) + 'px';
    d.style.top = Math.max(8, Math.min(p.y, h - r.height - 8)) + 'px';
  };
  ngOnDestroy(): void {
    this.observer?.disconnect();
    window.visualViewport?.removeEventListener('resize', this.position);
    this.dialog.nativeElement.close();
  }
  backdrop(event: MouseEvent): void {
    const startedOnBackdrop = this.backdropDown;
    this.backdropDown = false;
    if (!startedOnBackdrop || event.target !== this.dialog.nativeElement) return;
    const rect = this.dialog.nativeElement.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      this.close.emit();
  }
  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.text());
      this.close.emit();
    } catch {
      this.error.set('Не удалось скопировать текст. Разрешите доступ к буферу обмена.');
    }
  }
}
