import {AfterViewInit, Directive, ElementRef, HostListener, OnDestroy, inject} from '@angular/core';

/** Promote nested panels into the browser top layer without moving Angular views. */
@Directive({selector: 'dialog[appModalLayer]', standalone: true})
export class ModalLayerDirective implements AfterViewInit, OnDestroy {
  private static nextId = 0;
  private readonly dialog = inject<ElementRef<HTMLDialogElement>>(ElementRef).nativeElement;
  private origin: HTMLElement | null = null;

  ngAfterViewInit(): void {
    this.origin = document.activeElement as HTMLElement | null;
    const heading = this.dialog.querySelector<HTMLElement>('h3');
    if (heading) {
      heading.id ||= `modal-layer-title-${++ModalLayerDirective.nextId}`;
      this.dialog.setAttribute('aria-labelledby', heading.id);
    }
    this.dialog.showModal();
  }

  @HostListener('cancel', ['$event'])
  cancel(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    // Existing component handlers own state, including pending operations and Back.
    this.dialog.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
  }

  @HostListener('wheel', ['$event'])
  outsideWheel(event: WheelEvent): void {
    if (event.target === this.dialog) event.preventDefault();
  }

  ngOnDestroy(): void {
    this.dialog.close();
    if (this.origin?.isConnected) this.origin.focus({preventScroll: true});
  }
}
