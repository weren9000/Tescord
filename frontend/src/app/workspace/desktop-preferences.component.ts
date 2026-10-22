import { AfterViewInit, Component, ElementRef, ViewChild, inject, input, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../core/api/api-base';
import { DesktopPreferencesService, Density } from './desktop-preferences.service';

@Component({
  selector: 'app-desktop-preferences', standalone: true,
  template: `
    @if(!openImmediately()){<button type="button" class="trigger" (click)="dialog.showModal()">Вид</button>}
    <dialog #dialog aria-label="Оформление" (close)="closed.emit()" (click)="backdrop($event, dialog)">
      <header><h2>Оформление</h2><button type="button" aria-label="Закрыть оформление" (click)="dialog.close()">×</button></header>
      @if(token()){
        <label class="range">Тема приложения
          <select aria-label="Тема приложения" [value]="selectedTheme()" [disabled]="loading() || saving()" (change)="setTheme($any($event.target).value)">
            <option value="">Базовая</option>
            @for(theme of themes();track theme.id){<option [value]="theme.id">{{theme.name}}</option>}
          </select>
        </label>
        @if(error()){<p role="alert">{{error()}} <button (click)="loadThemes()" [disabled]="loading() || saving()">Повторить</button></p>}
      }
      <fieldset><legend>Плотность интерфейса</legend>
        @for (option of densities; track option.id) {
          <label class="choice"><input type="radio" name="desktop-density" [value]="option.id" [checked]="preferences.value().density === option.id" (change)="preferences.update({density: option.id})" />{{option.label}}</label>
        }
      </fieldset>
      <label class="range">Размер текста сообщений: {{preferences.value().textSize}} px
        <input type="range" min="13" max="20" step="1" [value]="preferences.value().textSize" (input)="preferences.update({textSize: +$any($event.target).value})" />
      </label>
      <div class="preview" [style.font-size.px]="preferences.value().textSize"><strong>Пример сообщения</strong><p>Своё болото. Свои люди.</p></div>
      @if(platforms()){
      <div class="desktop-widths">
      <label class="range">Ширина списка площадок: {{preferences.value().platformsWidth}} px
        <input aria-label="Ширина списка площадок" type="range" min="180" max="360" step="10" [value]="preferences.value().platformsWidth" (input)="preferences.update({platformsWidth: +$any($event.target).value})" />
      </label>
      <label class="range">Ширина чатов площадки: {{preferences.value().platformChatsWidth}} px
        <input aria-label="Ширина чатов площадки" type="range" min="220" max="460" step="10" [value]="preferences.value().platformChatsWidth" (input)="preferences.update({platformChatsWidth: +$any($event.target).value})" />
      </label>
      <p>В узком окне колонки подстраиваются, оставляя место переписке.</p>
      </div>
      } @else {
      <label class="range desktop-widths">Ширина списка бесед: {{preferences.value().width}} px
        <input type="range" min="220" max="460" step="10" [value]="preferences.value().width" (input)="preferences.update({width: +$any($event.target).value})" />
      </label>
      }
      <footer><button type="button" (click)="preferences.reset()">Сбросить вид</button><button type="button" (click)="dialog.close()">Готово</button></footer>
    </dialog>
  `,
  styles: [`
    @media(max-width:980px){.desktop-widths{display:none}}
    select{box-sizing:border-box;width:100%;min-height:40px;padding:8px 12px;border:1px solid var(--palette-border);border-radius:7px;background:var(--palette-raised);color:var(--palette-text);font:inherit}select:focus-visible{outline:2px solid var(--palette-cyan);outline-offset:2px}button:disabled,select:disabled{opacity:.55;cursor:wait}
    button{font:inherit;color:var(--palette-text);background:var(--palette-raised);border:1px solid var(--palette-border);border-radius:7px;padding:7px 12px;cursor:pointer}
    .trigger{font-size:12px;background:transparent}dialog{box-sizing:border-box;width:min(480px,calc(100vw - 32px));max-height:85dvh;overflow:auto;padding:24px;border:1px solid var(--palette-border);border-radius:14px;background:var(--palette-surface);color:var(--palette-text)}
    dialog::backdrop{background:rgb(0 0 0 / .5)}header,footer{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:19px;margin:0}p{color:var(--palette-muted);font-size:13px;line-height:1.5}fieldset{border:1px solid var(--palette-border);border-radius:8px;margin:20px 0;padding:12px}.choice{display:flex;gap:8px;padding:7px}.range{display:flex;flex-direction:column;gap:12px;margin:20px 0}input{accent-color:var(--palette-primary)}.preview{padding:14px;background:var(--palette-raised);border-radius:8px;line-height:1.5}.preview strong{font-size:12px}.preview p{font-size:inherit;color:var(--palette-text);margin:6px 0}button:focus-visible,input:focus-visible{outline:2px solid var(--palette-cyan);outline-offset:2px}
  `],
})
export class DesktopPreferencesComponent implements AfterViewInit {
  readonly platforms=input(false);
  readonly openImmediately=input(false);
  readonly token=input('');
  readonly closed=output<void>();
  readonly changed=output<void>();
  readonly themes=signal<{id:string;name:string;equipped:boolean}[]>([]);
  readonly selectedTheme=signal('');
  readonly loading=signal(false);
  readonly saving=signal(false);
  readonly error=signal('');
  private readonly http=inject(HttpClient);
  @ViewChild('dialog') dialog!:ElementRef<HTMLDialogElement>;
  ngAfterViewInit(){if(this.openImmediately())this.dialog.nativeElement.showModal();if(this.token())queueMicrotask(()=>void this.loadThemes());}
  async loadThemes(){
    this.loading.set(true);this.error.set('');
    try{
      const items:{id:string;name:string;equipped:boolean}[]=[];
      for(let page=1,pages=1;page<=pages;page++){
        const data=await firstValueFrom(this.http.get<{items:typeof items;pages:number}>(API_BASE_URL+'/api/inventory',{headers:{Authorization:'Bearer '+this.token()},params:{kind:'theme',page}}));
        items.push(...data.items);pages=data.pages;
      }
      this.themes.set(items);this.selectedTheme.set(items.find(x=>x.equipped)?.id??'');
    }catch{this.error.set('Не удалось загрузить темы.');}finally{this.loading.set(false);}
  }
  async setTheme(id:string){
    if(this.saving()||this.loading())return;
    this.saving.set(true);this.error.set('');
    try{
      await firstValueFrom(this.http.post(API_BASE_URL+'/api/inventory/'+(id?'items/'+id+'/equip':'theme/reset'),{request_id:crypto.randomUUID()},{headers:{Authorization:'Bearer '+this.token()}}));
      this.selectedTheme.set(id);this.changed.emit();
    }catch{this.error.set('Не удалось применить тему.');this.dialog.nativeElement.querySelector('select')!.value=this.selectedTheme();}
    finally{this.saving.set(false);}
  }
  readonly preferences = inject(DesktopPreferencesService);
  readonly densities: {id: Density; label: string}[] = [{id:'compact',label:'Компактная'},{id:'normal',label:'Обычная'},{id:'spacious',label:'Просторная'}];
  backdrop(event: MouseEvent, dialog: HTMLDialogElement): void {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  }
}
