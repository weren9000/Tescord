import {Component, OnDestroy, signal} from '@angular/core';

@Component({
  selector: 'app-android-call-output', standalone: true,
  template: `<label>Звук звонка<select aria-label="Звук звонка Android" (change)="choose($any($event.target).value)">
    @for(route of routes(); track route.id){<option [value]="route.id" [selected]="route.selected">{{route.label}}</option>}
    </select></label>@if(error()){<p role="status">{{error()}}</p>}`,
  styles: [':host{display:block}label{display:grid;gap:6px}select{width:100%;padding:10px;background:var(--palette-raised);color:var(--palette-text);border:1px solid var(--palette-border);border-radius:8px;font:inherit}p{font-size:12px;color:var(--palette-muted)}']
})
export class AndroidCallOutputComponent implements OnDestroy {
  readonly routes = signal(window.kvaAndroid?.audioRoutes?.() ?? []);
  readonly error = signal('');
  private timer = window.setInterval(() => this.routes.set(window.kvaAndroid?.audioRoutes?.() ?? []), 1000);
  choose(id: string) {this.error.set(window.kvaAndroid?.selectAudioRoute?.(id) ? '' : 'Не удалось переключить звук. Проверьте подключение устройства.');this.routes.set(window.kvaAndroid?.audioRoutes?.() ?? []);}
  ngOnDestroy() {clearInterval(this.timer);}
}
