import { Component, computed, input } from '@angular/core';
import { PAINTED_GLYPHS, PaintedGlyphName } from './painted-glyphs';

@Component({
  selector: 'kva-painted-glyph',
  standalone: true,
  host: { class: 'kva-painted-glyph', 'aria-hidden': 'true' },
  template: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path [attr.d]="glyph().body" fill="currentColor" fill-rule="evenodd" />
    <path
      [attr.d]="glyph().line"
      fill="none"
      stroke="currentColor"
      stroke-width="2.3"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>`,
  styles:
    ':host{display:inline-flex;width:24px;height:24px;flex-shrink:0}svg{width:100%;height:100%}',
})
export class PaintedGlyphComponent {
  readonly name = input.required<PaintedGlyphName>();
  readonly glyph = computed(() => PAINTED_GLYPHS[this.name()]);
}
