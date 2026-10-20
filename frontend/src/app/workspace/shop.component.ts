import {AfterViewInit, Component, DestroyRef, ElementRef, OnDestroy, ViewChild, inject, input, output, signal, computed, effect} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {HttpClient, HttpErrorResponse} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';
import {CollectiblePreviewComponent} from './collectible-preview.component';
import {WalletService} from './wallet.service';
import {InventoryComponent} from './inventory.component';
import {ResourceRefreshService} from '../core/services/resource-refresh.service';
import {StoreProductCardComponent} from './store-product-card.component';

export interface Offer {id:string;name:string;kind:string;price?:number;version?:number;status?:string;position?:number;recommended?:boolean;owned?:number;sales?:number;hidden?:boolean}
interface Page<T>{items:T[];page:number;pages:number;total:number;categories?:Record<string,number>}
interface Receipt{id:string;item_id:string;name:string;catalog_id:string;price:number;balance_after:number;created_at:string;buyer_name:string;kind?:string;owned?:boolean;in_use?:boolean}
interface Purchase {request_id:string;catalog_id:string;expected_price:number;offer_version:number}
interface Manager {id:string;name:string;public_id:number;is_shop_admin:boolean;is_admin:boolean}
interface Audit {id:string;target:string;actor_name:string;before:Record<string,unknown>;after:Record<string,unknown>;created_at:string}
interface Journal {id:string;name:string;catalog_id:string;kind:string;action:string;direction:string;created_at:string}
type Mode='browse'|'inventory'|'recommendations'|'purchases'|'journal'|'offers'|'sales'|'audit'|'roles';
interface ViewState {q:string;kind:string;sort:string;unowned:boolean;priceBand:string;action:string;start:string;end:string;page:number;scroll:number}

