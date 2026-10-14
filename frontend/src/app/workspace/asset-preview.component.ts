import {AfterViewInit, Component, ElementRef, OnDestroy, effect, inject, input, output, signal} from '@angular/core';

@Component({
 selector:'app-asset-preview', standalone:true,
 template:`@if(visible()) {<img [src]="src()" [alt]="alt()" width="256" height="256" decoding="async" [class.ready]="loaded()" (load)="loaded.set(true)" (error)="failed.set(true); error.emit()"/>}
 @if(failed()){<span class="status">Не загружено</span>} @else if(!loaded()){<span class="placeholder" aria-hidden="true"></span>}`,
 styles:[`:host{display:block;position:relative;width:100%;aspect-ratio:1;overflow:hidden;border-radius:inherit;background:var(--palette-raised)}img{display:block;width:100%;height:100%;object-fit:contain;opacity:0}img.ready{opacity:1}.placeholder{position:absolute;inset:0;background:linear-gradient(130deg,transparent,var(--palette-hover),transparent)}.status{position:absolute;inset:0;display:grid;place-items:center;font:12px system-ui;color:var(--palette-muted);padding:4px}`]
})
export class AssetPreviewComponent implements AfterViewInit, OnDestroy {
 readonly src=input.required<string>(); readonly alt=input(''); readonly retry=input(0); readonly error=output<void>();
 readonly loaded=signal(false); readonly failed=signal(false); readonly visible=signal(false);
 private observer?:IntersectionObserver; private readonly host=inject(ElementRef<HTMLElement>);
 constructor(){effect(()=>{this.src();this.retry();this.loaded.set(false);this.failed.set(false);this.visible.set(false);queueMicrotask(()=>this.observe());});}
 private observe(){
  this.observer?.disconnect();
  if(!this.host.nativeElement.isConnected)return;
  if(typeof IntersectionObserver==='undefined'){this.visible.set(true);return;}
  this.observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){this.visible.set(true);this.observer?.disconnect();}},{rootMargin:'160px'});
  this.observer.observe(this.host.nativeElement);
 }
 ngAfterViewInit(){this.observe();}
 ngOnDestroy(){this.observer?.disconnect();}
}
