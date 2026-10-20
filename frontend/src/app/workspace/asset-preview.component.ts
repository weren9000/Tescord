import {AfterViewInit, Component, ElementRef, OnDestroy, effect, inject, input, output, signal, untracked} from '@angular/core';
import {CatalogImagesService} from '../core/services/catalog-images.service';

@Component({
 selector:'app-asset-preview', standalone:true,
 template:`@if(visible()&&avatar()){<img class="avatar ready" [class.circular]="circular()" [src]="avatarFailed()?fallback:avatar()" (error)="avatarFailed.set(true)" alt="" decoding="async"/>}
 @if(url()) {<img [src]="url()" [alt]="alt()" width="256" height="256" decoding="async" [class.ready]="loaded()" (load)="loaded.set(true)" (error)="failed.set(true); error.emit()"/>}
 @if(failed()){<span class="status">Не загружено</span>} @else if(!loaded()){<span class="placeholder" aria-hidden="true"></span>}`,
 styles:[`:host{display:block;position:relative;width:100%;aspect-ratio:1;overflow:hidden;border-radius:inherit;background:var(--palette-raised)}img{position:relative;display:block;width:100%;height:100%;object-fit:contain;opacity:0}img.ready{opacity:1}.avatar{position:absolute;height:83%;width:auto;aspect-ratio:1;object-fit:cover;top:8.5%;left:50%;transform:translateX(-50%);border-radius:22%}.avatar.circular{height:76%;top:12%;border-radius:50%}.placeholder{position:absolute;inset:0;background:linear-gradient(130deg,transparent,var(--palette-hover),transparent)}.status{position:absolute;inset:0;display:grid;place-items:center;font:12px system-ui;color:var(--palette-muted);padding:4px}`]
})
export class AssetPreviewComponent implements AfterViewInit, OnDestroy {
 readonly src=input.required<string>(); readonly alt=input(''); readonly retry=input(0); readonly error=output<void>();
 readonly avatar=input<string|null>(null);readonly circular=input(false);readonly url=signal('');
 readonly avatarFailed=signal(false);readonly fallback=new URL('assets/avatar-fallback.webp',document.baseURI).href;
 private readonly images=inject(CatalogImagesService);private version=0;private destroyed=false;
 readonly loaded=signal(false); readonly failed=signal(false); readonly visible=signal(false);
 private observer?:IntersectionObserver; private readonly host=inject(ElementRef<HTMLElement>);
 constructor(){effect(()=>{this.avatar();this.avatarFailed.set(false);});effect(()=>{this.src();this.retry();untracked(()=>{++this.version;this.clearUrl();this.loaded.set(false);this.failed.set(false);this.visible.set(false);queueMicrotask(()=>this.observe());});});}
 private clearUrl(){if(this.url())URL.revokeObjectURL(this.url());this.url.set('');}
 private async show(){
  if(this.visible()||this.destroyed||document.hidden)return;
  this.visible.set(true);this.observer?.disconnect();const version=this.version;
  try{const blob=await this.images.load(this.src());if(!this.destroyed&&version===this.version)this.url.set(URL.createObjectURL(blob));}
  catch{if(!this.destroyed&&version===this.version){this.failed.set(true);this.error.emit();}}
 }
 private readonly resume=()=>{if(!document.hidden&&!this.visible())this.observe();};
 private observe(){
  this.observer?.disconnect();
  if(this.destroyed||!this.host.nativeElement.isConnected)return;
  if(typeof IntersectionObserver==='undefined'){void this.show();return;}
  this.observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))void this.show();},{rootMargin:'160px'});
  this.observer.observe(this.host.nativeElement);
 }
 ngAfterViewInit(){document.addEventListener('visibilitychange',this.resume);this.observe();}
 ngOnDestroy(){this.destroyed=true;++this.version;this.observer?.disconnect();document.removeEventListener('visibilitychange',this.resume);this.clearUrl();}
}
