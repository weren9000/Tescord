import { Directive, ElementRef, inject, input } from '@angular/core';
import { DesktopPreferencesService, SidebarWidth } from './desktop-preferences.service';

@Directive({
  selector: '[appSidebarResize]', standalone: true,
  host: {
    'role': 'separator', 'tabindex': '0', 'aria-orientation': 'vertical',
    '[attr.aria-label]': 'label()', '[attr.aria-valuemin]': 'minimum()', '[attr.aria-valuemax]': 'maximum()',
    '[attr.aria-valuenow]': 'width()',
    '(pointerdown)': 'start($event)', '(pointermove)': 'move($event)',
    '(pointerup)': 'end($event)', '(pointercancel)': 'end($event)', '(lostpointercapture)': 'cancel()',
    '(keydown)': 'key($event)', '(dblclick)': 'reset()',
  },
})
export class SidebarResizeDirective {
  readonly appSidebarResize = input<SidebarWidth>('width');
  width():number {return this.preferences.value()[this.appSidebarResize()];}
  minimum():number {return this.appSidebarResize()==='platformsWidth'?180:220;}
  maximum():number {return this.appSidebarResize()==='platformsWidth'?360:460;}
  label():string {return this.appSidebarResize()==='platformsWidth'?'Ширина списка площадок':this.appSidebarResize()==='platformChatsWidth'?'Ширина чатов площадки':'Ширина списка бесед';}
  private update(width:number):void {this.preferences.update({[this.appSidebarResize()]:width});}
  reset():void {this.update(this.appSidebarResize()==='platformsWidth'?230:this.appSidebarResize()==='platformChatsWidth'?300:280);}
  readonly preferences = inject(DesktopPreferencesService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private drag: { id: number; x: number; width: number } | null = null;
  start(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    this.drag = { id: event.pointerId, x: event.clientX, width: this.element.nativeElement.parentElement?.getBoundingClientRect().width ?? this.width() };
    this.element.nativeElement.setPointerCapture(event.pointerId);
  }
  move(event: PointerEvent): void {
    if (this.drag?.id !== event.pointerId) return;
    this.update(this.drag.width + event.clientX - this.drag.x);
  }
  end(event: PointerEvent): void {
    if (this.drag?.id !== event.pointerId) return;
    this.cancel();
    if (this.element.nativeElement.hasPointerCapture(event.pointerId)) this.element.nativeElement.releasePointerCapture(event.pointerId);
  }
  cancel(): void { this.drag = null; }
  key(event: KeyboardEvent): void {
    const width = this.width();
    const next = event.key === 'ArrowLeft' ? width - 10 : event.key === 'ArrowRight' ? width + 10 : event.key === 'Home' ? this.minimum() : event.key === 'End' ? this.maximum() : null;
    if (next !== null) { event.preventDefault(); this.update(next); }
  }
}
