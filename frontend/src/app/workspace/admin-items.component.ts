import {Component,ViewChild,input,output,signal} from '@angular/core';
import {InventoryComponent} from './inventory.component';
import {BatchGrantComponent} from './batch-grant.component';

@Component({selector:'app-admin-items',standalone:true,imports:[InventoryComponent,BatchGrantComponent],
 template:`<nav aria-label="Управление предметами"><button [attr.aria-pressed]="section()==='catalog'" (click)="section.set('catalog')">Каталог</button><button [attr.aria-pressed]="section()==='batch'" (click)="section.set('batch')">Выдача</button><button [attr.aria-pressed]="section()==='issued'" (click)="section.set('issued')">Выдано</button></nav>
 <div class="panels"><app-inventory [hidden]="section()!=='catalog'" [embedded]="true" [token]="token()" mode="admin" [isAdmin]="true" [avatarUrl]="avatarUrl()" (grantRequested)="addItem($event)" (changed)="changed.emit()"/>
 <app-batch-grant [hidden]="section()!=='batch'" [token]="token()" [actorId]="actorId()" (issued)="showIssued()"/>
 <app-inventory #issued [hidden]="section()!=='issued'" [embedded]="true" initialTab="issued" [token]="token()" mode="admin" [isAdmin]="true" [avatarUrl]="avatarUrl()" (changed)="changed.emit()"/></div>`,
 styles:[`:host{display:flex;flex-direction:column;min-height:0;height:100%;color:var(--palette-text)}nav{display:flex;gap:8px;padding:12px 20px;border-bottom:1px solid var(--palette-border);flex-shrink:0}button{font:inherit;font-size:13px;padding:9px 14px;border:1px solid var(--palette-border);border-radius:9px;background:var(--palette-raised);color:inherit;cursor:pointer}button[aria-pressed=true]{background:var(--palette-selected);border-color:var(--palette-primary)}.panels{flex:1;min-height:0}.panels>app-inventory,.panels>app-batch-grant{height:100%;display:block}.panels>[hidden]{display:none!important}`]})
export class AdminItemsComponent{
 readonly token=input.required<string>();readonly actorId=input.required<string>();readonly avatarUrl=input<string|null>(null);readonly changed=output<void>();
 readonly section=signal<'catalog'|'batch'|'issued'>('catalog');
 @ViewChild(BatchGrantComponent) batch?:BatchGrantComponent;
 @ViewChild('issued') issued?:InventoryComponent;
 addItem(item:{id:string;name:string;kind:string;hidden:boolean}){if(this.batch&&!this.batch.hasItem(item.id))this.batch.toggleItem(item);this.section.set('batch');}
 showIssued(){this.section.set('issued');void this.issued?.reload();}
}
