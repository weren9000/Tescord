import {Component, ElementRef, OnDestroy, OnInit, inject, input, output, signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {FormsModule} from '@angular/forms';
import {Subscription} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';

interface Emoji {emoji:string;name:string}
interface Group {name:string;items:Emoji[]}
interface Picker {groups:Group[];frequent:string[];defaults:string[]}

@Component({selector:'app-emoji-picker',standalone:true,imports:[FormsModule],host:{'[class.embedded]':'embedded()'},template:`
 <section class="picker" aria-label="Выбор эмодзи" role="region">
  <div class="search"><input type="search" aria-label="Поиск эмодзи" placeholder="Поиск эмодзи" [(ngModel)]="query"/><button type="button" aria-label="Закрыть эмодзи" (click)="close.emit()">×</button></div>
  @if(data();as d){
   <select aria-label="Категория эмодзи" [(ngModel)]="category"><option value="">Все категории</option>@for(group of d.groups;track group.name){<option [value]="group.name">{{group.name}}</option>}</select>
   <div class="scroll">
    @if(!query.trim()&&!category){<section [attr.aria-label]="d.frequent.length?'Частые эмодзи':'Популярные эмодзи'"><h3>{{d.frequent.length?'Частые':'Популярные'}}</h3><div class="grid favorites">@for(item of frequent(d);track item.emoji){<button type="button" [attr.aria-label]="item.name" [title]="item.name" (mousedown)="$event.preventDefault()" (click)="pick(item.emoji)">{{item.emoji}}</button>}</div></section>}
    @for(group of groups();track group.name){<section [attr.aria-label]="group.name"><h3>{{group.name}}</h3><div class="grid">@for(item of group.items;track item.emoji){<button type="button" [attr.aria-label]="item.name" [title]="item.name" (mousedown)="$event.preventDefault()" (click)="pick(item.emoji)">{{item.emoji}}</button>}</div></section>}@empty{<p class="status">Ничего не найдено</p>}
   </div>
  }@else if(error()){<p class="status" role="alert">Не удалось загрузить эмодзи</p><button class="retry" (click)="load()">Повторить</button>}@else{<p class="status" role="status">Загрузка…</p>}
 </section>`,styles:[`
 :host.embedded{position:static;width:100%}:host.embedded .picker{box-shadow:none;border:0;padding:0;max-height:min(380px,65dvh)}:host.embedded .grid{grid-template-columns:repeat(7,minmax(0,1fr))}:host.embedded .grid button{height:32px;font-size:22px}:host{position:absolute;bottom:48px;right:-44px;width:min(330px,calc(100vw - 24px));z-index:30;display:block;color:var(--palette-text)}
 *{box-sizing:border-box}.picker{background:var(--palette-surface);border:1px solid var(--palette-border);border-radius:14px;box-shadow:0 10px 36px #0004;padding:10px;max-height:min(440px,65dvh);display:flex;flex-direction:column;gap:8px;overflow:hidden}
 .search{display:flex;gap:5px;flex:none}input,select{min-width:0;color:inherit;background:var(--palette-raised);border:1px solid var(--palette-border);border-radius:7px;font:inherit;font-size:12px;padding:8px;min-height:36px}input{flex:1;width:0}select{width:100%;flex:none}
 button{font:inherit;color:inherit;cursor:pointer;border:0;border-radius:7px;background:transparent}button:hover{background:var(--palette-hover)}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--palette-primary);outline-offset:-2px}.search button{width:32px;font-size:22px}
 .scroll{overflow:auto;min-height:0;overscroll-behavior:contain;scrollbar-gutter:stable}.grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px;padding:2px}.grid button{height:38px;min-width:0;font-size:24px;padding:0;display:grid;place-items:center;line-height:1;font-family:'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif}.favorites{grid-template-columns:repeat(5,minmax(0,1fr));padding-bottom:8px;border-bottom:1px solid var(--palette-border)}h3{font-size:11px;font-weight:500;color:var(--palette-muted);margin:8px 3px 5px}.status{font-size:12px;color:var(--palette-muted);padding:12px}.retry{min-height:36px}
 @media(max-width:480px){.picker{max-height:min(420px,55dvh)}.grid button{height:40px}.grid{grid-template-columns:repeat(6,minmax(0,1fr))}.favorites{grid-template-columns:repeat(5,minmax(0,1fr))}}
 `]})
export class EmojiPickerComponent implements OnInit,OnDestroy {
 readonly embedded=input(false);readonly token=input.required<string>();readonly choose=output<string>();readonly close=output<void>();
 readonly data=signal<Picker|null>(null);readonly error=signal(false);query='';category='';
 private http=inject(HttpClient);private host=inject<ElementRef<HTMLElement>>(ElementRef);private sub?:Subscription;
 private outside=(event:PointerEvent)=>{if(!(event.target as Element).closest('.composer-emoji'))this.close.emit();};
 private escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();event.preventDefault();this.host.nativeElement.parentElement?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});this.close.emit();}};
 ngOnInit(){this.load();if(this.embedded())return;document.addEventListener('pointerdown',this.outside);document.addEventListener('keydown',this.escape);}
 ngOnDestroy(){this.sub?.unsubscribe();document.removeEventListener('pointerdown',this.outside);document.removeEventListener('keydown',this.escape);}
 load(){this.sub?.unsubscribe();this.error.set(false);this.sub=this.http.get<Picker>(API_BASE_URL+'/api/users/me/emojis',{headers:{Authorization:'Bearer '+this.token()}}).subscribe({next:d=>this.data.set(d),error:()=>this.error.set(true)});}
 groups(){const query=this.query.trim().toLocaleLowerCase('ru').replace(/ё/g,'е');return (this.data()?.groups??[]).filter(g=>!this.category||g.name===this.category).map(g=>({...g,items:g.items.filter(item=>!query||(item.name+' '+item.emoji).toLocaleLowerCase('ru').replace(/ё/g,'е').includes(query))})).filter(g=>g.items.length);}
 frequent(d:Picker){const all=d.groups.flatMap(g=>g.items);return (d.frequent.length?d.frequent:d.defaults).map(emoji=>all.find(item=>item.emoji===emoji)).filter((item):item is Emoji=>!!item);}
 pick(emoji:string){
  // Complete this short request even after the picker closes.
  this.http.post(API_BASE_URL+'/api/users/me/emojis/use',{emoji},{headers:{Authorization:'Bearer '+this.token()}}).subscribe({error:()=>{/* Inserting text must still work if statistics cannot be saved. */}});
  this.choose.emit(emoji);
 }
}
