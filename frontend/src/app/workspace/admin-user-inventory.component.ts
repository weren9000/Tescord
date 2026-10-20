import {Component, effect, inject, input, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';
interface Item {id:string;name:string;kind:string;rarity:string;copies:number;in_use:boolean}
interface Page {items:Item[];page:number;pages:number;total:number}
@Component({selector:'app-admin-user-inventory',standalone:true,imports:[CommonModule,FormsModule],
 template:`<h3>Инвентарь</h3><form (ngSubmit)="load()"><input name="q" aria-label="Название предмета" placeholder="Название предмета" maxlength="80" [(ngModel)]="q"/><select name="kind" aria-label="Категория предмета" [(ngModel)]="kind" (change)="load()"><option value="">Все категории</option><option value="avatar">Аватары</option><option value="frame">Рамки</option><option value="wallpaper">Обои</option><option value="theme">Темы</option></select><button>Найти</button></form>
 @if(error()){<p role="alert">{{error()}}</p><button (click)="load()">Повторить</button>}
 @if(loading()){<p role="status">Загружаем инвентарь…</p>}
 @if(data();as d){<p>Разных предметов: {{d.total}}</p><div class="items">@for(item of d.items;track item.id){<article><img [src]="asset(item.id)" alt="" width="64" height="64" loading="lazy"/><div><strong>{{item.name}}</strong><p>{{label(item.kind)}} · {{label(item.rarity)}}</p><small>Копий: {{item.copies}} · {{item.in_use?'Используется':'В инвентаре'}}</small></div></article>}@empty{<p>Предметов не найдено.</p>}</div><nav><button [disabled]="loading() || d.page===1" (click)="load(d.page-1)">Назад</button><span>{{d.page}} / {{d.pages}}</span><button [disabled]="loading() || d.page===d.pages" (click)="load(d.page+1)">Далее</button></nav>}`,
 styles:[`:host{display:block}form,nav{display:flex;flex-wrap:wrap;gap:8px;align-items:center}input,select,button{font:inherit;color:inherit;background:var(--palette-raised);border:1px solid var(--palette-border);border-radius:8px;padding:10px;min-width:0}input{flex:1}article{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--palette-border)}article p{font-size:12px}img{object-fit:contain;border-radius:8px}small{color:var(--palette-muted)}nav{margin-top:16px;justify-content:space-between}`]})
export class AdminUserInventoryComponent{
 readonly token=input.required<string>();readonly userId=input.required<string>();
 readonly data=signal<Page|null>(null);readonly loading=signal(false);readonly error=signal('');
 q='';kind='';private version=0;private readonly http=inject(HttpClient);
 constructor(){effect(()=>{this.userId();this.token();this.q='';this.kind='';this.data.set(null);void this.load();});}
 asset(id:string){return API_BASE_URL+'/api/inventory/assets/'+encodeURIComponent(id);}
 label(value:string){return ({avatar:'Аватар',frame:'Рамка',wallpaper:'Обои',theme:'Тема',common:'Обычный',uncommon:'Необычный',rare:'Редкий',epic:'Эпический',legendary:'Легендарный'} as Record<string,string>)[value]??value;}
 async load(page=1){const version=++this.version;this.loading.set(true);this.error.set('');
  try{const data=await firstValueFrom(this.http.get<Page>(API_BASE_URL+'/api/admin/directory/users/'+this.userId()+'/inventory',{params:{q:this.q,kind:this.kind,page},headers:{Authorization:'Bearer '+this.token()}}));if(version===this.version)this.data.set(data);}
  catch{if(version===this.version){this.data.set(null);this.error.set('Не удалось загрузить инвентарь.');}}finally{if(version===this.version)this.loading.set(false);}
 }
}
