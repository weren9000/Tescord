import { Directive, ElementRef, inject } from '@angular/core';
import { DesktopPreferencesService } from './desktop-preferences.service';

@Directive({ selector: '[appPlatformNavigation]', exportAs: 'platformNavigation' })
export class PlatformNavigationDirective {
  private readonly preferences = inject(DesktopPreferencesService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  toggle(): void {
    const hidden = !this.preferences.value().platformNavigationHidden;
    this.preferences.update({ platformNavigationHidden: hidden });
    requestAnimationFrame(() => {
      this.element.nativeElement
        .querySelector<HTMLButtonElement>(
          hidden ? '.platform-navigation-restore' : '.platform-navigation-collapse',
        )
        ?.focus({ preventScroll: true });
    });
  }
}
