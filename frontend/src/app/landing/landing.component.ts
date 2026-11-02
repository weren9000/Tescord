import { Component, computed, signal } from '@angular/core';
import { NgStyle } from '@angular/common';
import { APPEARANCE_PALETTES } from './appearance-palettes';
import { GuestHeaderComponent } from './guest-header.component';
import { UiIconComponent } from '../workspace/ui-icon.component';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [GuestHeaderComponent, UiIconComponent, NgStyle],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.css',
  host: { '[class.android]': 'android' },
})
export class LandingComponent {
  readonly android = /Android/i.test(navigator.userAgent);
  readonly theme = signal<keyof typeof APPEARANCE_PALETTES>('base');
  readonly wallpaper = signal('none');
  readonly previewPalette = computed(() =>
    Object.fromEntries(
      Object.entries(APPEARANCE_PALETTES[this.theme()]).map(([key, value]) => [
        '--palette-' + key,
        value,
      ]),
    ),
  );
  readonly wallpaperImage = computed(() =>
    this.wallpaper() === 'none'
      ? 'none'
      : `linear-gradient(rgba(12,16,26,.35),rgba(12,16,26,.35)),url('/assets/landing/${this.wallpaper()}.webp')`,
  );
  readonly textSize = signal(15);
  readonly frame = signal(true);
  readonly format = signal<'yaml' | 'py' | 'md'>('yaml');
  readonly wrap = signal(false);
  readonly documentMode = signal(false);
  readonly fileNotice = signal('');
  readonly examples = {
    yaml: {
      name: 'config.yaml',
      text: '# Настройки проекта\nproject:\n  name: evening-club\n  language: ru\n\nserver:\n  host: localhost\n  port: 8080\n\nlogging:\n  level: info',
    },
    py: {
      name: 'example.py',
      text: 'from pathlib import Path\n\ndef read_notes(folder):\n    for path in Path(folder).glob("*.md"):\n        print(path.read_text(encoding="utf-8"))\n\nread_notes("notes")',
    },
    md: {
      name: 'meeting.md',
      text: '# Вечер книжного клуба\n\nВстречаемся в пятницу в 20:00.\n\n## Что обсудим\n\n- Любимые главы\n- Вопросы к финалу\n- Следующую книгу',
    },
  };
  readonly file = computed(() => this.examples[this.format()]);
  readonly fileLines = computed(() => this.file().text.split('\n'));
  private opener: HTMLElement | null = null;
  selectFormat(format: 'yaml' | 'py' | 'md') {
    this.format.set(format);
    this.documentMode.set(false);
    this.fileNotice.set('');
  }
  setTextSize(event: Event) {
    this.textSize.set(Number((event.target as HTMLInputElement).value));
  }
  async copyFile() {
    try {
      await navigator.clipboard.writeText(this.file().text);
      this.fileNotice.set('Скопировано');
    } catch {
      this.fileNotice.set('Не удалось скопировать. Можно скачать файл.');
    }
  }
  downloadFile() {
    const file = this.file();
    const url = URL.createObjectURL(new Blob([file.text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  openPicture(dialog: HTMLDialogElement, event: Event) {
    this.opener = event.currentTarget as HTMLElement;
    dialog.showModal();
  }
  restoreFocus() {
    this.opener?.focus({ preventScroll: true });
  }
}
