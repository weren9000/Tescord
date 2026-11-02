import { Component, input } from '@angular/core';
import { CallEncryption } from '../core/services/call-encryption';
import { UiIconComponent } from '../workspace/ui-icon.component';

@Component({
  selector: 'app-call-encryption',
  standalone: true,
  imports: [UiIconComponent],
  template: `@if (session(); as crypto) {
    @let state = crypto.state();
    <button
      type="button"
      class="call-encryption"
      [attr.data-phase]="state.phase"
      [attr.aria-label]="state.detail"
      [title]="state.detail"
      [attr.popovertarget]="'call-protection-' + crypto.deviceId"
    >
      <app-ui-icon
        [name]="state.phase === 'secure' ? 'lock' : state.phase === 'error' ? 'info' : 'refresh'"
      />
    </button>
    <div class="call-encryption-detail" [id]="'call-protection-' + crypto.deviceId" popover>
      <p role="status">{{ state.detail }}</p>
    </div>
    <span class="sr-only" role="status">{{ state.detail }}</span>
  }`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      flex: none;
    }
    :host:empty {
      display: none;
    }
    .call-encryption {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      min-height: 44px;
      padding: 0;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--palette-muted);
      cursor: pointer;
    }
    app-ui-icon {
      width: 16px;
      height: 16px;
    }
    [data-phase='secure'] {
      color: var(--palette-cyan);
    }
    [data-phase='error'] {
      color: var(--palette-danger-text);
    }
    .call-encryption:hover {
      background: var(--palette-hover);
    }
    .call-encryption:focus-visible {
      outline: 2px solid var(--palette-cyan);
      outline-offset: 2px;
    }
    .call-encryption-detail {
      max-width: min(300px, calc(100vw - 32px));
      box-sizing: border-box;
      padding: 12px 16px;
      border: 1px solid var(--palette-border);
      border-radius: 12px;
      background: var(--palette-surface);
      color: var(--palette-text);
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    p {
      margin: 0;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }
  `,
})
export class CallEncryptionComponent {
  readonly session = input<CallEncryption | null>(null);
}
