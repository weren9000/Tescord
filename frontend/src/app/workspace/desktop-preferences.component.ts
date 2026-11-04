import { UiIconComponent } from './ui-icon.component';
import {
  AfterViewInit,
  Component,
  ElementRef,
  ViewChild,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../core/api/api-base';
import { DesktopPreferencesService, Density } from './desktop-preferences.service';
import { InterfaceStyleService } from './interface-style.service';

@Component({
  imports: [UiIconComponent],
  selector: 'app-desktop-preferences',
  standalone: true,
  template: `
    @if (!openImmediately()) {
      <button type="button" class="trigger" (click)="dialog.showModal()">Вид</button>
    }
    <dialog
      #dialog
      aria-label="Оформление"
      (close)="closed.emit()"
      (click)="backdrop($event, dialog)"
    >
      <header>
        <h2>Оформление</h2>
        <button
          type="button"
          aria-label="Закрыть оформление"
          (click)="dialog.close()"
          class="kva-icon-action"
        >
          <app-ui-icon name="close" />
        </button>
      </header>
      <fieldset class="interface-styles">
        <legend>Стиль приложения</legend>
        <label class="style-choice" [class.selected]="interfaceStyle.value() === 'enamel'">
          <input
            type="radio"
            name="interface-style"
            value="enamel"
            [checked]="interfaceStyle.value() === 'enamel'"
            (change)="interfaceStyle.select('enamel')"
          />
          <span class="style-swatch style-swatch--enamel" aria-hidden="true"></span>
          <span><strong>Эмаль</strong><small>Объёмные значки и мягкие блики</small></span>
        </label>
        <label class="style-choice" [class.selected]="interfaceStyle.value() === 'constellation'">
          <input
            type="radio"
            name="interface-style"
            value="constellation"
            [checked]="interfaceStyle.value() === 'constellation'"
            (change)="interfaceStyle.select('constellation')"
          />
          <span class="style-swatch style-swatch--constellation" aria-hidden="true"></span>
          <span><strong>Созвездие</strong><small>Ночная палитра и контурные иконки</small></span>
        </label>
        <label class="style-choice" [class.selected]="interfaceStyle.value() === 'star-atlas'">
          <input
            type="radio"
            name="interface-style"
            value="star-atlas"
            [checked]="interfaceStyle.value() === 'star-atlas'"
            (change)="interfaceStyle.select('star-atlas')"
          />
          <span class="style-swatch style-swatch--atlas" aria-hidden="true"></span>
          <span
            ><strong>Звёздный атлас</strong><small>Тёплая бумага и рисованные значки</small></span
          >
        </label>
        <p>Стиль сохраняется на этом устройстве.</p>
      </fieldset>
      @if (token() && interfaceStyle.value() === 'enamel') {
        <label class="range"
          >Тема приложения
          <select
            aria-label="Тема приложения"
            [value]="selectedTheme()"
            [disabled]="loading() || saving()"
            (change)="setTheme($any($event.target).value)"
          >
            <option value="">Базовая</option>
            @for (theme of themes(); track theme.id) {
              <option [value]="theme.id">{{ theme.name }}</option>
            }
          </select>
        </label>
        @if (error()) {
          <p role="alert">
            {{ error() }}
            <button (click)="loadThemes()" [disabled]="loading() || saving()">Повторить</button>
          </p>
        }
      }
      <fieldset>
        <legend>Плотность интерфейса</legend>
        @for (option of densities; track option.id) {
          <label class="choice"
            ><input
              type="radio"
              name="desktop-density"
              [value]="option.id"
              [checked]="preferences.value().density === option.id"
              (change)="preferences.update({ density: option.id })"
            />{{ option.label }}</label
          >
        }
      </fieldset>
      <label class="range"
        >Размер текста сообщений: {{ preferences.value().textSize }} px
        <input
          type="range"
          min="13"
          max="20"
          step="1"
          [value]="preferences.value().textSize"
          (input)="preferences.update({ textSize: +$any($event.target).value })"
        />
      </label>
      <div class="preview" [style.font-size.px]="preferences.value().textSize">
        <strong>Пример сообщения</strong>
        <p>Своё болото. Свои люди.</p>
      </div>
      @if (platforms()) {
        <div class="desktop-widths">
          <label class="range"
            >Ширина списка площадок: {{ preferences.value().platformsWidth }} px
            <input
              aria-label="Ширина списка площадок"
              type="range"
              min="180"
              max="360"
              step="10"
              [value]="preferences.value().platformsWidth"
              (input)="preferences.update({ platformsWidth: +$any($event.target).value })"
            />
          </label>
          <label class="range"
            >Ширина чатов площадки: {{ preferences.value().platformChatsWidth }} px
            <input
              aria-label="Ширина чатов площадки"
              type="range"
              min="220"
              max="460"
              step="10"
              [value]="preferences.value().platformChatsWidth"
              (input)="preferences.update({ platformChatsWidth: +$any($event.target).value })"
            />
          </label>
        </div>
      } @else {
        <label class="range desktop-widths"
          >Ширина списка бесед: {{ preferences.value().width }} px
          <input
            type="range"
            min="220"
            max="460"
            step="10"
            [value]="preferences.value().width"
            (input)="preferences.update({ width: +$any($event.target).value })"
          />
        </label>
      }
      <footer>
        <button type="button" (click)="preferences.reset()">Сбросить вид</button
        ><button type="button" (click)="dialog.close()">Готово</button>
      </footer>
    </dialog>
  `,
  styles: [
    `
      .style-choice {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 8px;
        margin-block: 6px;
        border: 1px solid transparent;
        border-radius: var(--ui-radius-button);
        cursor: pointer;
      }
      .style-choice.selected {
        border-color: var(--palette-primary-text);
        background: var(--palette-selected);
      }
      .style-choice small {
        display: block;
        margin-top: 4px;
        color: var(--palette-muted);
      }
      .style-swatch {
        flex: 0 0 36px;
        height: 44px;
        border-radius: 8px;
      }
      .style-swatch--enamel {
        background: linear-gradient(145deg, #c482d3, #3c164d 45%, #210c30);
        border: 1px solid #c797e9;
        box-shadow: inset 2px 2px 4px #edc5ff80;
      }
      .style-swatch--constellation {
        background:
          url('/assets/constellation/sky.svg') center / cover,
          #10121c;
        border: 1px solid #9c8cb6;
      }
      .style-swatch--atlas {
        background: linear-gradient(160deg, #10121c 40%, #f5e7cf 41% 80%, #754bff 81%);
        border: 1px solid #9b8a76;
      }
      @media (max-width: 980px) {
        .range.desktop-widths,
        .desktop-widths {
          display: none;
        }
      }
      select {
        box-sizing: border-box;
        width: 100%;
        min-height: 40px;
        padding: 8px 12px;
        border: 1px solid var(--palette-border);
        border-radius: 7px;
        background: var(--palette-raised);
        color: var(--palette-text);
        font: inherit;
      }
      select:focus-visible {
        outline: 2px solid var(--palette-cyan);
        outline-offset: 2px;
      }
      button:disabled,
      select:disabled {
        opacity: 0.55;
        cursor: wait;
      }
      button {
        font: inherit;
        color: var(--palette-text);
        background: var(--palette-raised);
        border: 1px solid var(--palette-border);
        border-radius: 7px;
        padding: 7px 12px;
        cursor: pointer;
      }
      .trigger {
        font-size: 12px;
        background: transparent;
      }
      dialog {
        box-sizing: border-box;
        width: min(480px, calc(100vw - 32px));
        max-height: 85dvh;
        overflow: auto;
        padding: 16px;
        border: 1px solid var(--palette-border);
        border-radius: var(--ui-radius-panel, 12px);
        background: var(--palette-surface);
        color: var(--palette-text);
      }
      dialog::backdrop {
        background: rgb(0 0 0 / 0.5);
      }
      header,
      footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      h2 {
        font-size: 19px;
        margin: 0;
      }
      p {
        color: var(--palette-muted);
        font-size: 13px;
        line-height: 1.5;
      }
      fieldset {
        border: 1px solid var(--palette-border);
        border-radius: 8px;
        margin: 20px 0;
        padding: 12px;
      }
      .choice {
        display: flex;
        gap: 8px;
        padding: 7px;
      }
      .range {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin: 20px 0;
      }
      input {
        accent-color: var(--palette-primary);
      }
      .preview {
        padding: 14px;
        background: var(--palette-raised);
        border-radius: 8px;
        line-height: 1.5;
      }
      .preview strong {
        font-size: 12px;
      }
      .preview p {
        font-size: inherit;
        color: var(--palette-text);
        margin: 6px 0;
      }
      button:focus-visible,
      input:focus-visible {
        outline: 2px solid var(--palette-cyan);
        outline-offset: 2px;
      }
    `,
  ],
})
export class DesktopPreferencesComponent implements AfterViewInit {
  readonly interfaceStyle = inject(InterfaceStyleService);
  readonly platforms = input(false);
  readonly openImmediately = input(false);
  readonly token = input('');
  readonly closed = output<void>();
  readonly changed = output<void>();
  readonly themes = signal<{ id: string; name: string; equipped: boolean }[]>([]);
  readonly selectedTheme = signal('');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  private readonly http = inject(HttpClient);
  @ViewChild('dialog') dialog!: ElementRef<HTMLDialogElement>;
  ngAfterViewInit() {
    if (this.openImmediately()) this.dialog.nativeElement.showModal();
    if (this.token()) queueMicrotask(() => void this.loadThemes());
  }
  async loadThemes() {
    this.loading.set(true);
    this.error.set('');
    try {
      const items: { id: string; name: string; equipped: boolean }[] = [];
      for (let page = 1, pages = 1; page <= pages; page++) {
        const data = await firstValueFrom(
          this.http.get<{ items: typeof items; pages: number }>(API_BASE_URL + '/api/inventory', {
            headers: { Authorization: 'Bearer ' + this.token() },
            params: { kind: 'theme', page },
          }),
        );
        items.push(...data.items);
        pages = data.pages;
      }
      this.themes.set(items);
      this.selectedTheme.set(items.find((x) => x.equipped)?.id ?? '');
    } catch {
      this.error.set('Не удалось загрузить темы.');
    } finally {
      this.loading.set(false);
    }
  }
  async setTheme(id: string) {
    if (this.saving() || this.loading()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      await firstValueFrom(
        this.http.post(
          API_BASE_URL + '/api/inventory/' + (id ? 'items/' + id + '/equip' : 'theme/reset'),
          { request_id: crypto.randomUUID() },
          { headers: { Authorization: 'Bearer ' + this.token() } },
        ),
      );
      this.selectedTheme.set(id);
      this.changed.emit();
    } catch {
      this.error.set('Не удалось применить тему.');
      const select = this.dialog.nativeElement.querySelector('select');
      if (select) select.value = this.selectedTheme();
    } finally {
      this.saving.set(false);
    }
  }
  readonly preferences = inject(DesktopPreferencesService);
  readonly densities: { id: Density; label: string }[] = [
    { id: 'compact', label: 'Компактная' },
    { id: 'normal', label: 'Обычная' },
    { id: 'spacious', label: 'Просторная' },
  ];
  backdrop(event: MouseEvent, dialog: HTMLDialogElement): void {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      dialog.close();
  }
}
