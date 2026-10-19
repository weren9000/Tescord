import {AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject, input, output, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {HttpClient, HttpErrorResponse} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';
import {AssetPreviewComponent} from './asset-preview.component';
import {CollectiblePreviewComponent} from './collectible-preview.component';
import {WalletService} from './wallet.service';

interface Offer {id:string;name:string;kind:string;price?:number;version?:number;status?:string;position?:number;recommended?:boolean;owned?:number;sales?:number;hidden?:boolean}
interface Page<T>{items:T[];page:number;pages:number;total:number}
interface Receipt{id:string;item_id:string;name:string;catalog_id:string;price:number;balance_after:number;created_at:string;buyer_name:string}
interface Purchase {request_id:string;catalog_id:string;expected_price:number;offer_version:number}
interface Manager {id:string;name:string;public_id:number;is_shop_admin:boolean;is_admin:boolean}
interface Audit {id:string;target:string;actor_name:string;before:Record<string,unknown>;after:Record<string,unknown>;created_at:string}

@Component({selector:'app-shop',standalone:true,imports:[CommonModule,FormsModule,AssetPreviewComponent,CollectiblePreviewComponent],templateUrl:'./shop.component.html',styleUrl:'./shop.component.scss'})
export class ShopComponent implements AfterViewInit, OnDestroy {
 readonly token=input.required<string>();readonly actorId=input.required<string>();readonly manage=input(false);readonly systemAdmin=input(false);readonly avatarUrl=input<string|null>(null);
 readonly close=output<void>();readonly inventory=output<void>();readonly changed=output<void>();readonly wallpaper=output<string>();
 @ViewChild('dialog') dialog!:ElementRef<HTMLDialogElement>;
 readonly wallet=inject(WalletService);private readonly http=inject(HttpClient);
 readonly items=signal<Offer[]>([]);readonly selected=signal<Offer|null>(null);readonly result=signal<Receipt|null>(null);
 readonly pending=signal<Purchase|null>(null);readonly confirming=signal(false);readonly busy=signal(false);readonly loading=signal(false);readonly error=signal('');readonly success=signal('');
 readonly previewErrors=signal(false);readonly previewRetry=signal(0);
 retryPreviews(){this.previewErrors.set(false);this.previewRetry.update(v=>v+1);}
 readonly mode=signal<'browse'|'offers'|'purchases'|'audit'|'roles'>('browse');readonly receipts=signal<Receipt[]>([]);readonly audits=signal<Audit[]>([]);readonly people=signal<Manager[]>([]);
 readonly page=signal(1);readonly pages=signal(1);readonly total=signal(0);
 readonly categories=[{id:'avatar',label:'Аватарки'},{id:'wallpaper',label:'Обои'},{id:'frame',label:'Рамки'},{id:'theme',label:'Темы'}];
 kind='avatar';q='';sort='new';unowned=false;price=1;status='draft';position=0;recommended=false;
 private version=0;private alive=true;private trigger:HTMLElement|null=null;
 ngAfterViewInit(){this.dialog.nativeElement.showModal();void this.load();void this.wallet.refresh();this.restore();}
 ngOnDestroy(){this.alive=false;++this.version;}
 private key(){return 'kva-shop-pending:'+this.actorId();}
 private request<T>(path:string,method='GET',body?:unknown){return firstValueFrom(this.http.request<T>(method,API_BASE_URL+'/api'+path,{body,headers:{Authorization:'Bearer '+this.token()}}));}
 private fail(e:unknown){const detail=e instanceof HttpErrorResponse?e.error?.detail:null;this.error.set(typeof detail==='string'?detail:'Не удалось связаться с сервером. Попробуйте ещё раз.');}
 private clearPending(){this.pending.set(null);try{localStorage.removeItem(this.key());}catch{}}
 private restore(){try{const p=JSON.parse(localStorage.getItem(this.key())??'null') as Purchase|null;if(p&&typeof p.request_id==='string'&&typeof p.catalog_id==='string'&&Number.isSafeInteger(p.expected_price)&&Number.isSafeInteger(p.offer_version)){this.pending.set(p);void this.recover();}}catch{}}
 image(id:string){return API_BASE_URL+'/api/inventory/assets/'+encodeURIComponent(id)+'?preview=true';}
 statusLabel(s?:string){return s==='published'?'В продаже':s==='withdrawn'?'Снято с продажи':'Черновик';}
 missing(){return Math.max(0,(this.selected()?.price??0)-(this.wallet.balance()?.crystals??0));}
 async load(reset=false){if(reset)this.page.set(1);const version=++this.version;this.loading.set(true);this.error.set('');
  const params=new URLSearchParams({page:String(this.page()),q:this.q});const mode=this.mode();
  if(mode==='browse'||mode==='offers')params.set('kind',this.kind);
  if(mode==='browse'){params.set('sort',this.sort);params.set('unowned',String(this.unowned));}
  const endpoint=mode==='browse'?'/shop':mode==='roles'?'/admin/directory/users':'/shop/admin/'+mode;
  try{const data=await this.request<Page<Offer&Receipt&Manager&Audit>>(endpoint+'?'+params);if(!this.alive||version!==this.version)return;
   this.items.set(data.items);this.receipts.set(data.items);this.people.set(data.items);this.audits.set(data.items);this.page.set(data.page);this.pages.set(data.pages);this.total.set(data.total);
  }catch(e){if(this.alive&&version===this.version)this.fail(e);}finally{if(this.alive&&version===this.version)this.loading.set(false);}}
 async switchMode(mode:'browse'|'offers'|'purchases'|'audit'|'roles'){if(this.busy())return;this.mode.set(mode);this.back();this.q='';await this.load(true);}
 async category(kind:string){this.kind=kind;await this.load(true);}
 async go(page:number){this.page.set(page);await this.load();}
 open(item:Offer,event:Event){this.trigger=event.currentTarget as HTMLElement;this.selected.set(item);this.result.set(null);this.confirming.set(false);this.error.set('');this.success.set('');this.price=item.price??1;this.status=item.status??'draft';this.position=item.position??0;this.recommended=item.recommended??false;setTimeout(()=>this.dialog.nativeElement.querySelector<HTMLElement>('.back')?.focus());}
 back(){if(this.busy())return;this.selected.set(null);this.confirming.set(false);this.result.set(null);this.error.set('');setTimeout(()=>this.trigger?.isConnected&&this.trigger.focus());}
 dismiss(){if(this.busy())return;this.dialog.nativeElement.close();this.close.emit();}
 escape(event:Event){event.preventDefault();event.stopPropagation();if(this.busy())return;if(this.confirming())this.confirming.set(false);else if(this.selected()||this.result())this.back();else this.dismiss();}
 async prepare(){if(this.busy()||this.pending())return;await this.wallet.refresh();if(!this.alive)return;if(this.wallet.error()){this.error.set('Не удалось проверить баланс. Повторите попытку.');return;}this.confirming.set(true);setTimeout(()=>{if(this.alive)this.dialog.nativeElement.querySelector<HTMLElement>('.confirmation .primary')?.focus();});}
 async buy(){const item=this.selected();if(!item?.price||!item.version||this.busy()||this.pending())return;
  const p={request_id:crypto.randomUUID(),catalog_id:item.id,expected_price:item.price,offer_version:item.version};
  try{localStorage.setItem(this.key(),JSON.stringify(p));}catch{this.error.set('Для безопасной покупки нужен доступ к локальному хранилищу браузера.');return;}
  this.pending.set(p);await this.submit(p);}
 private async complete(receipt:Receipt){this.result.set(receipt);this.confirming.set(false);this.clearPending();this.error.set('');this.changed.emit();await this.wallet.refresh();}
 private async submit(p:Purchase){this.busy.set(true);this.error.set('');try{const r=await this.request<Receipt>('/shop/purchases','POST',p);if(this.alive)await this.complete(r);}
  catch(e){if(!this.alive)return;if(e instanceof HttpErrorResponse&&e.status>=400&&e.status<500){this.clearPending();this.confirming.set(false);this.selected.set(null);await this.load();}this.fail(e);}
  finally{if(this.alive)this.busy.set(false);}}
 async recover(){const p=this.pending();if(!p||this.busy())return;this.busy.set(true);this.error.set('');try{const r=await this.request<Receipt>('/shop/purchases/'+p.request_id);if(this.alive)await this.complete(r);}
  catch(e){if(!this.alive)return;if(e instanceof HttpErrorResponse&&e.status===404){this.busy.set(false);await this.submit(p);return;}this.fail(e);}finally{if(this.alive)this.busy.set(false);}}
 async apply(){const r=this.result();if(!r||this.busy())return;const kind=this.selected()?.kind??this.items().find(i=>i.id===r.catalog_id)?.kind;
  if(!kind){this.inventory.emit();return;}if(kind==='wallpaper'){this.wallpaper.emit(r.item_id);return;}this.busy.set(true);this.error.set('');
  try{await this.request('/inventory/items/'+r.item_id+'/equip','POST',{request_id:crypto.randomUUID()});this.changed.emit();this.success.set('Предмет используется');}catch(e){this.fail(e);}finally{this.busy.set(false);}}
 async save(){const item=this.selected();if(!item||this.busy())return;this.busy.set(true);this.error.set('');try{await this.request('/shop/admin/offers/'+item.id,'PUT',{price:this.price,status:this.status,position:this.position,recommended:this.recommended,version:item.version??0});this.busy.set(false);this.back();await this.load();this.success.set('Предложение сохранено');}catch(e){this.fail(e);}finally{this.busy.set(false);}}
 async role(person:Manager){if(this.busy())return;this.busy.set(true);this.error.set('');try{await this.request('/shop/admin/managers/'+person.id,'PUT',{enabled:!person.is_shop_admin});await this.load();this.success.set('Права обновлены');}catch(e){this.fail(e);}finally{this.busy.set(false);}}
 auditText(value:Record<string,unknown>){if('is_shop_admin' in value)return value['is_shop_admin']?'Управление магазином включено':'Управление магазином выключено';if(!('price' in value))return 'Нет предложения';return this.statusLabel(String(value['status']))+' · '+value['price']+' кристаллов · порядок '+value['position']+(value['recommended']?' · Рекомендуем':'');}
}
