import { Component, ElementRef, ViewChild, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiIconComponent } from './ui-icon.component';

export interface PlatformChoice {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  unread: number;
  mentions: number;
}

@Component({
  selector: 'app-platform-switcher',
  imports: [FormsModule, UiIconComponent],
  template: `
    <button #trigger class="trigger" type="button" aria-label="Выбрать площадку" aria-haspopup="dialog" (click)="show()">
      <span class="avatar">@if (active()?.icon; as icon) {<img [src]="icon" alt="" />} @else {<app-ui-icon name="platforms" />}</span>
      <span class="copy"><small>Текущая площадка</small><strong>{{ active()?.name || 'Выбрать площадку' }}</strong></span>
      <app-ui-icon name="down" />
    </button>
    <dialog #dialog aria-label="Ваши площадки" (click)="onBackdrop($event)" (cancel)="query.set('')" (keydown.escape)="$event.preventDefault(); $event.stopPropagation(); close()">
      <header><div><h2>Ваши площадки</h2><p>Выберите сообщество</p></div><button type="button" class="close" aria-label="Закрыть выбор площадки" (click)="close()">×</button></header>
      <label class="search"><app-ui-icon name="search" /><input #search type="search" aria-label="Найти площадку" placeholder="Найти площадку" [ngModel]="query()" (ngModelChange)="query.set($event)" /></label>
      <div class="choices">
        @for (space of filtered(); track space.id) {
          <button class="choice" [class.selected]="space.id === selected()" [attr.aria-current]="space.id === selected() ? 'true' : null" type="button" (click)="choose(space.id)">
            <span class="avatar">@if (space.icon) {<img [src]="space.icon" alt="" />} @else {<span>{{ space.name.slice(0, 2).toUpperCase() }}</span>}</span>
            <span class="copy"><strong>{{ space.name }}</strong><small>{{ space.description || 'Площадка' }}</small></span>
            @if (space.mentions) {<span class="badge mention" [attr.aria-label]="'Упоминаний: ' + space.mentions">&#64;{{ badge(space.mentions) }}</span>}
            @else if (space.unread) {<span class="badge" [attr.aria-label]="'Непрочитанных: ' + space.unread">{{ badge(space.unread) }}</span>}
            @if (space.id === selected()) {<app-ui-icon name="check" />}
          </button>
        } @empty {<p class="empty">Площадка не найдена. Попробуйте другое название.</p>}
      </div>
      <footer><button type="button" (click)="close(); create.emit()"><app-ui-icon name="plus" />Создать площадку</button></footer>
    </dialog>
  `,
  styleUrl: './platform-switcher.component.scss',
})
export class PlatformSwitcherComponent {
  readonly spaces = input.required<PlatformChoice[]>();
  readonly selected = input<string | null>(null);
  readonly select = output<string>();
  readonly create = output<void>();
  readonly query = signal('');
  readonly active = computed(() => this.spaces().find(space => space.id === this.selected()));
  readonly filtered = computed(() => this.spaces().filter(space => space.name.toLocaleLowerCase('ru').includes(this.query().trim().toLocaleLowerCase('ru'))));
  @ViewChild('dialog') private dialog!: ElementRef<HTMLDialogElement>;
  @ViewChild('trigger') private trigger!: ElementRef<HTMLButtonElement>;
  @ViewChild('search') private search!: ElementRef<HTMLInputElement>;
  badge(count: number): string { return count > 99 ? '99+' : String(count); }
  show(): void { this.query.set(''); this.dialog.nativeElement.showModal(); this.search.nativeElement.focus(); }
  close(): void { this.dialog.nativeElement.close(); this.query.set(''); this.trigger.nativeElement.focus(); }
  choose(id: string): void { this.close(); this.select.emit(id); }
  onBackdrop(event: MouseEvent): void {
    if (event.target !== this.dialog.nativeElement) return;
    const rect = this.dialog.nativeElement.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.close();
  }
}
