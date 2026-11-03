import {
  AfterViewInit,
  Directive,
  ElementRef,
  HostListener,
  OnDestroy,
  inject,
} from '@angular/core';

/** Keyboard behavior for legacy section-based dialogs; close buttons own their actions. */
@Directive({
  selector: 'section.modal',
  standalone: true,
  host: { role: 'dialog', 'aria-modal': 'true', tabindex: '-1' },
})
export class DialogSurfaceDirective implements AfterViewInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private previous: HTMLElement | null = null;
  private static nextId = 0;
  ngAfterViewInit(): void {
    this.previous = document.activeElement as HTMLElement | null;
    const heading = this.element.querySelector<HTMLElement>('h2, h3');
    if (heading && !this.element.hasAttribute('aria-label')) {
      heading.id ||= `surface-heading-${++DialogSurfaceDirective.nextId}`;
      this.element.setAttribute('aria-labelledby', heading.id);
    }
    this.element.focus({ preventScroll: true });
  }
  @HostListener('keydown', ['$event'])
  keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.element
        .querySelector<HTMLButtonElement>('.modal__header button.kva-icon-action:not(:disabled)')
        ?.click();
    } else if (event.key === 'Tab') {
      const nodes = [
        ...this.element.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ),
      ].filter((e) => e.getClientRects().length);
      const first = nodes[0],
        last = nodes.at(-1);
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === this.element)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  ngOnDestroy(): void {
    if (this.previous?.isConnected) this.previous.focus({ preventScroll: true });
  }
}
