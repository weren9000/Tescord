import {
  afterNextRender,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  OnChanges,
} from '@angular/core';

/** Each illustration gets a single entrance and pauses its ambient CSS animation off screen. */
@Directive({ selector: '[kvaDemo]' })
export class LandingDemoDirective implements OnChanges {
  readonly demoKey = input<unknown>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly destroy = inject(DestroyRef);
  private observer?: IntersectionObserver;
  private entrance?: Animation;
  private ready = false;
  constructor() {
    afterNextRender(() => {
      this.ready = true;
      this.observer = new IntersectionObserver(
        (entries) => {
          const visible = entries[0].isIntersecting;
          this.host.classList.toggle('demo-visible', visible);
          if (visible && !this.host.classList.contains('demo-entered')) {
            this.host.classList.add('demo-entered');
            this.reveal();
          }
        },
        { threshold: 0.15 },
      );
      this.observer.observe(this.host);
    });
    this.destroy.onDestroy(() => {
      this.observer?.disconnect();
      this.entrance?.cancel();
    });
  }
  ngOnChanges() {
    if (this.ready) this.reveal();
  }
  private reveal() {
    this.entrance?.cancel();
    if (!this.host.closest('.motion-allowed') || !this.host.classList.contains('demo-visible'))
      return;
    this.entrance = this.host.animate(
      [
        { opacity: 0.65, transform: 'translateY(12px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' },
    );
  }
}
