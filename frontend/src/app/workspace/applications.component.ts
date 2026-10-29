import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import {
  ConnectedApplication,
  PluginPreferencesService,
} from '../core/plugins/plugin-preferences.service';
import { openGameCalendar } from '../core/plugins/first-party-plugins';
import { ModalLayerDirective } from '../shared/modal-layer.directive';
import { UiIconComponent } from './ui-icon.component';

@Component({
  selector: 'app-applications',
  imports: [ModalLayerDirective, UiIconComponent],
  providers: [PluginPreferencesService],
  template: `
    <dialog appModalLayer class="applications" tabindex="-1" (keydown)="keydown($event)">
      <header>
        <h3>Приложения</h3>
        <button type="button" class="close" aria-label="Закрыть приложения" (click)="closed.emit()">
          ×
        </button>
      </header>
      <nav aria-label="Разделы приложений">
        <button type="button" [attr.aria-pressed]="tab() === 'mine'" (click)="tab.set('mine')">
          Мои приложения
        </button>
        <button
          type="button"
          [attr.aria-pressed]="tab() === 'catalog'"
          (click)="tab.set('catalog')"
        >
          Каталог
        </button>
      </nav>
      <section
        class="content"
        [attr.aria-label]="tab() === 'mine' ? 'Мои приложения' : 'Каталог'"
        [attr.aria-busy]="state.loading() || state.busy()"
      >
        @if (state.error()) {
          <div class="error" role="alert">
            <p>{{ state.error() }}</p>
            @if (state.loadFailed()) {
              <button type="button" (click)="state.load(token())">Повторить</button>
            }
          </div>
        }
        @if (state.loading()) {
          <p class="empty" role="status">Загружаем приложения…</p>
        } @else if (!state.loadFailed()) {
          @if (tab() === 'mine' && !connected().length) {
            <div class="empty">
              <h4>Пока нет приложений</h4>
              <button type="button" class="primary" (click)="tab.set('catalog')">
                Выбрать приложения
              </button>
            </div>
          } @else {
            <div class="applications-grid">
              @for (item of visible(); track item.id) {
                @if (tab() === 'catalog') {
                  <label class="application-tile" [class.connected]="item.enabled">
                    <input
                      type="checkbox"
                      [attr.aria-label]="'Подключить ' + item.name"
                      [checked]="item.enabled"
                      [disabled]="state.busy()"
                      (change)="toggle(item, $event)"
                    />
                    <span class="application-icon"><app-ui-icon name="calendar" /></span>
                    <strong>{{ item.name }}</strong>
                    <small>{{ item.description }}</small>
                  </label>
                } @else {
                  <button
                    class="application-tile"
                    type="button"
                    [disabled]="state.busy()"
                    [attr.aria-label]="'Открыть ' + item.name"
                    title="Откроется в новой вкладке"
                    (click)="open(item)"
                  >
                    <span class="application-icon"><app-ui-icon name="calendar" /></span>
                    <strong>{{ item.name }}</strong>
                    <small>{{ item.description }}</small>
                  </button>
                }
              }
            </div>
          }
        }
      </section>
    </dialog>
  `,
  styleUrl: './applications.component.scss',
})
export class ApplicationsComponent {
  readonly token = input.required<string>();
  readonly closed = output<void>();
  readonly state = inject(PluginPreferencesService);
  readonly tab = signal<'mine' | 'catalog'>('mine');
  readonly connected = computed(() => this.state.items().filter((item) => item.enabled));
  readonly visible = computed(() =>
    this.tab() === 'catalog' ? this.state.items() : this.connected(),
  );

  constructor() {
    effect(() => this.state.load(this.token()));
  }

  toggle(item: ConnectedApplication, event: Event): void {
    this.state.setEnabled(item, (event.target as HTMLInputElement).checked);
  }

  open(item: ConnectedApplication): void {
    if (item.enabled && item.id === 'game-calendar' && !this.state.busy()) openGameCalendar();
  }

  keydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit();
    }
  }
}
