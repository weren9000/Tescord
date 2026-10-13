import { Injectable, signal } from '@angular/core';

export type Density = 'compact' | 'normal' | 'spacious';
interface Preferences { density: Density; width: number; collapsed: boolean; textSize: number; }
const defaults: Preferences = { density: 'normal', width: 280, collapsed: false, textSize: 15 };
const key = 'kva.desktop-layout.v1';

@Injectable({ providedIn: 'root' })
export class DesktopPreferencesService {
  readonly value = signal<Preferences>(this.load());
  update(change: Partial<Preferences>): void {
    const next = this.normalize({ ...this.value(), ...change });
    this.value.set(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Private browsing may disable storage. */ }
  }
  reset(): void { this.update(defaults); }
  private load(): Preferences {
    try { return this.normalize(JSON.parse(localStorage.getItem(key) ?? '{}')); } catch { return { ...defaults }; }
  }
  private normalize(value: Partial<Preferences> | null): Preferences {
    const bounded = (n: unknown, min: number, max: number, fallback: number) =>
      typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : fallback;
    return {
      density: ['compact', 'normal', 'spacious'].includes(value?.density ?? '') ? value!.density! : 'normal',
      width: bounded(value?.width, 220, 460, 280),
      collapsed: value?.collapsed === true,
      textSize: bounded(value?.textSize, 13, 20, 15),
    };
  }
}
