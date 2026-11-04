import { CELESTIAL_GLYPHS } from '../shared/celestial-glyphs';
import { constellationGlyph } from '../shared/constellation-glyphs';
import { InterfaceStyleService } from './interface-style.service';
import { Component, computed, inject, input } from '@angular/core';
import { PAINTED_GLYPHS, PaintedGlyphName } from '../shared/painted-controls/painted-glyphs';
// The established selector now renders the shared cosmic glyphs.
@Component({
  selector: 'app-ui-icon',
  standalone: true,
  host: { 'aria-hidden': 'true', class: 'kva-ui-glyph' },
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
  styles: [
    ':host{display:inline-flex;width:20px;height:20px;flex-shrink:0}svg{width:100%;height:100%}',
  ],
})
export class UiIconComponent {
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
  readonly name = input('more');
  readonly glyph = computed(() =>
    Object.hasOwn(PAINTED_GLYPHS, this.name())
      ? PAINTED_GLYPHS[this.name() as PaintedGlyphName]
      : PAINTED_GLYPHS.more,
  );
}
