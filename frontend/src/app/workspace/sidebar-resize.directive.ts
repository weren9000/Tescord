import { Directive, ElementRef, inject } from '@angular/core';
import { DesktopPreferencesService } from './desktop-preferences.service';

@Directive({
  selector: '[appSidebarResize]', standalone: true,
  host: {
    'role': 'separator', 'tabindex': '0', 'aria-orientation': 'vertical',
    'aria-label': 'Ширина списка бесед', 'aria-valuemin': '220', 'aria-valuemax': '460',
    '[attr.aria-valuenow]': 'preferences.value().width',
    '(pointerdown)': 'start($event)', '(pointermove)': 'move($event)',
    '(pointerup)': 'end($event)', '(pointercancel)': 'end($event)', '(lostpointercapture)': 'cancel()',
    '(keydown)': 'key($event)', '(dblclick)': 'preferences.update({width: 280})',
  },
})
export class SidebarResizeDirective {
  readonly preferences = inject(DesktopPreferencesService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private drag: { id: number; x: number; width: number } | null = null;
  start(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    this.drag = { id: event.pointerId, x: event.clientX, width: this.preferences.value().width };
    this.element.nativeElement.setPointerCapture(event.pointerId);
  }
  move(event: PointerEvent): void {
    if (this.drag?.id !== event.pointerId) return;
    this.preferences.update({ width: this.drag.width + event.clientX - this.drag.x });
  }
  end(event: PointerEvent): void {
    if (this.drag?.id !== event.pointerId) return;
    this.cancel();
    if (this.element.nativeElement.hasPointerCapture(event.pointerId)) this.element.nativeElement.releasePointerCapture(event.pointerId);
  }
  cancel(): void { this.drag = null; }
  key(event: KeyboardEvent): void {
    const width = this.preferences.value().width;
    const next = event.key === 'ArrowLeft' ? width - 10 : event.key === 'ArrowRight' ? width + 10 : event.key === 'Home' ? 220 : event.key === 'End' ? 460 : null;
    if (next !== null) { event.preventDefault(); this.preferences.update({ width: next }); }
  }
}