@Component({selector:'app-shop',standalone:true,imports:[CommonModule,FormsModule,CollectiblePreviewComponent,InventoryComponent,StoreProductCardComponent],templateUrl:'./shop.component.html',styleUrl:'./shop.component.scss'})
export class ShopComponent implements AfterViewInit, OnDestroy {
 readonly token=input.required<string>();readonly actorId=input.required<string>();readonly manage=input(false);readonly systemAdmin=input(false);readonly avatarUrl=input<string|null>(null);
 readonly close=output<void>();readonly inventory=output<void>();readonly changed=output<void>();readonly wallpaper=output<string>();
 @ViewChild('dialog') dialog!:ElementRef<HTMLDialogElement>;
 @ViewChild('inventoryPanel') inventoryPanel?:InventoryComponent;
 private readonly host:ElementRef<HTMLElement>=inject(ElementRef);
 readonly inventoryVisited=signal(false);
 readonly priceBands=[{id:'',label:'Любая'},{id:'low',label:'До 100'},{id:'mid',label:'101–300'},{id:'high',label:'От 301'}];
 readonly actionOptions=['purchase','grant','gift','revoke','equip','unequip'];
 readonly mobile=signal(matchMedia('(max-width: 980px)').matches);
 readonly filtersOpen=signal(false);readonly counts=signal<Record<string,number>>({});
 readonly journal=signal<Journal[]>([]);readonly purchaseDetail=signal<Receipt|null>(null);
 readonly roleTarget=signal<Manager|null>(null);
 readonly tabs:{id:Mode;label:string}[]=[{id:'browse',label:'Витрина'},{id:'inventory',label:'Мой инвентарь'},{id:'recommendations',label:'Предложения'},{id:'purchases',label:'Покупки'},{id:'journal',label:'Журнал'},{id:'roles',label:'Права'}];
 readonly labels:Record<string,string>={purchase:'Куплен предмет',grant:'Получен предмет',gift:'Подарок получен',revoke:'Предмет отозван',equip:'Предмет применён',unequip:'Предмет снят'};
 private readonly views=new Map<Mode,ViewState>();
 private readonly viewport=matchMedia('(max-width: 980px)');
 private readonly onViewport=()=>{this.mobile.set(this.viewport.matches);setTimeout(()=>this.showShell());};
 private readonly onPop=()=>{if(this.busy()||this.inventoryPanel?.busy()||this.hasNested()){this.backStep();history.pushState({...history.state,kvaShop:true},'');}else{this.historyEntry=false;this.close.emit();}};
 private historyEntry=false;private oldOverflow='';private origin:HTMLElement|null=null;
 private background:HTMLElement|null=null;private backgroundWasInert=false;
 readonly wallet=inject(WalletService);private readonly http=inject(HttpClient);
 readonly items=signal<Offer[]>([]);readonly selected=signal<Offer|null>(null);readonly result=signal<Receipt|null>(null);
 readonly featured=computed(()=>this.items().find(item=>item.recommended));
 readonly pending=signal<Purchase|null>(null);readonly confirming=signal(false);readonly busy=signal(false);readonly loading=signal(false);readonly error=signal('');readonly success=signal('');
 readonly previewErrors=signal(false);readonly previewRetry=signal(0);
 retryPreviews(){this.previewErrors.set(false);this.previewRetry.update(v=>v+1);}
 readonly mode=signal<Mode>('browse');readonly receipts=signal<Receipt[]>([]);readonly audits=signal<Audit[]>([]);readonly people=signal<Manager[]>([]);
 readonly page=signal(1);readonly pages=signal(1);readonly total=signal(0);
 readonly categories=[{id:'avatar',label:'Аватарки'},{id:'wallpaper',label:'Обои'},{id:'frame',label:'Рамки'},{id:'theme',label:'Темы'}];
 kind='';q='';sort='new';unowned=false;priceBand='';action='';start='';end='';price=1;status='draft';position=0;recommended=false;
 private version=0;private alive=true;private trigger:HTMLElement|null=null;
 constructor(){
  effect(onCleanup=>{
   const selector=this.roleTarget()?'.role-confirm':this.filtersOpen()?'.filter-sheet':null;
   if(!selector)return;
   const previous=document.activeElement as HTMLElement|null;
   const timer=setTimeout(()=>this.host.nativeElement.querySelector<HTMLElement>(selector+' button')?.focus());
   onCleanup(()=>{clearTimeout(timer);if(previous?.isConnected)previous.focus();});
  });
  const sub=inject(ResourceRefreshService).changes$.subscribe(()=>{if(this.alive&&!document.hidden&&!this.busy()&&!this.selected()&&!this.confirming())void this.load();});
  inject(DestroyRef).onDestroy(()=>sub.unsubscribe());
 }
 ngAfterViewInit(){
  this.origin=document.activeElement as HTMLElement;this.oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
  this.background=document.querySelector<HTMLElement>('.messenger-shell');
  if(this.background&&!this.background.contains(this.host.nativeElement)){this.backgroundWasInert=this.background.inert;this.background.inert=true;}else this.background=null;
  this.viewport.addEventListener('change',this.onViewport);
  history.pushState({...history.state,kvaShop:true},'');this.historyEntry=true;window.addEventListener('popstate',this.onPop);
  this.showShell();void this.load();void this.wallet.refresh();this.restore();
 }
 ngOnDestroy(){
  this.alive=false;++this.version;this.viewport.removeEventListener('change',this.onViewport);window.removeEventListener('popstate',this.onPop);
  document.body.style.overflow=this.oldOverflow;if(this.background)this.background.inert=this.backgroundWasInert;
  if(this.historyEntry&&history.state?.kvaShop)history.back();
  this.origin?.isConnected&&this.origin.focus();
 }
 private showShell(){if(!this.alive)return;if(!this.mobile()&&!this.dialog?.nativeElement.open)this.dialog?.nativeElement.showModal();this.host.nativeElement.querySelector<HTMLElement>('.shell-back')?.focus();}
 title(){return this.tabs.find(t=>t.id===this.mode())?.label??({offers:'Товары и цены',sales:'Все продажи',audit:'Журнал управления'} as Record<string,string>)[this.mode()];}
 subtitle(){return this.mode()==='purchases'?'История ваших покупок и стоимость':this.mode()==='journal'?'Покупки, подарки и использование предметов':this.mode()==='browse'?'Подберите то, что нравится именно вам':'';}
 confirmRole(person:Manager){this.roleTarget.set(person);setTimeout(()=>this.host.nativeElement.querySelector<HTMLElement>('.role-confirm button')?.focus());}
 catalogMode(){return ['browse','recommendations','offers'].includes(this.mode());}
 kindLabel(kind?:string){return this.categories.find(c=>c.id===kind)?.label??'Предмет';}
 pageNumbers(){const start=Math.max(1,Math.min(this.page()-2,this.pages()-4));return Array.from({length:Math.min(5,this.pages())},(_,i)=>start+i);}
 resetFilters(){this.q='';this.kind='';this.sort='new';this.unowned=false;this.priceBand='';this.action='';this.start='';this.end='';void this.load(true);}
 hasFilters(){return !!(this.q||this.kind||this.unowned||this.priceBand||this.action||this.start||this.end);}
 private content(){return this.host.nativeElement.querySelector<HTMLElement>('.content');}
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
  if(mode==='inventory'){this.loading.set(false);return;}
  if(this.kind)params.set('kind',this.kind);
  if(mode==='browse'||mode==='recommendations'){
   params.set('sort',this.sort);params.set('unowned',String(this.unowned));
   if(mode==='recommendations')params.set('recommended','true');
   if(this.priceBand==='low')params.set('max_price','100');
   if(this.priceBand==='mid'){params.set('min_price','101');params.set('max_price','300');}
   if(this.priceBand==='high')params.set('min_price','301');
  }
  if(mode==='purchases')params.set('sort',this.sort);
  if(mode==='purchases'||mode==='journal'){if(this.start)params.set('start',this.start);if(this.end)params.set('end',this.end);}
  if(mode==='journal'&&this.action)params.set('action',this.action);
  const endpoint=mode==='browse'||mode==='recommendations'?'/shop':mode==='roles'?'/admin/directory/users':mode==='purchases'?'/shop/purchases':mode==='journal'?'/shop/journal':'/shop/admin/'+(mode==='sales'?'purchases':mode);
  try{const data=await this.request<Page<Offer&Receipt&Manager&Audit>>(endpoint+'?'+params);if(!this.alive||version!==this.version)return;
   this.items.set(data.items);this.receipts.set(data.items);this.people.set(data.items);this.audits.set(data.items);this.journal.set(data.items as unknown as Journal[]);this.counts.set(data.categories??{});this.page.set(data.page);this.pages.set(data.pages);this.total.set(data.total);
  }catch(e){if(this.alive&&version===this.version)this.fail(e);}finally{if(this.alive&&version===this.version)this.loading.set(false);}}
 async switchMode(mode:Mode){
  if(this.busy()||this.inventoryPanel?.busy()||this.inventoryNested())return;
  if(mode==='roles'&&!this.systemAdmin()||['offers','sales','audit'].includes(mode)&&!this.manage())return;
  this.views.set(this.mode(),{q:this.q,kind:this.kind,sort:this.sort,unowned:this.unowned,priceBand:this.priceBand,action:this.action,start:this.start,end:this.end,page:this.page(),scroll:this.content()?.scrollTop??0});
  this.mode.set(mode);if(mode==='inventory')this.inventoryVisited.set(true);this.back();this.purchaseDetail.set(null);this.filtersOpen.set(false);
  const state=this.views.get(mode)??{q:'',kind:'',sort:'new',unowned:false,priceBand:'',action:'',start:'',end:'',page:1,scroll:0};
  this.q=state.q;this.kind=state.kind;this.sort=state.sort;this.unowned=state.unowned;this.priceBand=state.priceBand;this.action=state.action;this.start=state.start;this.end=state.end;this.page.set(state.page);
  if(mode==='inventory'&&this.inventoryPanel)await this.inventoryPanel.reload(true);
  await this.load();setTimeout(()=>{const content=this.content();if(content)content.scrollTop=state.scroll;});
 }
 showReceipt(receipt:Receipt,event:Event){this.trigger=event.currentTarget as HTMLElement;this.purchaseDetail.set(receipt);setTimeout(()=>this.host.nativeElement.querySelector<HTMLElement>('.back')?.focus());}
 closeReceipt(){this.purchaseDetail.set(null);setTimeout(()=>this.trigger?.isConnected&&this.trigger.focus());}
 async category(kind:string){this.kind=kind;await this.load(true);}
 async go(page:number){this.page.set(page);await this.load();}
 open(item:Offer,event:Event){this.trigger=event.currentTarget as HTMLElement;this.selected.set(item);this.result.set(null);this.confirming.set(false);this.error.set('');this.success.set('');this.price=item.price??1;this.status=item.status??'draft';this.position=item.position??0;this.recommended=item.recommended??false;setTimeout(()=>this.host.nativeElement.querySelector<HTMLElement>('.back')?.focus());}
 back(){if(this.busy())return;this.selected.set(null);this.confirming.set(false);this.result.set(null);this.error.set('');setTimeout(()=>this.trigger?.isConnected&&this.trigger.focus());}
 dismiss(){if(this.busy()||this.inventoryPanel?.busy())return;this.close.emit();}
 inventoryNested(){const i=this.inventoryPanel;return !!(i?.pending()||i?.detail()||i?.giftItem()||i?.themePreview()||i?.eventsOpen()||i?.menu());}
 hasNested(){const i=this.inventoryPanel;return !!(this.confirming()||this.selected()||this.result()||this.filtersOpen()||this.purchaseDetail()||this.roleTarget()||i?.pending()||i?.detail()||i?.giftItem()||i?.themePreview()||i?.eventsOpen()||i?.menu());}
 backStep(){
  if(this.busy()||this.inventoryPanel?.busy())return;
  if(this.inventoryPanel?.closeNested())return;
  if(this.roleTarget())this.roleTarget.set(null);else if(this.filtersOpen())this.filtersOpen.set(false);else if(this.purchaseDetail())this.closeReceipt();
  else if(this.confirming())this.confirming.set(false);else if(this.selected()||this.result())this.back();else this.dismiss();
 }
 escape(event:Event){event.preventDefault();event.stopPropagation();this.backStep();}
 keydown(event:KeyboardEvent){
  if(event.defaultPrevented)return;
  if(event.key==='Escape'){this.escape(event);return;}
  if(event.key!=='Tab'||(!this.mobile()&&!this.filtersOpen()&&!this.roleTarget()))return;
  const root=this.host.nativeElement.querySelector<HTMLElement>(this.roleTarget()?'.role-confirm':this.filtersOpen()?'.filter-sheet':'.mobile-page');
  const nodes=Array.from(root?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')??[]).filter(n=>n.getClientRects().length&&!n.closest('[inert]'));
  const first=nodes[0],last=nodes.at(-1);
  if(event.shiftKey&&(document.activeElement===first||!root?.contains(document.activeElement))){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&(document.activeElement===last||!root?.contains(document.activeElement))){event.preventDefault();first?.focus();}
 }
 openFilters(){this.filtersOpen.set(true);setTimeout(()=>this.host.nativeElement.querySelector<HTMLElement>('.filter-sheet button')?.focus());}
 async prepare(){if(this.busy()||this.pending())return;await this.wallet.refresh();if(!this.alive)return;if(this.wallet.error()){this.error.set('Не удалось проверить баланс. Повторите попытку.');return;}this.confirming.set(true);setTimeout(()=>{if(this.alive)this.host.nativeElement.querySelector<HTMLElement>('.confirmation .primary')?.focus();});}
 async buy(){const item=this.selected();if(!item?.price||!item.version||this.busy()||this.pending())return;
  const p={request_id:crypto.randomUUID(),catalog_id:item.id,expected_price:item.price,offer_version:item.version};
  try{localStorage.setItem(this.key(),JSON.stringify(p));}catch{this.error.set('Для безопасной покупки нужен доступ к локальному хранилищу браузера.');return;}
  this.pending.set(p);await this.submit(p);}
 private async complete(receipt:Receipt){this.result.set(receipt);setTimeout(()=>this.host.nativeElement.querySelector<HTMLElement>('.purchased .primary')?.focus());this.confirming.set(false);this.clearPending();this.error.set('');this.changed.emit();await this.wallet.refresh();}
 private async submit(p:Purchase){this.busy.set(true);this.error.set('');try{const r=await this.request<Receipt>('/shop/purchases','POST',p);if(this.alive)await this.complete(r);}
  catch(e){if(!this.alive)return;if(e instanceof HttpErrorResponse&&e.status>=400&&e.status<500){this.clearPending();this.confirming.set(false);this.selected.set(null);await this.load();}this.fail(e);}
  finally{if(this.alive)this.busy.set(false);}}
 async recover(){const p=this.pending();if(!p||this.busy())return;this.busy.set(true);this.error.set('');try{const r=await this.request<Receipt>('/shop/purchases/'+p.request_id);if(this.alive)await this.complete(r);}
  catch(e){if(!this.alive)return;if(e instanceof HttpErrorResponse&&e.status===404){this.busy.set(false);await this.submit(p);return;}this.fail(e);}finally{if(this.alive)this.busy.set(false);}}
 async apply(){const r=this.result();if(!r||this.busy())return;const kind=this.selected()?.kind??this.items().find(i=>i.id===r.catalog_id)?.kind;
  if(!kind){void this.switchMode('inventory');return;}if(kind==='wallpaper'){this.wallpaper.emit(r.item_id);return;}this.busy.set(true);this.error.set('');
  try{await this.request('/inventory/items/'+r.item_id+'/equip','POST',{request_id:crypto.randomUUID()});this.changed.emit();this.success.set('Предмет используется');}catch(e){this.fail(e);}finally{this.busy.set(false);}}
 async save(){const item=this.selected();if(!item||this.busy())return;this.busy.set(true);this.error.set('');try{await this.request('/shop/admin/offers/'+item.id,'PUT',{price:this.price,status:this.status,position:this.position,recommended:this.recommended,version:item.version??0});this.busy.set(false);this.back();await this.load();this.success.set('Предложение сохранено');}catch(e){this.fail(e);}finally{this.busy.set(false);}}
 async role(person:Manager){if(this.busy()||person.is_admin)return;this.busy.set(true);this.error.set('');try{await this.request('/shop/admin/managers/'+person.id,'PUT',{enabled:!person.is_shop_admin});this.roleTarget.set(null);await this.load();this.success.set('Права обновлены');}catch(e){this.fail(e);}finally{this.busy.set(false);}}
 auditText(value:Record<string,unknown>){if('is_shop_admin' in value)return value['is_shop_admin']?'Управление магазином включено':'Управление магазином выключено';if(!('price' in value))return 'Нет предложения';return this.statusLabel(String(value['status']))+' · '+value['price']+' кристаллов · порядок '+value['position']+(value['recommended']?' · Рекомендуем':'');}
}
