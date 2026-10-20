import {Component, DestroyRef, ElementRef, inject, input, signal} from '@angular/core';
import {API_BASE_URL} from '../core/api/api-base';
import {AssetPreviewComponent} from './asset-preview.component';

/** Shared, local-only fitting preview. Never writes profile settings. */
@Component({selector:'app-collectible-preview',standalone:true,imports:[AssetPreviewComponent],template:`
 <div class="preview" [class.wide]="kind()==='theme'||kind()==='wallpaper'">
 @switch(kind()){
  @case('frame'){<div class="framed"><img class="base" [src]="rawAvatar()" alt="Ваш аватар"/><img class="overlay" [src]="image()" [alt]="name()"/></div><small>Примерка на вашей аватарке</small>}
  @case('wallpaper'){<div class="chat" [style.background-image]="'url('+image()+')'"><header>Беседа</header><div class="bubble">Привет! Как тебе оформление?</div><div class="bubble own">Теперь чат выглядит по-новому.</div><footer>Введите сообщение…</footer></div><small>Пример отображения в чате</small>}
  @case('theme'){<app-asset-preview [src]="image()"/><small>Предпросмотр темы · настройки не изменятся</small>}
  @default{<div class="avatar"><app-asset-preview [src]="image()"/></div><div class="sample"><img [src]="image()" alt=""/><span><b>Ваш ник</b><small>Привет, Квачат!</small></span></div>}
 }
 </div>`,styles:[`
 :host{display:block;min-width:0}.preview{display:grid;justify-items:center;gap:18px;padding:24px;border-radius:16px;background:var(--palette-bg,var(--palette-surface));border:1px solid var(--palette-border)}small{font-size:12px;color:var(--palette-muted);text-align:center}.avatar{width:min(200px,100%);aspect-ratio:1;border-radius:22%;overflow:hidden}app-asset-preview{width:100%;display:block}.sample{display:flex;gap:10px;align-items:center}.sample img{width:40px;height:40px;border-radius:22%}.sample span{display:grid;gap:4px;font-size:13px}.framed{position:relative;width:180px;height:180px}.framed img{position:absolute;object-fit:contain}.base{inset:12%;width:76%;height:76%;border-radius:22%}.overlay{inset:0;width:100%;height:100%}.wide{padding:14px}.chat{width:100%;min-height:300px;background-size:cover;background-position:center;display:flex;flex-direction:column;border-radius:10px;overflow:hidden;gap:20px}.chat header,.chat footer{padding:12px;background:color-mix(in srgb,var(--palette-surface) 90%,transparent);font-size:12px}.chat footer{margin-top:auto}.bubble{align-self:flex-start;max-width:75%;margin:0 10px;padding:12px;border-radius:10px;background:color-mix(in srgb,var(--palette-raised) 85%,transparent);font-size:13px}.own{align-self:flex-end}
 `]})
export class CollectiblePreviewComponent {
 private readonly visible=signal(!document.hidden);
 private readonly reduced=signal(matchMedia('(prefers-reduced-motion: reduce)').matches);
 constructor(){
  const element=inject(ElementRef<HTMLElement>).nativeElement;
  const media=matchMedia('(prefers-reduced-motion: reduce)');let inView=true;
  const update=()=>this.visible.set(inView&&!document.hidden);
  const preference=()=>this.reduced.set(media.matches);
  const observer=new IntersectionObserver(entries=>{inView=entries.some(e=>e.isIntersecting);update();});
  observer.observe(element);document.addEventListener('visibilitychange',update);media.addEventListener('change',preference);
  inject(DestroyRef).onDestroy(()=>{observer.disconnect();document.removeEventListener('visibilitychange',update);media.removeEventListener('change',preference);});
 }

 readonly catalogId=input.required<string>();readonly kind=input.required<string>();readonly name=input('');readonly avatarUrl=input<string|null>(null);
 image(){return API_BASE_URL+'/api/inventory/assets/'+encodeURIComponent(this.catalogId())+'?motion='+(this.visible()&&!this.reduced());}
 rawAvatar(){const url=this.avatarUrl();return url?url+(url.includes('?')?'&':'?')+'include_frame=false':API_BASE_URL+'/api/avatar-presets/cat';}
}
