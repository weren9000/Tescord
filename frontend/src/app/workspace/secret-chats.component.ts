import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SecretChatsService } from '../core/services/secret-chats.service';
import type { SecretMessage } from '../core/services/secret-engine';
import { UiIconComponent } from './ui-icon.component';

@Component({
  selector: 'app-secret-chats',
  standalone: true,
  imports: [FormsModule, UiIconComponent, DatePipe],
  template: `
    <dialog #dialog aria-labelledby="secret-title" (cancel)="$event.preventDefault(); close()">
      <header>
        <h2 id="secret-title"><app-ui-icon name="lock" />Секретные чаты</h2>
        <button
          type="button"
          aria-label="Закрыть секретные чаты"
          (click)="close()"
          class="kva-icon-action"
        >
          <app-ui-icon name="close" />
        </button>
      </header>
      @if (service.error()) {
        <p class="error" role="alert">{{ service.error() }}</p>
      }
      @if (!service.ready()) {
        <p role="status">
          {{
            service.error()
              ? 'Защищённое устройство недоступно.'
              : 'Подготавливаем защищённое устройство…'
          }}
        </p>
        @if (service.error()) {
          <button type="button" [disabled]="service.busy()" (click)="resetDevice()">
            Начать с новым секретным устройством
          </button>
        }
      } @else if (service.managingDevices()) {
        <section class="device-picker">
          <h3>Мои секретные устройства</h3>
          <p>
            Отключение завершит чаты этого устройства. Уже прочитанные сообщения на других
            устройствах останутся.
          </p>
          @for (device of service.ownDevices(); track device.id) {
            <div>
              <strong>{{ device.name }}</strong> ·
              {{ device.created_at | date: 'dd.MM.yyyy HH:mm' }}
              <button type="button" [disabled]="service.busy()" (click)="revoke(device.id)">
                Отключить устройство
              </button>
            </div>
          }
          <button type="button" (click)="service.managingDevices.set(false)">К списку чатов</button>
        </section>
      } @else if (service.choosingDevice()) {
        <section class="device-picker">
          <h3>Устройство собеседника</h3>
          <p>Переписка будет доступна только на этом и выбранном устройстве.</p>
          @for (device of service.peerDevices(); track device.id) {
            <button type="button" [disabled]="service.busy()" (click)="service.create(device.id)">
              {{ device.name }} <small>{{ device.created_at | date: 'dd.MM.yyyy HH:mm' }}</small>
            </button>
          } @empty {
            <p>
              Собеседник ещё не подключил устройство для секретных чатов. Ему нужно открыть
              обновлённый Квачат.
            </p>
          }
          <button type="button" (click)="service.choosingDevice.set(false)">К списку чатов</button>
        </section>
      } @else {
        <div class="layout" [class.has-chat]="service.active()">
          <nav aria-label="Секретные переписки">
            <p class="hint">
              История хранится на этом устройстве. После выхода из аккаунта восстановить её нельзя.
            </p>
            <button type="button" (click)="service.manageDevices()">Мои устройства</button>
            @for (chat of service.chats(); track chat.id) {
              <button
                type="button"
                class="chat"
                [class.selected]="service.active()?.id === chat.id"
                [disabled]="service.busy()"
                (click)="select(chat)"
              >
                <strong>{{ chat.peer_name }}</strong
                ><small
                  >{{ chat.peer_device_name }} ·
                  {{
                    chat.closed_at
                      ? 'Завершён'
                      : !chat.peer_available
                        ? 'Устройство недоступно'
                        : chat.accepted_at
                          ? 'Секретный чат'
                          : 'Приглашение'
                  }}</small
                >
              </button>
            } @empty {
              <p>Откройте карточку друга и выберите «Начать секретный чат».</p>
            }
          </nav>
          <main>
            @if (service.active(); as chat) {
              <div class="chat-heading">
                <button type="button" class="back" (click)="back()">Назад</button>
                <div>
                  <h3>{{ chat.peer_name }}</h3>
                  <small>{{ chat.peer_device_name }}</small>
                </div>
                @if (!chat.closed_at && chat.peer_available) {
                  <button
                    type="button"
                    class="end-chat"
                    [disabled]="service.busy()"
                    (click)="endChat()"
                  >
                    Завершить чат
                  </button>
                }
              </div>
              @if (chat.closed_at) {
                <p role="status">Чат завершён. Прочитанная история остаётся на этом устройстве.</p>
              } @else if (!chat.peer_available) {
                <p role="status">
                  Устройство собеседника недоступно. Отправка возобновится после его входа.
                </p>
              } @else if (!chat.accepted_at) {
                <p>
                  {{
                    chat.initiator
                      ? 'Ожидаем согласия собеседника.'
                      : 'Вас приглашают в секретный чат на этом устройстве.'
                  }}
                </p>
                @if (!chat.initiator) {
                  <button type="button" [disabled]="service.busy()" (click)="service.accept()">
                    Принять приглашение
                  </button>
                }
              }
              @if (service.fingerprint() && !service.verified()) {
                <section class="verification">
                  <h4>Сверьте код безопасности</h4>
                  <p>Сравните этот код с кодом собеседника лично или по доверенному каналу.</p>
                  <code>{{ service.fingerprint() }}</code>
                  <label
                    ><input type="checkbox" [(ngModel)]="compared" />Мы сравнили коды, они
                    совпадают</label
                  >
                  <button
                    type="button"
                    [disabled]="!compared || service.busy()"
                    (click)="service.verify()"
                  >
                    Подтвердить устройство
                  </button>
                </section>
              }
              @if (service.verified()) {
                <p class="verified">
                  <app-ui-icon name="lock" />Устройство проверено · Сквозное шифрование
                </p>
                <label class="search"
                  >Поиск на устройстве<input
                    type="search"
                    [ngModel]="search()"
                    (ngModelChange)="search.set($event)"
                    placeholder="Найти сообщение"
                /></label>
                <div class="messages" role="log" aria-label="Сообщения секретного чата">
                  @for (message of filtered(); track message.id) {
                    <article [class.own]="message.senderId === service.userId()">
                      @if (message.replyTo) {
                        <blockquote>{{ replyText(message.replyTo) }}</blockquote>
                      }
                      <p>{{ message.text }}</p>
                      @if (message.attachment; as file) {
                        <div class="attachment">
                          <strong>{{ file.name }}</strong
                          ><small>{{ size(file.size) }}</small>
                          <button
                            type="button"
                            [disabled]="service.busy() || !!chat.closed_at || !chat.peer_available"
                            (click)="service.download(file)"
                          >
                            Скачать файл
                          </button>
                          @if (file.size <= 8388608 && isImage(file.type)) {
                            <button
                              type="button"
                              [disabled]="
                                service.busy() || !!chat.closed_at || !chat.peer_available
                              "
                              (click)="service.preview(file)"
                            >
                              Показать фото
                            </button>
                          }
                          @if (service.previews()[file.id]; as url) {
                            <img [src]="url" [alt]="file.name" />
                          }
                        </div>
                      }
                      <small>{{
                        message.pending
                          ? 'Ожидает отправки'
                          : message.senderId === service.userId()
                            ? 'Вы'
                            : chat.peer_name
                      }}</small>
                      @if (!chat.closed_at && chat.peer_available) {
                        <div class="message-actions">
                          <button type="button" (click)="reply = message; edit = null">
                            Ответить
                          </button>
                          @if (message.senderId === service.userId()) {
                            @if (!message.attachment) {
                              <button
                                type="button"
                                [disabled]="service.busy()"
                                (click)="editMessage(message)"
                              >
                                Изменить
                              </button>
                            }
                            <button
                              type="button"
                              [disabled]="service.busy()"
                              (click)="service.remove(message)"
                            >
                              Удалить
                            </button>
                          }
                        </div>
                      }
                    </article>
                  } @empty {
                    <p class="empty">
                      {{
                        search()
                          ? 'Сообщения не найдены в истории этого устройства.'
                          : 'Сообщений пока нет.'
                      }}
                    </p>
                  }
                </div>
                @if (chat.accepted_at && !chat.closed_at && chat.peer_available) {
                  <form (ngSubmit)="send()">
                    @if (reply || edit) {
                      <div class="draft-context">
                        {{ edit ? 'Редактирование' : 'Ответ'
                        }}<button
                          type="button"
                          aria-label="Отменить ответ или редактирование"
                          (click)="reply = null; edit = null"
                          class="kva-icon-action"
                        >
                          <app-ui-icon name="close" />
                        </button>
                      </div>
                    }
                    <label class="sr-only" for="secret-message">Секретное сообщение</label>
                    <textarea
                      id="secret-message"
                      name="message"
                      [(ngModel)]="draft"
                      maxlength="20000"
                      rows="2"
                      placeholder="Секретное сообщение"
                    ></textarea>
                    <div class="compose-actions">
                      <input
                        #fileInput
                        type="file"
                        hidden
                        aria-label="Файл для секретного чата"
                        (change)="upload(fileInput)"
                      />
                      <button type="button" [disabled]="service.busy()" (click)="fileInput.click()">
                        Прикрепить файл
                      </button>
                      <button type="submit" [disabled]="!draft.trim() || service.busy()">
                        Отправить
                      </button>
                    </div>
                  </form>
                }
              }
            } @else {
              <p class="empty">Выберите секретную переписку.</p>
            }
            @if (service.transfer() !== null) {
              <div role="status">
                Передача файла: {{ service.transfer() }}%
                <button type="button" (click)="service.cancelTransfer()">Отменить передачу</button>
              </div>
            }
          </main>
        </div>
      }
    </dialog>
  `,
  styleUrl: './secret-chats.component.scss',
})
export class SecretChatsComponent implements AfterViewInit, OnDestroy {
  readonly service = inject(SecretChatsService);
  @ViewChild('dialog') dialog!: ElementRef<HTMLDialogElement>;
  readonly search = signal('');
  readonly filtered = computed(() =>
    this.service
      .messages()
      .filter((message) =>
        (message.text + ' ' + (message.attachment?.name ?? ''))
          .toLocaleLowerCase()
          .includes(this.search().toLocaleLowerCase()),
      ),
  );
  compared = false;
  draft = '';
  reply: SecretMessage | null = null;
  edit: SecretMessage | null = null;
  ngAfterViewInit(): void {
    this.draft = this.service.drafts.get(this.service.active()?.id ?? '') ?? '';
    this.dialog.nativeElement.showModal();
  }
  ngOnDestroy(): void {
    this.saveDraft();
  }
  resetDevice(): void {
    if (
      window.confirm(
        'Удалить секретные ключи и историю этого аккаунта на устройстве? Восстановить их нельзя.',
      )
    )
      void this.service.resetLocalDevice().catch(() => undefined);
  }
  private saveDraft(): void {
    const id = this.service.active()?.id;
    if (id) this.service.drafts.set(id, this.edit ? '' : this.draft);
  }
  back(): void {
    this.saveDraft();
    this.service.active.set(null);
  }
  close(): void {
    this.dialog.nativeElement.close();
    this.service.close();
  }
  select(chat: Parameters<SecretChatsService['select']>[0]): void {
    this.saveDraft();
    this.compared = false;
    this.search.set('');
    this.reply = null;
    this.edit = null;
    this.draft = this.service.drafts.get(chat.id) ?? '';
    void this.service.select(chat);
  }
  revoke(id: string): void {
    if (window.confirm('Отключить устройство и завершить его секретные чаты?'))
      void this.service.revokeDevice(id);
  }
  endChat(): void {
    if (
      window.confirm(
        'Завершить секретный чат? Новые сообщения и скачивание файлов станут недоступны. Прочитанная история останется на устройствах.',
      )
    )
      void this.service.endChat();
  }
  upload(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.service.upload(file);
  }
  size(bytes: number): string {
    return bytes < 1024 * 1024
      ? Math.ceil(bytes / 1024) + ' КБ'
      : (bytes / 1024 / 1024).toFixed(1) + ' МБ';
  }
  isImage(type: string): boolean {
    return /^image\/(png|jpeg|webp|gif)$/.test(type);
  }
  replyText(id: string): string {
    const message = this.service.messages().find((message) => message.id === id);
    return message
      ? message.text || message.attachment?.name || 'Сообщение'
      : 'Сообщение недоступно';
  }
  editMessage(message: SecretMessage): void {
    this.edit = message;
    this.reply = null;
    this.draft = message.text;
  }
  async send(): Promise<void> {
    if (await this.service.send(this.draft, this.reply?.id, this.edit?.id)) {
      this.draft = '';
      this.reply = null;
      this.edit = null;
    }
  }
}
