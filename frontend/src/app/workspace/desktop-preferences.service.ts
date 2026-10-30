import { Injectable, signal } from '@angular/core';

export type Density = 'compact' | 'normal' | 'spacious';
export type SidebarWidth = 'width' | 'platformsWidth' | 'platformChatsWidth';
interface Preferences {
  density: Density;
  width: number;
  platformsWidth: number;
  platformChatsWidth: number;
  collapsed: boolean;
  textSize: number;
  platformsCollapsed: boolean;
  platformNavigationHidden: boolean;
}
const defaults: Preferences = {
  density: 'normal',
  width: 280,
  platformsWidth: 230,
  platformChatsWidth: 300,
  collapsed: false,
  textSize: 15,
  platformsCollapsed: false,
  platformNavigationHidden: false,
};
const key = 'kva.desktop-layout.v1';

@Injectable({ providedIn: 'root' })
export class DesktopPreferencesService {
  readonly value = signal<Preferences>(this.load());
  update(change: Partial<Preferences>): void {
    const next = this.normalize({ ...this.value(), ...change });
    this.value.set(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Private browsing may disable storage. */
    }
  }
  reset(): void {
    this.update(defaults);
  }
  private load(): Preferences {
    try {
      return this.normalize(JSON.parse(localStorage.getItem(key) ?? '{}'));
    } catch {
      return { ...defaults };
    }
  }
  private normalize(value: Partial<Preferences> | null): Preferences {
    const bounded = (n: unknown, min: number, max: number, fallback: number) =>
      typeof n === 'number' && Number.isFinite(n)
        ? Math.round(Math.min(max, Math.max(min, n)))
        : fallback;
    return {
      density: ['compact', 'normal', 'spacious'].includes(value?.density ?? '')
        ? value!.density!
        : 'normal',
      width: bounded(value?.width, 220, 460, 280),
      platformsWidth: bounded(value?.platformsWidth, 180, 360, 230),
      platformChatsWidth: bounded(value?.platformChatsWidth, 220, 460, 300),
      collapsed: value?.collapsed === true,
      platformsCollapsed: value?.platformsCollapsed === true,
      platformNavigationHidden: value?.platformNavigationHidden === true,
      textSize: bounded(value?.textSize, 13, 20, 15),
    };
  }
}
