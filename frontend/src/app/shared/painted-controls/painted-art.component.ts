import { Component, input } from '@angular/core';
import { PaintedArtName } from './painted-glyphs';

@Component({
  selector: 'kva-painted-art',
  standalone: true,
  template: `<img
    [src]="basePath() + name() + '-256.webp'"
    [srcset]="
      basePath() +
      name() +
      '-128.webp 128w, ' +
      basePath() +
      name() +
      '-256.webp 256w, ' +
      basePath() +
      name() +
      '-512.webp 512w'
    "
    [sizes]="size() + 'px'"
    [width]="size()"
    [height]="size()"
    [alt]="alt()"
    decoding="async"
  />`,
  host: { '[style.width.px]': 'size()', '[style.height.px]': 'size()' },
  styles:
    ':host{display:inline-flex;flex-shrink:0}img{display:block;width:100%;height:100%;object-fit:contain}',
})
export class PaintedArtComponent {
  readonly name = input.required<PaintedArtName>();
  readonly size = input(64);
  readonly alt = input('');
  readonly basePath = input('/assets/painted-controls/');
}
