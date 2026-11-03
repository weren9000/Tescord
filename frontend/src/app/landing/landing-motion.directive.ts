import {
  afterNextRender,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  NgZone,
  signal,
} from '@angular/core';

/** Decorative motion only: no wheel interception and no work outside the visible scene. */
@Directive({
  selector: '[kvaLandingMotion]',
  exportAs: 'landingMotion',
  host: {
    '[class.motion-enhanced]': 'enhanced()',
    '[class.motion-running]': 'running()',
    '[class.motion-allowed]': 'allowed()',
  },
})
export class LandingMotionDirective {
  readonly enabled = signal(true);
  readonly reduced = signal(false);
  readonly enhanced = signal(false);
  readonly running = signal(false);
  readonly allowed = signal(false);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private readonly destroy = inject(DestroyRef);
  private refresh = () => {};

  constructor() {
    afterNextRender(() => this.zone.runOutsideAngular(() => this.setup()));
  }

  toggle() {
    this.enabled.update((value) => !value);
    try {
      localStorage.setItem('kvachat-landing-motion', this.enabled() ? 'on' : 'off');
    } catch {
      /* Storage can be unavailable. */
    }
    this.refresh();
  }

  private setup() {
    const root = this.element;
    const journey = root.querySelector<HTMLElement>('.cosmic-journey');
    const stage = root.querySelector<HTMLElement>('.cosmic-stage');
    if (!journey || !stage) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const desktop = matchMedia('(min-width: 1101px) and (min-height: 740px) and (pointer: fine)');
    const controller = new AbortController();
    const options = { passive: true, signal: controller.signal };
    let visible = true;
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    try {
      this.enabled.set(localStorage.getItem('kvachat-landing-motion') !== 'off');
    } catch {
      /* Use the default. */
    }
    const render = () => {
      frame = 0;
      if (!this.running() || !desktop.matches) return;
      const bounds = journey.getBoundingClientRect();
      const progress = Math.max(
        0,
        Math.min(1, -bounds.top / Math.max(1, journey.offsetHeight - innerHeight)),
      );
      stage.style.setProperty('--planet-y', `${progress * -52 + pointerY * 4}px`);
      stage.style.setProperty('--planet-x', `${pointerX * 5}px`);
      stage.style.setProperty('--company-y', `${progress * 20 + pointerY * 2}px`);
      stage.style.setProperty('--company-x', `${pointerX * 9}px`);
      stage.style.setProperty('--leaves-y', `${progress * 62 + pointerY * 5}px`);
      stage.style.setProperty('--leaves-x', `${pointerX * 14}px`);
      stage.style.setProperty('--scene-scale', `${1 + progress * 0.025}`);
    };
    const schedule = () => {
      if (this.running() && desktop.matches && !frame) frame = requestAnimationFrame(render);
    };
    const refresh = () => {
      this.reduced.set(reduce.matches);
      this.enhanced.set(desktop.matches && !reduce.matches);
      this.running.set(this.enabled() && !reduce.matches && !document.hidden && visible);
      this.allowed.set(this.enabled() && !reduce.matches && !document.hidden);
      if (!this.allowed())
        root
          .getAnimations({ subtree: true })
          .filter((animation) => !(animation instanceof CSSAnimation))
          .forEach((animation) => animation.cancel());
      if (!this.running() && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (reduce.matches || !desktop.matches) stage.removeAttribute('style');
      schedule();
    };
    this.refresh = refresh;
    const sceneObserver = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      refresh();
    });
    sceneObserver.observe(journey);
    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            if (!reduce.matches && this.enabled())
              entry.target.animate(
                [
                  { opacity: 0.5, transform: 'translateY(16px)' },
                  { opacity: 1, transform: 'none' },
                ],
                { duration: 500, easing: 'cubic-bezier(.2,.7,.2,1)' },
              );
            revealObserver.unobserve(entry.target);
          }
      },
      { threshold: 0.08 },
    );
    root
      .querySelectorAll('main > .section, main > .cosmic-product')
      .forEach((section) => revealObserver.observe(section));
    window.addEventListener('scroll', schedule, options);
    window.addEventListener('resize', refresh, options);
    journey.addEventListener(
      'pointermove',
      (event) => {
        if (!this.running() || !desktop.matches) return;
        const rect = journey.getBoundingClientRect();
        pointerX = (event.clientX - rect.left) / rect.width - 0.5;
        pointerY = (event.clientY - rect.top) / innerHeight - 0.5;
        schedule();
      },
      options,
    );
    journey.addEventListener(
      'pointerleave',
      () => {
        pointerX = pointerY = 0;
        schedule();
      },
      options,
    );
    document.addEventListener('visibilitychange', refresh, options);
    reduce.addEventListener('change', refresh, options);
    desktop.addEventListener('change', refresh, options);
    refresh();
    this.destroy.onDestroy(() => {
      controller.abort();
      sceneObserver.disconnect();
      revealObserver.disconnect();
      cancelAnimationFrame(frame);
      this.refresh = () => {};
      root.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    });
  }
}
