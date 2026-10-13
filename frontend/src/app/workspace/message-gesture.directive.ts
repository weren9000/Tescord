import {Directive, ElementRef, OnDestroy, inject, output} from '@angular/core';

@Directive({
  selector: '[appMessageGesture]', standalone: true,
  host: {
    '(pointerdown)': 'down($event)', '(pointermove)': 'move($event)',
    '(pointerup)': 'up($event)', '(pointercancel)': 'cancel()',
    '(contextmenu)': 'context($event)', '(click)': 'click($event)',
    '[style.touch-action]': "'pan-y pinch-zoom'",
    '[class.message-card--swipe-ready]': 'ready',
  },
})
export class MessageGestureDirective implements OnDestroy {
  readonly replyGesture = output<void>();
  readonly holdGesture = output<void>();
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private start: {id:number;x:number;y:number} | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private suppressUntil = 0;
  private distance = 0;
  ready = false;

  down(event: PointerEvent): void {
    if (this.start) { this.cancel(); return; }
    if (event.pointerType !== 'touch' || !event.isPrimary || event.button !== 0) return;
    if ((event.target as Element).closest('button,a,input,textarea,video,audio,[role="button"]')) return;
    this.start = {id:event.pointerId,x:event.clientX,y:event.clientY};
    this.timer = setTimeout(() => {
      this.suppressUntil = Date.now()+800;
      this.cancel();
      this.holdGesture.emit();
    }, 500);
  }
  move(event: PointerEvent): void {
    if (!this.start || event.pointerId !== this.start.id) return;
    const dx=event.clientX-this.start.x, dy=event.clientY-this.start.y;
    if (Math.hypot(dx,dy)>10) clearTimeout(this.timer);
    if (Math.abs(dy)>18 && Math.abs(dy)>Math.abs(dx)) { this.cancel(); return; }
    this.distance=dx>0 && Math.abs(dx)>Math.abs(dy)*1.5 ? Math.min(dx,90) : 0;
    this.ready=this.distance>=64;
    // Visual hint without moving content outside the scroll container.
    this.element.style.setProperty('--reply-progress', `${Math.min(this.distance/64,1)}`);
  }
  up(event: PointerEvent): void {
    if (!this.start || event.pointerId!==this.start.id) return;
    const reply=this.ready;
    this.cancel();
    if (reply) { this.suppressUntil=Date.now()+500; this.replyGesture.emit(); }
  }
  context(event: MouseEvent): void {
    if (this.start || Date.now()<this.suppressUntil) event.preventDefault();
  }
  click(event: MouseEvent): void {
    if (Date.now()<this.suppressUntil) { event.preventDefault(); event.stopPropagation(); }
  }
  cancel(): void {
    clearTimeout(this.timer);this.start=null;this.distance=0;this.ready=false;
    this.element.style.removeProperty('--reply-progress');
  }
  ngOnDestroy(): void { this.cancel(); }
}
