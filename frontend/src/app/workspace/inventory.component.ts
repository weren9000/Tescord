import {CollectiblePreviewComponent} from './collectible-preview.component';
import {UserCardDirective} from './user-card.directive';
import {AssetPreviewComponent} from './asset-preview.component';
import {WalletBalanceComponent} from './wallet-balance.component';
import { ActionMenuComponent } from './action-menu.component';
import { UiIconComponent } from './ui-icon.component';
import { Component, ElementRef, effect, inject, input, output, signal, untracked, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../core/api/api-base';

interface Person { id: string; nick: string; public_id: number; avatar_updated_at: string | null; }
interface Item { in_use?: boolean; received_at?: string; copies?: number; gift_item_id?: string; created_at: string; id: string; catalog_id: string; name: string; kind: string; equipped: boolean; revoked: boolean; owner: Person | null; }
interface Notice { id: string; action: string; name: string; actor: Person | null; created_at: string; unread: boolean; }
interface Event { action: string; actor: Person | null; recipient: Person | null; created_at: string; }
interface Page<T> { items: T[]; total: number; page: number; pages: number; }
interface Collection extends Page<Item> { notifications: Notice[]; unread: number; equipped_ids: string[]; }
interface Catalog { id: string; name: string; kind: string; hidden: boolean; }
interface Pending { action: string; item: Item | null; recipient: Person | null; request_id: string; catalog_id?: string; }

@Component({
 selector: 'app-inventory', standalone: true, imports: [CollectiblePreviewComponent, UserCardDirective, WalletBalanceComponent, AssetPreviewComponent, CommonModule, FormsModule, ActionMenuComponent, UiIconComponent],
 templateUrl: './inventory.component.html', styleUrl: './inventory.component.scss'
})
export class InventoryComponent implements OnDestroy {
 readonly embedded=input(false);
 readonly initialTab=input<'avatar'|'issued'>('avatar');
 readonly grantRequested=output<Catalog>();
 readonly previewErrors=signal(false); readonly previewRetry=signal(0);
 retryPreviews(){this.previewErrors.set(false);this.previewRetry.update(v=>v+1);}
 readonly avatarUrl = input<string | null>(null);
 readonly catalogMenu = signal<Catalog | null>(null);
 private historyVersion = 0;
 readonly token = input.required<string>();
 readonly mode = input<'inventory' | 'admin' | null>(null);
 readonly isAdmin = input(false);
 readonly close = output<void>();
 readonly shop = output<void>(); readonly wallpaper = output<string>();
 readonly walletOpen = output<void>();
 readonly changed = output<void>();
 readonly unread = output<number>();
 readonly http = inject(HttpClient);
 readonly element: ElementRef<HTMLElement> = inject(ElementRef);
 readonly items = signal<Item[]>([]);
 readonly notices = signal<Notice[]>([]);
 readonly issued = signal<Item[]>([]);
 readonly catalog = signal<Catalog[]>([]);
 readonly people = signal<Person[]>([]);
 readonly recipient = signal<Person | null>(null);
 readonly pending = signal<Pending | null>(null);
 readonly grantOpen = signal(false);
 readonly giftItem = signal<Item | null>(null);
 readonly history = signal<Event[] | null>(null);
 readonly busy = signal(false);
 readonly loading = signal(false);
 readonly searched = signal(false);
 readonly error = signal('');
 readonly success = signal('');
 readonly tab = signal('all');
 readonly adminTab = signal<'avatar' | 'frame' | 'wallpaper' | 'theme' | 'issued'>('avatar');
 readonly uploadOpen = signal(false);
 readonly editing = signal<Catalog | null>(null);
 readonly total = signal(0);
 readonly currentPage = signal(1);
 readonly pageCount = signal(1);
 sort='new'; equippedOnly=false;
 filter = ''; issuedKind = ''; uploadName = ''; editName = '';
 uploadKind = 'avatar'; uploadFile: File | null = null; previewUrl = '';
 cropX=50; cropY=50; zoom=1; imageWidth=1; imageHeight=1;
 private loadVersion=0;
 private fileVersion=0;
 get previewWidth(){return this.imageWidth/Math.min(this.imageWidth,this.imageHeight)*this.zoom*100;}
 get previewHeight(){return this.imageHeight/Math.min(this.imageWidth,this.imageHeight)*this.zoom*100;}
 pageNumbers(){const start=Math.max(1,Math.min(this.currentPage()-2,this.pageCount()-4));return Array.from({length:Math.min(5,this.pageCount())},(_,i)=>start+i);}
 selectedEntry(){return this.catalog().find(c=>c.id===this.selectedCatalog);}
 async switchTab(value: string){if(this.busy())return;++this.searchVersion;this.menu.set(null);this.error.set('');this.success.set('');this.filter='';this.issuedKind='';this.currentPage.set(1);this.recipient.set(null);this.people.set([]);this.query='';this.searched.set(false);this.selectedCatalog='';if(this.mode()==='admin')this.adminTab.set(value as 'avatar'|'frame'|'wallpaper'|'theme'|'issued');else this.tab.set(value);await this.reload();}
 async filterChanged(){this.currentPage.set(1);this.selectedCatalog='';await this.reload();}
 async goPage(value: number){this.currentPage.set(value);this.menu.set(null);this.selectedCatalog='';await this.reload();}
 openUpload(){this.resetUpload();this.uploadKind=this.adminTab()==='issued'?'avatar':this.adminTab();this.uploadOpen.set(true);this.error.set('');}
 resetUpload(){++this.fileVersion;if(this.previewUrl)URL.revokeObjectURL(this.previewUrl);this.previewUrl='';this.uploadFile=null;this.uploadName='';this.cropX=50;this.cropY=50;this.zoom=1;}
 ngOnDestroy(){this.resetUpload();++this.loadVersion;++this.historyVersion;}
 async fileChanged(event: globalThis.Event){
  const version=++this.fileVersion;this.error.set('');const file=(event.target as HTMLInputElement).files?.[0];this.uploadFile=null;if(this.previewUrl)URL.revokeObjectURL(this.previewUrl);this.previewUrl='';
  if(!file)return;if(file.size>10*1024*1024){this.error.set('Изображение должно быть не больше 10 МБ');return;}
  const url=URL.createObjectURL(file);const img=new Image();img.src=url;
  try{await img.decode();if(!this.uploadOpen()||version!==this.fileVersion){URL.revokeObjectURL(url);return;}this.imageWidth=img.naturalWidth;this.imageHeight=img.naturalHeight;this.cropX=50;this.cropY=50;this.zoom=1;this.previewUrl=url;this.uploadFile=file;}
  catch{URL.revokeObjectURL(url);if(version===this.fileVersion)this.error.set('Не удалось прочитать изображение');}
 }
 async saveUpload(){
  if(!this.uploadFile||!this.uploadName.trim()||this.busy())return;
  this.busy.set(true);this.error.set('');const body=new FormData();body.append('name',this.uploadName.trim());body.append('kind',this.uploadKind);body.append('image',this.uploadFile);body.append('crop_x',String(this.cropX/100));body.append('crop_y',String(this.cropY/100));body.append('zoom',String(this.zoom));
  try{const entry=await this.request<Catalog>('/catalog','POST',body);this.uploadOpen.set(false);this.resetUpload();this.filter='';this.currentPage.set(1);await this.reload();this.selectedCatalog=entry.id;this.success.set('Предмет добавлен. Теперь его можно выдать.');}catch(e){this.fail(e);}finally{this.busy.set(false);}
 }
 edit(entry: Catalog){this.editing.set(entry);this.editName=entry.name;this.error.set('');}
 async saveCatalog(hidden?: boolean){const entry=this.editing();if(!entry||this.busy())return;this.busy.set(true);this.error.set('');try{await this.request('/catalog/'+entry.id,'PATCH',{name:this.editName.trim(),...(hidden===undefined?{}:{hidden})});this.editing.set(null);await this.reload();this.success.set('Каталог обновлён. Полученные предметы сохранены.');}catch(e){this.fail(e);}finally{this.busy.set(false);}}
 readonly menu = signal<Item | null>(null);
 readonly detail = signal<Item | null>(null);
 readonly themePreview = signal<Item | null>(null);
 async resetTheme(){if(this.busy())return;this.busy.set(true);try{await this.request('/theme/reset','POST',{request_id:crypto.randomUUID()});this.changed.emit();await this.reload();this.success.set('Базовая тема включена');}catch(e){this.fail(e);}finally{this.busy.set(false);}}
 readonly eventsOpen = signal(false);
 readonly unreadCount = signal(0);
 private menuTrigger: HTMLElement | null = null;
 queryChanged() {++this.searchVersion;this.recipient.set(null);this.people.set([]);this.searched.set(false);}
 toggleMenu(item: Item, event: MouseEvent) {
  event.stopPropagation();
  if(this.menu()?.id===item.id){this.menu.set(null);return;}
  this.menuTrigger=event.currentTarget as HTMLElement;
  this.menu.set(item);
 }
 closePanel() {if(this.busy())return;++this.historyVersion;if(this.pending())this.pending.set(null);else{this.giftItem.set(null);this.grantOpen.set(false);this.detail.set(null);this.themePreview.set(null);this.eventsOpen.set(false);this.uploadOpen.set(false);this.editing.set(null);this.resetUpload();}}
 async clearRecipient() {this.recipient.set(null);this.query='';this.people.set([]);this.searched.set(false);}
 query = '';
 selectedCatalog = '';
 catalogName(id: string) { return this.catalog().find(c=>c.id===id)?.name ?? id; }
 private searchVersion = 0;
 private equipmentSnapshot: string | null = null;
 readonly labels: Record<string, string> = {purchase:'Покупка',grant:'Выдача',gift:'Подарок',revoke:'Отзыв',equip:'Использование',unequip:'Снятие'};

 constructor() {
  effect(onCleanup=>{
   const selector=this.pending()?'.confirm':(this.giftItem()||this.themePreview()||this.detail()||this.eventsOpen()||this.uploadOpen()||this.editing()||this.grantOpen())?'.subpanel':null;
   if(!selector)return;
   const previous=document.activeElement as HTMLElement | null;
   const timer=setTimeout(()=>this.element.nativeElement.querySelector<HTMLElement>(selector+' button')?.focus());
   onCleanup(()=>{clearTimeout(timer);if(previous?.isConnected)previous.focus();else this.menuTrigger?.focus();});
  });
  effect((onCleanup) => {
   const token = this.token();
   const mode = this.mode();
   const previousFocus=document.activeElement as HTMLElement | null;
   const focusTimer=mode && !this.embedded() ? setTimeout(()=>this.element.nativeElement.querySelector<HTMLButtonElement>('header button')?.focus()) : undefined;
   onCleanup(()=>{clearTimeout(focusTimer);if(mode)previousFocus?.focus();});
   this.pending.set(null); this.giftItem.set(null); this.grantOpen.set(false); this.recipient.set(null);
   this.menu.set(null);this.catalogMenu.set(null);++this.historyVersion;this.detail.set(null);this.themePreview.set(null);this.eventsOpen.set(false);this.adminTab.set(this.initialTab());this.tab.set('all');this.uploadOpen.set(false);this.editing.set(null);this.resetUpload();
   this.history.set(null); this.people.set([]); this.searched.set(false); this.query='';this.filter='';this.selectedCatalog='';this.currentPage.set(1);++this.loadVersion;++this.searchVersion;
   this.error.set(''); this.success.set('');
   if (!token) return;
   untracked(()=>void this.reload());
   const timer=setInterval(()=>{if(this.element.nativeElement.offsetParent!==null&&!this.busy()&&!this.loading())void this.reload(true);},15000);
   onCleanup(()=>{++this.loadVersion;clearInterval(timer);clearTimeout(focusTimer);if(mode)previousFocus?.focus();});
  });
 }
 image(id: string, preview=false) { if(preview)return `${API_BASE_URL}/api/inventory/assets/${encodeURIComponent(id)}?preview=true`; return `${API_BASE_URL}/api/inventory/assets/${encodeURIComponent(id)}?motion=${!window.matchMedia('(prefers-reduced-motion: reduce)').matches}`; }
 presetImage(id: string){return `${API_BASE_URL}/api/avatar-presets/${id}`;}
 private accept(data: Collection) {
  const snapshot=data.equipped_ids.join(',');
  if(this.equipmentSnapshot!==null && snapshot!==this.equipmentSnapshot)this.changed.emit();
  this.equipmentSnapshot=snapshot;
  this.notices.set(data.notifications);this.unread.emit(data.unread);
  this.unreadCount.set(data.unread);
 }
 avatar(p: Person) { return `${API_BASE_URL}/api/users/${p.id}/avatar?v=${encodeURIComponent(p.avatar_updated_at ?? 'default')}&motion=${!window.matchMedia('(prefers-reduced-motion: reduce)').matches}`; }
 private request<T>(path: string, method='GET', body?: unknown, token=this.token()) {
  return firstValueFrom(this.http.request<T>(method, `${API_BASE_URL}/api/inventory${path}`, {body,headers:{Authorization:`Bearer ${token}`}}));
 }
 private fail(e: unknown) { const detail=e instanceof HttpErrorResponse?e.error?.detail:null;this.error.set(typeof detail==='string'?detail:'Не удалось выполнить действие. Проверьте поля и попробуйте ещё раз.'); }
 async reload(silent=false) {
  const version=++this.loadVersion;if(!silent)this.loading.set(true);
  const mode=this.mode(), tab=mode==='admin'?this.adminTab():this.tab();
  const params=new URLSearchParams({page:String(this.currentPage()),q:this.filter});
  if(tab!=='issued'&&tab!=='all')params.set('kind',tab);else if(this.issuedKind)params.set('kind',this.issuedKind);
  if(mode==='inventory'){params.set('grouped','true');params.set('sort',this.sort);params.set('equipped_only',String(this.equippedOnly));}
  try {
   const data=await this.request<Collection>(mode==='inventory'?'?'+params:'');
   if(version!==this.loadVersion)return;
   this.accept(data);
   if(mode==='admin' && this.isAdmin()) {
    if(tab==='issued'){const result=await this.request<Page<Item>>('/issued?'+params);if(version!==this.loadVersion)return;this.issued.set(result.items);this.acceptPage(result);}
    else{const result=await this.request<Page<Catalog>>('/catalog?'+params);if(version!==this.loadVersion)return;this.catalog.set(result.items);this.acceptPage(result);if(!result.items.some(i=>i.id===this.selectedCatalog&&!i.hidden))this.selectedCatalog='';}
   }else if(mode==='inventory'){
    this.items.set(data.items);this.acceptPage(data);
   }
  } catch(e){if(version===this.loadVersion&&!silent)this.fail(e);} finally{if(version===this.loadVersion)this.loading.set(false);}
 }
 private acceptPage(data: Page<unknown>){this.total.set(data.total);this.currentPage.set(data.page);this.pageCount.set(data.pages);}
 async search() {
  const version=++this.searchVersion;
  this.recipient.set(null);this.error.set('');this.searched.set(false);
  if(this.query.trim().length<2){this.people.set([]);return;}
  try{const users=await this.request<Person[]>('/users?q='+encodeURIComponent(this.query.trim()));if(version===this.searchVersion){this.people.set(users);this.searched.set(true);}}
  catch(e){this.fail(e);}
 }
 async choose(person: Person) {
  this.recipient.set(person);this.people.set([]);
 }
 startGift(item: Item) {if(item.gift_item_id&&item.gift_item_id!==item.id)item={...item,id:item.gift_item_id,equipped:false};this.detail.set(null);this.menu.set(null);this.giftItem.set(item);this.recipient.set(null);this.people.set([]);this.searched.set(false);this.query='';this.history.set(null);}
 confirm(action: string, item: Item | null) {
  if(this.busy())return;
  this.menu.set(null);
  const recipient=action==='revoke'?item?.owner ?? null:this.recipient();
  if((action==='grant'||action==='gift')&&!recipient)return;
  if(action==='grant'&&(!this.selectedEntry()||this.selectedEntry()!.hidden))return;
  this.pending.set({action,item,recipient,request_id:crypto.randomUUID(),catalog_id:this.selectedCatalog});this.error.set('');this.success.set('');
 }
 async perform() {
  const op=this.pending();if(!op||this.busy())return;
  this.busy.set(true);this.error.set('');
  try {
   await this.request(op.action==='grant'?'/grant':`/items/${op.item!.id}/${op.action}`, 'POST',
     {request_id:op.request_id,recipient_id:['gift','grant','revoke'].includes(op.action) ? op.recipient?.id ?? null : null,...(op.action==='grant'?{catalog_id:op.catalog_id}:{})});
   this.pending.set(null);this.giftItem.set(null);this.grantOpen.set(false);this.themePreview.set(null);this.success.set(op.action==='grant' ? `«${this.catalogName(op.catalog_id ?? '')}» выдано: ${op.recipient?.nick}` : op.action==='gift' ? `«${op.item?.name}» подарено: ${op.recipient?.nick}` : 'Готово. Предмет обновлён.');this.changed.emit();await this.reload();
  }catch(e){this.fail(e);}finally{this.busy.set(false);}
 }
 async equip(item: Item) {this.confirm(item.equipped?'unequip':'equip',item);await this.perform();}
 async showHistory(item: Item) {
  const version=++this.historyVersion;this.menu.set(null);this.detail.set(item);this.history.set(null);this.error.set('');
  try{const events=await this.request<Event[]>(`/items/${item.id}/history`);if(version===this.historyVersion && this.detail()?.id===item.id)this.history.set(events);}catch(e){if(version===this.historyVersion)this.fail(e);}
 }
 preview(item: Item){this.menu.set(null);this.detail.set(null);this.error.set('');this.themePreview.set(item);}
 requestEquip(item: Item){if(item.kind==='wallpaper')return;if(!item.equipped && ['frame','theme'].includes(item.kind))this.preview(item);else void this.equip(item);}
 rawAvatar(){const url=this.avatarUrl();return url ? url+(url.includes('?')?'&':'?')+'include_frame=false' : this.presetImage('cat');}
 itemStatus(item: Item){return item.revoked ? 'Отозван' : (item.in_use??item.equipped) ? 'Используется' : 'В инвентаре';}
 openCatalogMenu(entry: Catalog,event: MouseEvent){event.stopPropagation();this.catalogMenu.set(entry);}
 beginGrant(entry: Catalog){
  if(this.busy()||entry.hidden)return;
  if(this.embedded()){this.catalogMenu.set(null);this.grantRequested.emit(entry);return;}
  this.catalogMenu.set(null);this.selectedCatalog=entry.id;this.grantOpen.set(true);
  setTimeout(()=>{const target=this.element.nativeElement.querySelector<HTMLElement>('.grant-target');target?.querySelector<HTMLInputElement>('input')?.focus({preventScroll:true});});
 }
 editCatalog(entry: Catalog){this.catalogMenu.set(null);this.edit(entry);}
 async toggleCatalogVisibility(entry: Catalog){
  if(this.busy())return;
  if(!window.confirm(entry.hidden ? `Вернуть «${entry.name}» в выдачу?` : `Скрыть «${entry.name}» из будущих выдач? Полученные экземпляры сохранятся.`))return;
  this.busy.set(true);this.error.set('');
  try{await this.request('/catalog/'+entry.id,'PATCH',{hidden:!entry.hidden});this.catalogMenu.set(null);await this.reload();this.success.set(entry.hidden?'Предмет возвращён в выдачу':'Предмет скрыт из выдачи');}catch(e){this.fail(e);}finally{this.busy.set(false);}
 }
 async markRead() {try{await this.request('/read','POST',{});await this.reload();}catch(e){this.fail(e);}}
 dismiss() {if(!this.busy())this.close.emit();}
 keydown(event: KeyboardEvent) {
  if(this.embedded()&&!this.pending()&&!this.giftItem()&&!this.themePreview()&&!this.detail()&&!this.eventsOpen()&&!this.uploadOpen()&&!this.editing()&&!this.grantOpen())return;
  if(event.key==='Escape'){event.stopPropagation();if(!this.busy()){if(this.menu()){this.menu.set(null);this.menuTrigger?.focus();}else if(this.pending()||this.giftItem()||this.themePreview()||this.detail()||this.eventsOpen()||this.uploadOpen()||this.editing()||this.grantOpen())this.closePanel();else this.dismiss();}}
  if(event.key!=='Tab')return;
  const root=this.element.nativeElement.querySelector(this.pending()?'.confirm':(this.giftItem()||this.themePreview()||this.detail()||this.eventsOpen()||this.uploadOpen()||this.editing()||this.grantOpen())?'.subpanel':'.inventory');
  const nodes=Array.from(root?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select')??[]).filter(e=>e.offsetParent!==null);
  const first=nodes[0],last=nodes[nodes.length-1];
  if(event.shiftKey && (document.activeElement===first || !root?.contains(document.activeElement))){event.preventDefault();last?.focus();}
  else if(!event.shiftKey && (document.activeElement===last || !root?.contains(document.activeElement))){event.preventDefault();first?.focus();}
 }
}
