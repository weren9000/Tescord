import {Component, DestroyRef, inject, input, output, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {HttpClient, HttpErrorResponse} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';
import {AssetPreviewComponent} from './asset-preview.component';

interface Entry {id:string;name:string;kind:string}
export interface StoreCollection {
 id:string;name:string;artwork?:'neon'|'forest'|null;description:string;cover_id:string;published:boolean;position:number;version:number;total:number;items?:Entry[];
}
@Component({
 selector:'app-store-collections',standalone:true,imports:[FormsModule,AssetPreviewComponent],
 template:`
 @if(error()){<p role="alert">{{error()}}</p>}
 @if(editing();as group){
  <form (ngSubmit)="save()">
   <div class="bar"><button type="button" [disabled]="busy()" (click)="editing.set(null)">← Подборки</button><button class="primary" [disabled]="busy()||!group.name.trim()||!group.cover_id||!selected().length">{{busy()?'Сохраняем…':'Сохранить подборку'}}</button></div>
   <div class="fields">
    <label>Название<input name="name" [(ngModel)]="group.name" maxlength="80" required [disabled]="busy()"/></label>
    <label>Описание<input name="description" [(ngModel)]="group.description" maxlength="180" [disabled]="busy()"/></label>
    <label>Порядок<input name="position" type="number" min="0" max="100000" [(ngModel)]="group.position" [disabled]="busy()"/></label>
    <label>Оформление баннера<select name="artwork" [(ngModel)]="group.artwork" [disabled]="busy()"><option [ngValue]="null">Изображение предмета</option><option value="neon">Неоновая ночь</option><option value="forest">Лесные друзья</option></select></label><label>Предмет для обложки<select name="cover" [(ngModel)]="group.cover_id" [disabled]="busy()"><option value="">Выберите предмет</option>@for(e of selected();track e.id){<option [value]="e.id">{{e.name}}</option>}</select></label>
    <label class="check"><input name="published" type="checkbox" [(ngModel)]="group.published" [disabled]="busy()"/>Показывать в магазине</label>
   </div>
  </form>
  <h4>Состав · {{selected().length}} / 200</h4>
  <div class="chips">@for(e of selected();track e.id){<button [disabled]="busy()" [attr.aria-label]="'Убрать '+e.name" (click)="toggle(e)">{{e.name}} ×</button>}</div>
  <form class="bar" (ngSubmit)="page=1;search()"><input name="search" aria-label="Поиск предметов для подборки" [(ngModel)]="q" maxlength="80" placeholder="Найти предмет…"/><button [disabled]="busy()">Найти</button></form>
  <div class="choices">@for(e of entries();track e.id){<button [class.selected]="contains(e.id)" [attr.aria-pressed]="contains(e.id)" [disabled]="busy()||(!contains(e.id)&&selected().length>=200)" (click)="toggle(e)"><app-asset-preview [src]="image(e.id)"/><span>{{e.name}}</span><b>{{contains(e.id)?'✓':'+'}}</b></button>}</div>
  <div class="bar"><button [disabled]="page<=1||busy()" (click)="page=page-1;search()">←</button><span>{{page}} / {{pages()}}</span><button [disabled]="page>=pages()||busy()" (click)="page=page+1;search()">→</button></div>
 }@else{
  <div class="bar"><p>Обложка и товары берутся из каталога. Пустые подборки не показываются покупателям.</p><button class="primary" (click)="edit()">+ Создать подборку</button></div>
  @for(g of groups();track g.id){<button class="collection-row" (click)="edit(g)"><img [src]="image(g.cover_id)" alt=""/><span><strong>{{g.name}}</strong><small>{{g.total}} предметов · {{g.published?'Опубликована':'Черновик'}}</small></span><span>Изменить →</span></button>}
  @if(!groups().length&&!busy()){<p>Создайте первую подборку для баннера витрины.</p>}
 }
 `,
 styles:[`
 :host{display:block;color:var(--palette-text)}*{box-sizing:border-box}button,input,select{font:inherit;font-size:13px;color:inherit;background:var(--palette-raised);border:1px solid var(--palette-border);border-radius:8px;padding:9px;min-height:40px}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--palette-primary)}.primary,.selected{background:var(--palette-selected);color:var(--palette-primary-text)}.bar{display:flex;gap:10px;align-items:center;justify-content:space-between;margin:14px 0;flex-wrap:wrap}.bar input{flex:1;min-width:120px}.bar p{flex:1;min-width:200px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:grid;gap:6px;font-size:12px}.check{display:flex;align-items:center}.check input{min-height:0}.chips{display:flex;gap:6px;flex-wrap:wrap}.chips button{font-size:11px}.choices{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.choices button{display:grid;gap:6px;text-align:left;position:relative}.choices app-asset-preview{display:block;width:100%;aspect-ratio:1}.choices b{position:absolute;top:5px;right:5px;background:var(--palette-surface);padding:4px;border-radius:4px}.collection-row{width:100%;display:flex;gap:16px;align-items:center;text-align:left;margin:10px 0}.collection-row>span:nth-child(2){flex:1}.collection-row img{width:90px;height:60px;object-fit:cover;border-radius:6px}small{display:block;color:var(--palette-muted);margin-top:6px}p{font-size:13px;color:var(--palette-muted)}p[role=alert]{color:var(--palette-danger,var(--palette-text))}@media(max-width:700px){.fields{grid-template-columns:1fr}.choices{grid-template-columns:repeat(3,minmax(0,1fr))}.collection-row{flex-wrap:wrap}.collection-row>span:last-child{font-size:11px}}
 `]
})
export class StoreCollectionsComponent {
 readonly token=input.required<string>();readonly changed=output<void>();
 readonly groups=signal<StoreCollection[]>([]);readonly editing=signal<StoreCollection|null>(null);
 readonly selected=signal<Entry[]>([]);readonly entries=signal<Entry[]>([]);readonly pages=signal(1);
 readonly error=signal('');readonly busy=signal(false);q='';page=1;
 private readonly http=inject(HttpClient);private alive=true;private searchVersion=0;
 constructor(){inject(DestroyRef).onDestroy(()=>{this.alive=false;++this.searchVersion;});}
 ngOnInit(){void this.refresh();}
 private request<T>(path:string,method='GET',body?:unknown){return firstValueFrom(this.http.request<T>(method,API_BASE_URL+'/api/shop/admin/'+path,{body,headers:{Authorization:'Bearer '+this.token()}}));}
 image(id:string){return API_BASE_URL+'/api/inventory/assets/'+encodeURIComponent(id)+'?preview=true';}
 contains(id:string){return this.selected().some(e=>e.id===id);}
 toggle(e:Entry){const remove=this.contains(e.id);this.selected.update(a=>remove?a.filter(i=>i.id!==e.id):[...a,e]);const group=this.editing();if(group&&remove&&group.cover_id===e.id)group.cover_id='';}
 private fail(e:unknown){this.error.set(e instanceof HttpErrorResponse&&typeof e.error?.detail==='string'?e.error.detail:'Не удалось загрузить или сохранить подборку. Повторите попытку.');}
 async refresh(){this.busy.set(true);try{const data=await this.request<StoreCollection[]>('collections');if(this.alive)this.groups.set(data);}catch(e){if(this.alive)this.fail(e);}finally{if(this.alive)this.busy.set(false);}}
 edit(group?:StoreCollection){this.error.set('');this.editing.set(group?{...group}:{id:crypto.randomUUID(),name:'',description:'',artwork:null,cover_id:'',published:false,position:0,version:0,total:0});this.selected.set([...(group?.items??[])]);this.q='';this.page=1;void this.search();}
 async search(){const version=++this.searchVersion;try{const data=await this.request<{items:Entry[];pages:number;page:number}>('offers?'+new URLSearchParams({q:this.q,page:String(this.page)}));if(this.alive&&version===this.searchVersion){this.entries.set(data.items);this.pages.set(data.pages);this.page=data.page;}}catch(e){if(this.alive&&version===this.searchVersion)this.fail(e);}}
 async save(){const group=this.editing();if(!group||this.busy())return;this.busy.set(true);this.error.set('');try{await this.request('collections/'+group.id,'PUT',{...group,items:this.selected().map(e=>e.id)});if(!this.alive)return;this.editing.set(null);await this.refresh();this.changed.emit();}catch(e){if(this.alive)this.fail(e);}finally{if(this.alive)this.busy.set(false);}}
}
