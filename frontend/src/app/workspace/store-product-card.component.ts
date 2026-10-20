import {ChangeDetectionStrategy, Component, input, output} from '@angular/core';
import {DecimalPipe} from '@angular/common';
import {AssetPreviewComponent} from './asset-preview.component';
import type {Offer} from './shop.component';

@Component({
 selector:'app-store-product-card', standalone:true,
 imports:[AssetPreviewComponent,DecimalPipe], changeDetection:ChangeDetectionStrategy.OnPush,
 template:`
 <button class="card" [disabled]="disabled()" (click)="open.emit($event)" [attr.aria-label]="item().name+', '+(item().price??'Цена не задана')">
  <div class="art"><app-asset-preview [src]="src()" [retry]="retry()" (error)="failed.emit()"/>
   @if(item().recommended){<span class="badge">Рекомендуем</span>}
  </div>
  <strong>{{item().name}}</strong><small>{{kindLabel()}}</small>
  <div class="foot">@if(item().price){<span class="price"><img src="/assets/crystal.svg" alt="Кристаллы"/>{{item().price | number}}</span>}@else{<small>Цена не задана</small>}
   @if(item().owned){<small>У вас: {{item().owned}}</small>}
  </div>
  @if(managed()){<small>{{item().status==='published'?'В продаже':item().status==='withdrawn'?'Снято с продажи':'Черновик'}} · Покупок: {{item().sales??0}}</small>}
 </button>`,
 styles:[`
 :host{display:block;min-width:0;height:100%}.card{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:100%;height:100%;padding:9px;border:1px solid var(--palette-border);border-radius:12px;color:var(--palette-text);background:var(--palette-surface);text-align:left;font:inherit;cursor:pointer}
 .card:hover{border-color:var(--palette-primary);background:var(--palette-raised)}.card:focus-visible{outline:2px solid var(--palette-primary);outline-offset:2px}.card:disabled{opacity:.55;cursor:wait}
 .art{position:relative;width:100%;aspect-ratio:1;overflow:hidden;border-radius:9px;background:var(--palette-raised)}app-asset-preview{display:block;width:100%;height:100%}
 strong{font-size:13px;line-height:1.4;overflow-wrap:anywhere}small{font-size:11px;color:var(--palette-muted);line-height:1.4}
 .badge{position:absolute;top:5px;left:5px;max-width:calc(100% - 10px);box-sizing:border-box;background:var(--palette-selected);color:var(--palette-primary-text);border:1px solid var(--palette-border);border-radius:5px;padding:3px 5px;font-size:10px}
 .foot{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:4px;margin-top:auto}.price{display:flex;align-items:center;gap:4px;font-size:12px;font-weight:600}.price img{width:16px;height:16px}
 `]
})
export class StoreProductCardComponent {
 readonly item=input.required<Offer>();readonly src=input.required<string>();readonly kindLabel=input('');
 readonly retry=input(0);readonly disabled=input(false);readonly managed=input(false);
 readonly open=output<Event>();readonly failed=output<void>();
}
