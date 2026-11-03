import { booleanAttribute, Component, computed, input, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'button[kvaPainted]',
  standalone: true,
  template: `@if (loading()) {
      <span class="kva-painted-spinner" aria-hidden="true"></span>
    }
    <ng-content /><span class="kva-painted-preload" aria-hidden="true"></span>`,
  styleUrl: './painted-controls.css',
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'classes()',
    '[disabled]': 'disabled() || loading()',
    '[attr.aria-busy]': 'loading() ? "true" : null',
    '[attr.type]': 'type()',
  },
})
export class PaintedButtonComponent {
  readonly variant = input<'primary' | 'secondary' | 'danger' | 'quiet' | 'tab' | 'menu'>(
    'primary',
  );
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly iconOnly = input(false, { transform: booleanAttribute });
  readonly loading = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly classes = computed(
    () =>
      `kva-painted-button kva-painted-button--${this.variant()} kva-painted-button--${this.size()}${this.iconOnly() ? ' kva-painted-button--round' : ''}`,
  );
}
