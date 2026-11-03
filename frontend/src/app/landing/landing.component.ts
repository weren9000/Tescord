import { Component, computed, signal, ElementRef, inject, DestroyRef } from '@angular/core';
import { NgStyle } from '@angular/common';
import { APPEARANCE_PALETTES } from './appearance-palettes';
import { UiIconComponent } from '../workspace/ui-icon.component';
import { PaintedButtonComponent, PaintedGlyphComponent } from '../shared/painted-controls';
import { LandingMotionDirective } from './landing-motion.directive';
import { LandingDemoDirective } from './landing-demo.directive';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [
    UiIconComponent,
    NgStyle,
    PaintedButtonComponent,
    PaintedGlyphComponent,
    LandingMotionDirective,
    LandingDemoDirective,
  ],
  templateUrl: './landing.component.html',
  styleUrls: [
    './landing.component.css',
    './cosmic-theme.css',
    '../shared/painted-controls/painted-controls.css',
    './cosmic-motion.css',
    './cosmic-chapters.css',
  ],
  host: { '[class.android]': 'android' },
})
export class LandingComponent {
  readonly space = signal<'room' | 'group' | 'platform'>('room');
  readonly spaceDescription = computed(
    () =>
      ({
        room: 'Встреча по ссылке. Гости могут подключиться без аккаунта — с голосом, камерой и чатом.',
        group: 'Общая переписка, файлы и созвоны для своей компании. Всё обсуждение в одном месте.',
        platform: 'Сообщество с отдельными каналами, участниками и правилами доступа.',
      })[this.space()],
  );
  readonly draftPacked = signal(false);
  readonly wallpaperPrevious = signal('none');
  readonly wallpaperFading = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly destroy = inject(DestroyRef);
  private wallpaperTimer?: ReturnType<typeof setTimeout>;
  private layoutFrame = 0;
  private layoutAnimations: Animation[] = [];
  constructor() {
    this.destroy.onDestroy(() => {
      clearTimeout(this.wallpaperTimer);
      cancelAnimationFrame(this.layoutFrame);
      this.layoutAnimations.forEach((a) => a.cancel());
    });
  }
  selectWallpaper(value: string) {
    clearTimeout(this.wallpaperTimer);
    this.wallpaperPrevious.set(this.wallpaper());
    this.wallpaper.set(value);
    this.wallpaperFading.set(this.host.querySelector('.motion-allowed') !== null);
    this.wallpaperTimer = setTimeout(() => this.wallpaperFading.set(false), 280);
  }
  toggleDemoScreen() {
    this.layoutAnimations.forEach((a) => a.cancel());
    const nodes = [...this.host.querySelectorAll<HTMLElement>('.call-people > div')];
    const before = nodes.map((node) => node.getBoundingClientRect());
    this.demoScreen.update((value) => !value);
    cancelAnimationFrame(this.layoutFrame);
    this.layoutFrame = requestAnimationFrame(() => {
      if (!this.host.querySelector('.motion-allowed')) return;
      this.layoutAnimations = nodes.map((node, i) => {
        const after = node.getBoundingClientRect();
        return node.animate(
          [
            {
              transform: `translate(${before[i].x - after.x}px,${before[i].y - after.y}px) scale(${before[i].width / after.width},${before[i].height / after.height})`,
            },
            { transform: 'none' },
          ],
          { duration: 450, easing: 'cubic-bezier(.2,.7,.2,1)' },
        );
      });
    });
  }
  readonly demoMic = signal(true);
  readonly demoCamera = signal(false);
  readonly demoScreen = signal(false);
  readonly android = /Android/i.test(navigator.userAgent);
  readonly theme = signal<keyof typeof APPEARANCE_PALETTES>('base');
  readonly wallpaper = signal('none');
  readonly previousWallpaperImage = computed(() =>
    this.wallpaperPrevious() === 'none'
      ? 'none'
      : `linear-gradient(rgba(12,16,26,.35),rgba(12,16,26,.35)),url('/assets/landing/${this.wallpaperPrevious()}.webp')`,
  );
  openDraft() {
    this.selectFormat('md');
    this.documentMode.set(true);
    this.host.querySelector('.document-illustration')?.scrollIntoView({
      behavior: this.host.querySelector('.motion-allowed') ? 'smooth' : 'instant',
      block: 'center',
    });
  }
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
