import { CELESTIAL_GLYPHS } from '../celestial-glyphs';
import { constellationGlyph } from '../constellation-glyphs';
import { InterfaceStyleService } from '../../workspace/interface-style.service';
import { Component, computed, inject, input } from '@angular/core';
import { PAINTED_GLYPHS, PaintedGlyphName } from './painted-glyphs';

@Component({
  selector: 'kva-painted-glyph',
  standalone: true,
  host: { class: 'kva-painted-glyph', 'aria-hidden': 'true' },
  template: `<svg viewBox="0 0 24 24" aria-hidden="true">
    @if (interfaceStyle.value() === 'constellation') {
      <path [attr.d]="celestial().body" fill="currentColor" fill-rule="evenodd" />
      <path
        [attr.d]="celestial().line"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        [attr.d]="celestial().accent"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    } @else if (interfaceStyle.value() !== 'enamel') {
      <path
        [attr.d]="outline()"
        fill="none"
        stroke="currentColor"
        stroke-width="1.65"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    } @else {
      <path [attr.d]="glyph().body" fill="currentColor" fill-rule="evenodd" />
      <path
        [attr.d]="glyph().line"
        fill="none"
        stroke="currentColor"
        stroke-width="2.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    }
  </svg>`,
  styles:
    ':host{display:inline-flex;width:24px;height:24px;flex-shrink:0}svg{width:100%;height:100%}',
})
export class PaintedGlyphComponent {
  readonly interfaceStyle = inject(InterfaceStyleService);
  readonly celestial = computed(
    () =>
      CELESTIAL_GLYPHS[
        Object.hasOwn(CELESTIAL_GLYPHS, this.name()) ? (this.name() as PaintedGlyphName) : 'more'
      ],
  );
  readonly outline = computed(() =>
    constellationGlyph(
      Object.hasOwn(PAINTED_GLYPHS, this.name()) ? (this.name() as PaintedGlyphName) : 'more',
    ),
  );
  readonly name = input.required<PaintedGlyphName>();
  readonly glyph = computed(() => PAINTED_GLYPHS[this.name()]);
}
