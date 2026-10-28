import { Component, inject, input, output } from '@angular/core';
import { PluginPreferencesService } from '../core/plugins/plugin-preferences.service';
import { ActionMenuComponent } from './action-menu.component';
import { UiIconComponent } from './ui-icon.component';

@Component({
  selector: 'app-applications',
  imports: [ActionMenuComponent, UiIconComponent],
  template: `
    <app-action-menu label="Приложения" (close)="closed.emit()">
      <p class="menu-note">Выберите приложения, которые хотите видеть в меню Квачата.</p>
      <label class="application-option">
        <app-ui-icon name="calendar" />
        <span>
          <strong>Когда игра</strong>
          <small>Календарь ролевых игр и конвентов. Данные обновляются каждый день.</small>
        </span>
        <input
          type="checkbox"
          aria-label="Активировать Когда игра"
          [checked]="preferences.calendarEnabled(userId())"
          [disabled]="!userId()"
          (change)="toggle($event)"
        />
      </label>
      <p class="menu-note">Выбор сохраняется в этом браузере для вашего аккаунта.</p>
      @if (!preferences.saved()) {
        <p class="menu-note" role="status">
          Не удалось сохранить выбор. Он действует до перезагрузки.
        </p>
      }
    </app-action-menu>
  `,
  styles: `
    .application-option {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 12px 4px;
      padding: 12px 8px;
      border: 1px solid var(--palette-border);
      border-radius: 10px;
      color: var(--palette-text);
      cursor: pointer;
    }
    .application-option span {
      flex: 1;
      min-width: 0;
    }
    .application-option strong {
      display: block;
      font-size: 14px;
    }
    .application-option small {
      display: block;
      margin-top: 6px;
      font-size: 12px;
      line-height: 1.5;
      color: var(--palette-muted);
    }
    .application-option input {
      width: 22px;
      height: 22px;
      flex-shrink: 0;
      accent-color: var(--palette-primary);
      cursor: pointer;
    }
    .application-option:focus-within {
      outline: 2px solid var(--palette-primary);
      outline-offset: 2px;
    }
  `,
})
export class ApplicationsComponent {
  readonly userId = input.required<string | null>();
  readonly closed = output<void>();
  readonly preferences = inject(PluginPreferencesService);

  toggle(event: Event): void {
    this.preferences.setCalendarEnabled(this.userId(), (event.target as HTMLInputElement).checked);
  }
}
