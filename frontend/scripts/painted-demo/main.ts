import '@angular/compiler';
import { Component, computed, signal } from '@angular/core';
import { MIGRATION } from './migration-data';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  PaintedButtonComponent,
  PaintedGlyphComponent,
  PaintedArtComponent,
  PAINTED_ART_NAMES,
  PAINTED_GLYPHS,
  PaintedGlyphName,
} from '../../src/app/shared/painted-controls';

@Component({
  selector: 'painted-demo',
  imports: [PaintedButtonComponent, PaintedGlyphComponent, PaintedArtComponent],
  template: `
    <header>
      <p class="eyebrow">КВАЧАТ · КОСМИЧЕСКАЯ КОМПАНИЯ</p>
      <h1>Все свои.<br /><span>В каждой детали.</span></h1>
      <p>Иконки и кнопки с рисованной фактурой, тёплым светом и бирюзовыми отражениями.</p>
      <p>
        <a href="./inventory.json">Карта элементов и мест будущей замены</a> · Рабочие экраны пока
        не переведены.
      </p>
    </header>
    <main>
      <section aria-labelledby="art-title">
        <div class="section-head">
          <h2 id="art-title">Знакомые места и вещи</h2>
          <span>{{ artNames.length }} рисованных иконок</span>
        </div>
        <div class="art-grid">
          @for (name of artNames; track name; let i = $index) {
            <figure>
              <kva-painted-art [name]="name" [size]="144" basePath="./assets/" />
              <figcaption>{{ labels[i] }}</figcaption>
            </figure>
          }
        </div>
      </section>
      <section>
        <div class="section-head">
          <h2>Кнопки, которые хочется нажать</h2>
          <span>Текст остаётся текстом</span>
        </div>
        <div class="row actions">
          <button kvaPainted size="lg" (click)="count.set(count() + 1)" id="primary">
            Присоединиться</button
          ><button kvaPainted variant="secondary" size="lg" (click)="count.set(count() + 1)">
            Пригласить друзей</button
          ><button kvaPainted variant="danger" size="lg" (click)="count.set(count() + 1)">
            Завершить звонок
          </button>
        </div>
        <p class="hint" role="status" id="click-count">Нажатий в демонстрации: {{ count() }}</p>
        <div class="states">
          <div><button kvaPainted>Обычная</button><small>По умолчанию</small></div>
          <div>
            <button kvaPainted aria-pressed="true">Выбрано</button><small>Активное состояние</small>
          </div>
          <div>
            <button kvaPainted disabled id="disabled" (click)="count.set(count() + 1)">
              Недоступно</button
            ><small>Disabled</small>
          </div>
          <div>
            <button kvaPainted [loading]="busy()" id="loading" (click)="load()">Подключиться</button
            ><small>Нажмите для загрузки</small>
          </div>
        </div>
      </section>
      <section>
        <div class="section-head">
          <h2>Вечерняя компания</h2>
          <span>Демонстрация панели звонка</span>
        </div>
        <div class="kva-painted-panel callbar">
          <div class="call-title"><strong>Свои на связи</strong><span>Голосовой чат</span></div>
          <div class="row controls">
            <button
              kvaPainted
              iconOnly
              size="lg"
              aria-label="Наушники"
              [attr.aria-pressed]="sound()"
              (click)="sound.set(!sound())"
            >
              <kva-painted-glyph [name]="sound() ? 'headphones' : 'soundOff'" />
            </button>
            <button
              kvaPainted
              iconOnly
              size="lg"
              aria-label="Микрофон"
              id="mic-toggle"
              [attr.aria-pressed]="mic()"
              (click)="mic.set(!mic())"
            >
              <kva-painted-glyph [name]="mic() ? 'mic' : 'micOff'" />
            </button>
            <button
              kvaPainted
              iconOnly
              size="lg"
              aria-label="Камера"
              [attr.aria-pressed]="camera()"
              (click)="camera.set(!camera())"
            >
              <kva-painted-glyph [name]="camera() ? 'camera' : 'cameraOff'" />
            </button>
            <button
              kvaPainted
              iconOnly
              size="lg"
              aria-label="Демонстрация экрана"
              [attr.aria-pressed]="screen()"
              (click)="screen.set(!screen())"
            >
              <kva-painted-glyph name="screen" />
            </button>
            <button
              kvaPainted
              iconOnly
              size="lg"
              aria-label="Участники"
              (click)="count.set(count() + 1)"
            >
              <kva-painted-glyph name="groups" />
            </button>
            <button
              kvaPainted
              iconOnly
              size="lg"
              variant="danger"
              aria-label="Завершить демонстрацию звонка"
              (click)="mic.set(false); camera.set(false); screen.set(false); sound.set(false)"
            >
              <kva-painted-glyph name="hangup" />
            </button>
          </div>
        </div>
        <p class="hint">
          Микрофон {{ mic() ? 'включён' : 'выключен' }} · Камера
          {{ camera() ? 'включена' : 'выключена' }}. Реального подключения здесь нет.
        </p>
      </section>
      <section>
        <div class="section-head">
          <h2>Чёткие знаки в маленьком размере</h2>
          <span>{{ glyphNames.length }} SVG</span>
        </div>
        <label class="kit-search"
          >Найти значок по имени
          <input
            type="search"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
            placeholder="search, reply, calendar…"
          />
        </label>
        <p class="hint">
          Размеры слева направо: 16, 20, 24, 32, 48 px. Цвет наследуется от кнопки.
        </p>
        <div class="glyph-grid">
          @for (name of filteredGlyphs(); track name) {
            <figure>
              <div class="glyph-sizes">
                @for (size of [16, 20, 24, 32, 48]; track size) {
                  <kva-painted-glyph
                    [name]="name"
                    [style.width.px]="size"
                    [style.height.px]="size"
                  />
                }
              </div>
              <figcaption>{{ name }}</figcaption>
            </figure>
          } @empty {
            <p>Иконок с таким именем нет.</p>
          }
        </div>
      </section>
      <section id="new-controls">
        <h2>Плотные панели и понятные действия</h2>
        <p class="hint">Примеры управления библиотекой. Данные приложения не изменяются.</p>
        <div class="workbench">
          <div class="control-example">
            <h3>Сообщение</h3>
            <p>Встречаемся вечером. Прикреплю материалы сюда.</p>
            <div class="row compact-toolbar" aria-label="Действия с примером сообщения">
              @for (action of messageActions; track action.name) {
                <button
                  kvaPainted
                  variant="quiet"
                  iconOnly
                  size="sm"
                  [attr.aria-label]="action.label"
                  [title]="action.label"
                  (click)="notice.set(action.label + ': пример действия')"
                >
                  <kva-painted-glyph [name]="action.name" />
                </button>
              }
            </div>
          </div>
          <div class="control-example">
            <h3>Документ</h3>
            <div class="row compact-toolbar">
              <button
                kvaPainted
                variant="quiet"
                size="sm"
                [attr.aria-pressed]="wrap()"
                (click)="wrap.set(!wrap())"
                id="wrap-toggle"
              >
                <kva-painted-glyph name="wrap" />Перенос строк
              </button>
              <button
                kvaPainted
                variant="quiet"
                iconOnly
                size="sm"
                aria-label="Скопировать пример"
                title="Скопировать пример"
                (click)="notice.set('Копирование: пример действия')"
              >
                <kva-painted-glyph name="copy" />
              </button>
              <button
                kvaPainted
                variant="quiet"
                iconOnly
                size="sm"
                aria-label="Скачать пример"
                title="Скачать пример"
                (click)="notice.set('Скачивание: пример действия')"
              >
                <kva-painted-glyph name="download" />
              </button>
            </div>
            <pre [class.wrap-code]="wrap()">
const company = ['Квак', 'Жабик', 'Лиля', 'Болот'];</pre>
          </div>
          <div class="control-example">
            <h3>Разделы</h3>
            <div class="row" role="group" aria-label="Пример переключения разделов">
              @for (item of sections; track item.name) {
                <button
                  kvaPainted
                  variant="tab"
                  size="sm"
                  [attr.aria-pressed]="section() === item.name"
                  (click)="section.set(item.name)"
                >
                  <kva-painted-glyph [name]="item.name" />{{ item.label }}
                </button>
              }
            </div>
            <p class="hint">
              Выбрано: {{ section() === 'applications' ? 'Приложения' : 'Предметы' }}
            </p>
          </div>
          <div class="control-example menu-example">
            <h3>Меню профиля</h3>
            <button
              kvaPainted
              variant="menu"
              size="sm"
              (click)="notice.set('Пример настроек оформления')"
            >
              <kva-painted-glyph name="appearance" />Оформление
            </button>
            <button
              kvaPainted
              variant="menu"
              size="sm"
              (click)="notice.set('Пример настроек безопасности')"
            >
              <kva-painted-glyph name="lock" />Безопасность
            </button>
            <button
              kvaPainted
              variant="menu"
              size="sm"
              (click)="notice.set('Пример выхода из аккаунта')"
            >
              <kva-painted-glyph name="logout" />Выйти
            </button>
          </div>
        </div>
        <p role="status" id="kit-notice">{{ notice() }}</p>
        <div class="row">
          <button kvaPainted variant="quiet" disabled>Недоступно</button>
          <button kvaPainted variant="quiet" [loading]="busy()" (click)="load()">
            Обновить список
          </button>
          <button
            kvaPainted
            variant="danger"
            (click)="notice.set('Удаление: сначала подтверждение с названием объекта')"
          >
            <kva-painted-glyph name="trash" />Удалить сообщение
          </button>
        </div>
      </section>
      <section class="light-sample" id="light-controls">
        <h2>Компактные элементы на светлом фоне</h2>
        <div class="row">
          <button kvaPainted variant="quiet"><kva-painted-glyph name="search" />Найти</button>
          <button kvaPainted variant="tab" aria-pressed="true">
            <kva-painted-glyph name="applications" />Приложения
          </button>
          <button kvaPainted variant="quiet" disabled>Недоступно</button>
          @for (name of ['applications', 'inventory', 'gift', 'calendar']; track name) {
            <kva-painted-art [name]="$any(name)" [size]="64" basePath="./assets/" />
          }
        </div>
      </section>
      <section id="migration">
        <h2>Старый знак → новый знак</h2>
        <p class="hint">
          {{ migration.length }} имён старого набора покрыты. Число под значком — статические ссылки
          в исходниках; динамические ссылки перечислены в карте отдельно.
        </p>
        <div class="migration-grid">
          @for (item of migration; track item.name) {
            <figure>
              <div class="comparison">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path [attr.d]="item.oldPath" /></svg
                ><span aria-hidden="true">→</span><kva-painted-glyph [name]="item.name" />
              </div>
              <figcaption>{{ item.name }}</figcaption>
              <small>{{ item.count }} мест · готово</small>
            </figure>
          }
        </div>
        <p>
          «Приложения» получат applications вместо inventory. Реакции пользователей и игровые
          рисунки сохраняются.
        </p>
      </section>
      <section>
        <h2>Размеры и длинные подписи</h2>
        <div class="row sizes">
          <button kvaPainted size="sm">44 px</button><button kvaPainted>52 px</button
          ><button kvaPainted size="lg">64 px</button
          ><button kvaPainted variant="secondary">
            Пригласить друзей в нашу вечернюю компанию
          </button>
        </div>
        <div class="row sizes">
          @for (size of [48, 64, 96, 128]; track size) {
            <figure>
              <kva-painted-art name="headphones" [size]="size" basePath="./assets/" />
              <figcaption>{{ size }} px</figcaption>
            </figure>
          }
        </div>
      </section>
      <section class="light-sample">
        <h2>На светлом фоне</h2>
        <div class="row">
          <kva-painted-art name="friends" [size]="128" basePath="./assets/" /><button kvaPainted>
            Позвать друзей</button
          ><button kvaPainted variant="secondary">Войти</button
          ><button kvaPainted iconOnly aria-label="Настройки">
            <kva-painted-glyph name="settings" />
          </button>
        </div>
      </section>
      <section>
        <h2>Эталон оформления</h2>
        <details>
          <summary>Открыть исходный референс</summary>
          <img
            class="reference"
            src="./reference.png"
            alt="Согласованный рисованный набор Квачата"
            loading="lazy"
          />
        </details>
      </section>
      <section class="verification">
        <h2>Поведение в форме</h2>
        <form (submit)="$event.preventDefault(); submits.set(submits() + 1)">
          <div class="row">
            <button kvaPainted id="form-default">Обычная кнопка</button
            ><button kvaPainted type="submit" id="form-submit">Отправить</button
            ><button
              kvaPainted
              iconOnly
              [loading]="busy()"
              aria-label="Пробное подключение"
              (click)="load()"
            >
              <kva-painted-glyph name="mic" />
            </button>
          </div>
          <p id="submit-count">Отправок: {{ submits() }}</p>
        </form>
      </section>
    </main>
    <footer>Квачат · Набор для последующего подключения к интерфейсу</footer>
  `,
})
class PaintedDemo {
  readonly artNames = PAINTED_ART_NAMES;
  readonly labels = [
    'Комната',
    'Друзья',
    'Группы',
    'Площадки',
    'Сообщения',
    'Документы',
    'Микрофон',
    'Наушники',
    'Камера',
    'Экран',
    'Уведомления',
    'Настройки',
    'Приложения',
    'Предметы',
    'Магазин',
    'Подарок',
    'Оформление',
    'Профиль',
    'Безопасность',
    'Календарь',
  ];
  readonly glyphNames = Object.keys(PAINTED_GLYPHS) as PaintedGlyphName[];
  readonly query = signal('');
  readonly filteredGlyphs = computed(() =>
    this.glyphNames.filter((name) =>
      name.toLowerCase().includes(this.query().trim().toLowerCase()),
    ),
  );
  readonly migration = MIGRATION;
  readonly wrap = signal(false);
  readonly section = signal('applications');
  readonly notice = signal('Попробуйте кнопки в примерах.');
  readonly messageActions: { name: PaintedGlyphName; label: string }[] = [
    { name: 'reply', label: 'Ответить' },
    { name: 'edit', label: 'Редактировать' },
    { name: 'copy', label: 'Копировать' },
    { name: 'pin', label: 'Закрепить' },
    { name: 'emoji', label: 'Добавить реакцию' },
  ];
  readonly sections: { name: PaintedGlyphName; label: string }[] = [
    { name: 'applications', label: 'Приложения' },
    { name: 'inventory', label: 'Предметы' },
  ];
  readonly count = signal(0);
  readonly submits = signal(0);
  readonly busy = signal(false);
  readonly mic = signal(true);
  readonly camera = signal(false);
  readonly screen = signal(false);
  readonly sound = signal(true);
  load() {
    this.busy.set(true);
    setTimeout(() => this.busy.set(false), 1200);
  }
}
bootstrapApplication(PaintedDemo).catch(console.error);
