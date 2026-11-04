import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

export type InterfaceStyle = 'enamel' | 'constellation' | 'star-atlas';
const storageKey = 'kva.interface-style.v1';

@Injectable({ providedIn: 'root' })
export class InterfaceStyleService {
  private readonly document = inject(DOCUMENT);
  private readonly selected = signal<InterfaceStyle>(this.load());
  readonly value = this.selected.asReadonly();

  constructor() {
    this.apply();
  }

  select(style: InterfaceStyle): void {
    this.selected.set(style);
    this.apply();
    try {
      localStorage.setItem(storageKey, style);
    } catch {
      // The selected style still works when storage is unavailable.
    }
  }

  private apply(): void {
    this.document.documentElement.dataset['uiStyle'] = this.value();
  }

  private load(): InterfaceStyle {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved === 'constellation' || saved === 'star-atlas' ? saved : 'enamel';
    } catch {
      return 'enamel';
    }
  }
}
