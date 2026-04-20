import { Directive, ElementRef, Input, OnChanges, OnDestroy, inject } from '@angular/core';

import { prepareInlineMediaElement } from './media-device.utils';

@Directive({
  selector: 'video[appMediaStreamSrc], audio[appMediaStreamSrc]',
  standalone: true,
})
export class MediaStreamSrcDirective implements OnChanges, OnDestroy {
  private readonly elementRef = inject(ElementRef<HTMLMediaElement>);

  @Input({ alias: 'appMediaStreamSrc' }) stream: MediaStream | null = null;
  @Input() appMediaStreamMuted = false;

  ngOnChanges(): void {
    const element = this.elementRef.nativeElement;
    prepareInlineMediaElement(element);
    if (element.srcObject !== this.stream) {
      element.srcObject = this.stream;
    }

    if (element.muted !== this.appMediaStreamMuted) {
      element.muted = this.appMediaStreamMuted;
    }

    if (this.stream) {
      void element.play().catch(() => undefined);
    }
  }

  ngOnDestroy(): void {
    this.elementRef.nativeElement.srcObject = null;
  }
}
