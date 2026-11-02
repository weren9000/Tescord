import { Component, input } from '@angular/core';
import { CallEncryption } from '../core/services/call-encryption';

@Component({
  selector: 'app-call-encryption',
  standalone: true,
  template: `@if (session(); as crypto) {
    @let state = crypto.state();
    <section class="call-encryption" aria-label="Шифрование звонка" [attr.data-phase]="state.phase">
      <p role="status">{{ state.detail }}</p>
      @if (state.phase !== 'secure' && state.code) {
        <code aria-label="Код проверки звонка">{{ state.code }}</code>
        @if (state.phase === 'verify' && state.participants > 1) {
          <p>
            До подтверждения звук и видео недоступны собеседникам. Сравните весь код лично или в уже
            проверенном секретном чате.
          </p>
          <button type="button" (click)="crypto.confirm(state.code)">Код совпадает у всех</button>
        }
      }
      @if (state.phase === 'secure') {
        <details>
          <summary>Код проверки</summary>
          <code>{{ state.code }}</code>
        </details>
      }
    </section>
  }`,
  styles: `
    :host {
      display: block;
      min-width: 0;
      flex-shrink: 0;
    }
    .call-encryption {
      padding: 8px 12px;
      background: var(--palette-surface);
      color: var(--palette-text);
      border-bottom: 1px solid var(--palette-border);
      font-size: 12px;
    }
    .call-encryption p {
      margin: 0 0 6px;
    }
    code {
      display: block;
      overflow-wrap: anywhere;
      white-space: normal;
      font-size: 12px;
      user-select: all;
      margin: 6px 0;
    }
    button {
      min-height: 44px;
      max-width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--palette-border);
      border-radius: 8px;
      background: var(--palette-surface-alt, var(--palette-surface));
      color: inherit;
      cursor: pointer;
    }
    summary {
      cursor: pointer;
    }
    button:focus-visible,
    summary:focus-visible {
      outline: 2px solid var(--palette-accent);
      outline-offset: 2px;
    }
  `,
})
export class CallEncryptionComponent {
  readonly session = input<CallEncryption | null>(null);
}
