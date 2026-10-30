import { Directive, ElementRef, computed, inject, input } from '@angular/core';
import { DesktopPreferencesService } from './desktop-preferences.service';

@Directive({ selector: '[appPlatformNavigation]', exportAs: 'platformNavigation' })
export class PlatformNavigationDirective {
  private readonly preferences = inject(DesktopPreferencesService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly section = input<'platforms' | 'groups' | 'chats'>('platforms');
  private readonly preferenceKey = computed(() =>
    this.section() === 'platforms'
      ? 'platformNavigationHidden'
      : this.section() === 'groups'
        ? 'groupNavigationHidden'
        : 'friendNavigationHidden',
  );
  readonly hidden = computed(() => this.preferences.value()[this.preferenceKey()]);

  toggle(): void {
    const hidden = !this.hidden();
    this.preferences.update({ [this.preferenceKey()]: hidden });
    requestAnimationFrame(() => {
      this.element.nativeElement
        .querySelector<HTMLButtonElement>(
          hidden ? '.platform-navigation-restore' : '.platform-navigation-collapse',
        )
        ?.focus({ preventScroll: true });
    });
  }
}
