import { Component, inject } from '@angular/core';
import { DesktopPreferencesService, Density } from './desktop-preferences.service';

@Component({
  selector: 'app-desktop-preferences', standalone: true,
  template: `
    <button type="button" class="trigger" (click)="dialog.showModal()">Вид</button>
    <dialog #dialog aria-labelledby="desktop-settings-title" (click)="backdrop($event, dialog)">
      <header><h2 id="desktop-settings-title">Вид на компьютере</h2><button type="button" aria-label="Закрыть настройки вида" (click)="dialog.close()">×</button></header>
      <p>Настройки сохраняются в этом браузере.</p>
      <fieldset><legend>Плотность интерфейса</legend>
        @for (option of densities; track option.id) {
          <label class="choice"><input type="radio" name="desktop-density" [value]="option.id" [checked]="preferences.value().density === option.id" (change)="preferences.update({density: option.id})" />{{option.label}}</label>
        }
      </fieldset>
      <label class="range">Размер текста сообщений: {{preferences.value().textSize}} px
        <input type="range" min="13" max="20" step="1" [value]="preferences.value().textSize" (input)="preferences.update({textSize: +$any($event.target).value})" />
      </label>
      <div class="preview" [style.font-size.px]="preferences.value().textSize"><strong>Пример сообщения</strong><p>Так будет выглядеть текст в переписке. Остальной интерфейс сохранит свой размер.</p></div>
      <label class="range">Ширина списка бесед: {{preferences.value().width}} px
        <input type="range" min="220" max="460" step="10" [value]="preferences.value().width" (input)="preferences.update({width: +$any($event.target).value})" />
      </label>
      <p>Границу списка можно перетаскивать. Двойной щелчок возвращает стандартную ширину.</p>
      <footer><button type="button" (click)="preferences.reset()">Сбросить настройки</button><button type="button" (click)="dialog.close()">Готово</button></footer>
    </dialog>
  `,
  styles: [`
    button{font:inherit;color:var(--palette-text);background:var(--palette-raised);border:1px solid var(--palette-border);border-radius:7px;padding:7px 12px;cursor:pointer}
    .trigger{font-size:12px;background:transparent}dialog{box-sizing:border-box;width:min(480px,calc(100vw - 32px));max-height:85dvh;overflow:auto;padding:24px;border:1px solid var(--palette-border);border-radius:14px;background:var(--palette-surface);color:var(--palette-text)}
    dialog::backdrop{background:rgb(0 0 0 / .5)}header,footer{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:19px;margin:0}p{color:var(--palette-muted);font-size:13px;line-height:1.5}fieldset{border:1px solid var(--palette-border);border-radius:8px;margin:20px 0;padding:12px}.choice{display:flex;gap:8px;padding:7px}.range{display:flex;flex-direction:column;gap:12px;margin:20px 0}input{accent-color:var(--palette-primary)}.preview{padding:14px;background:var(--palette-raised);border-radius:8px;line-height:1.5}.preview strong{font-size:12px}.preview p{font-size:inherit;color:var(--palette-text);margin:6px 0}button:focus-visible,input:focus-visible{outline:2px solid var(--palette-cyan);outline-offset:2px}
  `],
})
export class DesktopPreferencesComponent {
  readonly preferences = inject(DesktopPreferencesService);
  readonly densities: {id: Density; label: string}[] = [{id:'compact',label:'Компактная'},{id:'normal',label:'Обычная'},{id:'spacious',label:'Просторная'}];
  backdrop(event: MouseEvent, dialog: HTMLDialogElement): void {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  }
}
