import {AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject, input, output, signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';
import {AssetPreviewComponent} from './asset-preview.component';

export interface AvatarChoice {id:string;catalog_id?:string;name?:string;}
@Component({selector:'app-avatar-picker',standalone:true,imports:[AssetPreviewComponent],
 template:`<dialog #dialog aria-label="Выбрать аватар" (cancel)="$event.preventDefault();close.emit()" (keydown)="$event.stopPropagation()">
 <header><h3>Выбрать аватар</h3><button type="button" aria-label="Закрыть выбор аватара" (click)="close.emit()">×</button></header>
 <nav><button type="button" [attr.aria-pressed]="tab()==='presets'" (click)="tab.set('presets')">Готовые</button><button type="button" [attr.aria-pressed]="tab()==='items'" (click)="tab.set('items');load(1)">Из инвентаря</button></nav>
 <div class="choices">
 @if(tab()==='presets') {<div class="grid">@for(preset of presets();track preset.id){<button type="button" [attr.aria-pressed]="!selectedItem() && selectedPreset()===preset.id" (click)="choose.emit({id:preset.id})"><img [src]="presetUrl(preset.id)" alt="" width="80" height="80" loading="lazy"/><span>{{preset.label}}</span></button>}</div>}
 @else { @if(error()){<p role="alert">{{error()}}</p><button type="button" (click)="load(page())">Повторить</button>}
 @if(loading()){<p role="status">Загрузка…</p>}
 <div class="grid">@for(item of items();track item.id){<button type="button" [attr.aria-pressed]="selectedItem()===item.id" (click)="choose.emit(item)"><app-asset-preview [src]="itemUrl(item.catalog_id!)"/><span>{{item.name}}</span></button>}</div>
 @if(!loading()&&!error()&&!items().length){<p>В инвентаре пока нет аватаров.</p>}}
 </div>
 <footer>@if(tab()==='items'){<button type="button" aria-label="Предыдущая страница аватаров" [disabled]="page()===1 || loading()" (click)="load(page()-1)">‹</button><span>{{page()}} / {{pages()}}</span><button type="button" aria-label="Следующая страница аватаров" [disabled]="page()===pages() || loading()" (click)="load(page()+1)">›</button>}<button type="button" (click)="close.emit()">Назад в профиль</button></footer>
 </dialog>`,
 styles:[`dialog{box-sizing:border-box;width:min(560px,calc(100vw - 24px));height:min(590px,calc(100dvh - 32px));max-height:calc(100dvh - 32px);padding:0;border:1px solid var(--palette-border);border-radius:16px;background:var(--palette-surface);color:var(--palette-text);overflow:hidden}dialog[open]{display:flex;flex-direction:column}dialog::backdrop{background:#0008}header,footer,nav{display:flex;align-items:center;gap:8px;padding:14px 18px;flex-shrink:0}header,nav{border-bottom:1px solid var(--palette-border)}header{justify-content:space-between}h3{margin:0;font-size:18px}button{border:1px solid var(--palette-border);border-radius:9px;padding:9px 12px;background:var(--palette-raised);color:inherit;font:inherit;cursor:pointer}button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:2px solid var(--palette-primary);outline-offset:2px}button[aria-pressed=true]{border-color:var(--palette-primary);background:var(--palette-selected)}.choices{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;padding:16px 18px}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.grid button{display:flex;flex-direction:column;align-items:center;gap:6px;padding:5px;min-width:0;background:transparent}.grid img,.grid app-asset-preview{width:100%;height:auto;aspect-ratio:1;border-radius:18%;flex-shrink:0}.grid span{font-size:12px;overflow-wrap:anywhere}.grid button[aria-pressed=true]{background:var(--palette-selected)}footer{border-top:1px solid var(--palette-border);min-height:42px}footer button:last-child{margin-left:auto}@media(max-width:480px){.grid{grid-template-columns:repeat(3,minmax(0,1fr))}}`]
})
export class AvatarPickerComponent implements AfterViewInit,OnDestroy {
 readonly token=input.required<string>();readonly presets=input.required<readonly {id:string;label:string}[]>();
 readonly selectedPreset=input<string|null>(null);readonly selectedItem=input<string|null>(null);
 readonly choose=output<AvatarChoice>();readonly close=output<void>();readonly tab=signal<'presets'|'items'>('presets');
 readonly items=signal<AvatarChoice[]>([]);readonly loading=signal(false);readonly error=signal('');readonly page=signal(1);readonly pages=signal(1);
 private http=inject(HttpClient);private version=0;private opener:HTMLElement|null=null;
 @ViewChild('dialog',{static:true}) dialog!:ElementRef<HTMLDialogElement>;
 ngAfterViewInit(){this.opener=document.activeElement as HTMLElement;this.dialog.nativeElement.showModal();}
 ngOnDestroy(){++this.version;this.dialog.nativeElement.close();if(this.opener?.isConnected)this.opener.focus({preventScroll:true});}
 presetUrl(id:string){return API_BASE_URL+'/api/avatar-presets/'+encodeURIComponent(id);}
 itemUrl(id:string){return API_BASE_URL+'/api/inventory/assets/'+encodeURIComponent(id)+'?preview=true';}
 async load(page:number){const version=++this.version;this.loading.set(true);this.error.set('');
  try{const data=await firstValueFrom(this.http.get<{items:AvatarChoice[];page:number;pages:number}>(API_BASE_URL+'/api/inventory?kind=avatar&page='+page,{headers:{Authorization:'Bearer '+this.token()}}));if(version!==this.version)return;this.items.set(data.items);this.page.set(data.page);this.pages.set(data.pages);}
  catch{if(version===this.version)this.error.set('Не удалось загрузить аватары.');}finally{if(version===this.version)this.loading.set(false);}
 }
}
