import { Component, ElementRef, effect, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../core/api/api-base';

interface Person { id: string; nick: string; public_id: number; avatar_updated_at: string | null; }
interface Item { id: string; catalog_id: string; name: string; kind: string; equipped: boolean; revoked: boolean; owner: Person | null; }
interface Notice { id: string; action: string; name: string; actor: Person | null; created_at: string; unread: boolean; }
interface Event { action: string; actor: Person | null; recipient: Person | null; created_at: string; }
interface Collection { items: Item[]; notifications: Notice[]; unread: number; }
interface Catalog { id: string; name: string; kind: string; }
interface Pending { action: string; item: Item | null; recipient: Person | null; request_id: string; catalog_id?: string; }

@Component({
 selector: 'app-inventory', standalone: true, imports: [CommonModule, FormsModule],
 templateUrl: './inventory.component.html', styleUrl: './inventory.component.scss'
})
export class InventoryComponent {
 readonly token = input.required<string>();
 readonly mode = input<'inventory' | 'admin' | null>(null);
 readonly isAdmin = input(false);
 readonly close = output<void>();
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
 readonly giftItem = signal<Item | null>(null);
 readonly history = signal<Event[] | null>(null);
 readonly busy = signal(false);
 readonly loading = signal(false);
 readonly searched = signal(false);
 readonly error = signal('');
 readonly success = signal('');
 readonly tab = signal('avatar');
 readonly adminTab = signal<'grant' | 'issued'>('grant');
 readonly menu = signal<Item | null>(null);
 readonly detail = signal<Item | null>(null);
 readonly eventsOpen = signal(false);
 readonly unreadCount = signal(0);
 menuX=0; menuY=0;
 private menuTrigger: HTMLElement | null = null;
 queryChanged() {++this.searchVersion;this.recipient.set(null);this.people.set([]);this.searched.set(false);}
 toggleMenu(item: Item, event: MouseEvent) {
  event.stopPropagation();
  if(this.menu()?.id===item.id){this.menu.set(null);return;}
  const rect=(event.currentTarget as HTMLElement).getBoundingClientRect();
  this.menuTrigger=event.currentTarget as HTMLElement;
  this.menuX=Math.max(12,Math.min(rect.left,window.innerWidth-192));
  this.menuY=Math.max(12,Math.min(rect.bottom+6,window.innerHeight-160));
  this.menu.set(item);
  setTimeout(()=>this.element.nativeElement.querySelector<HTMLButtonElement>('.item-menu button')?.focus());
 }
 closePanel() {if(this.busy())return;if(this.pending())this.pending.set(null);else{this.giftItem.set(null);this.detail.set(null);this.eventsOpen.set(false);}}
 async clearRecipient() {this.recipient.set(null);this.query='';this.people.set([]);this.searched.set(false);this.offset=0;if(this.mode()==='admin')await this.page(0);}
 query = '';
 selectedCatalog = 'cyber-oni';
 offset = 0;
 private searchVersion = 0;
 private equipmentSnapshot: string | null = null;
 readonly labels: Record<string, string> = {grant:'Выдача',gift:'Подарок',revoke:'Отзыв',equip:'Использование',unequip:'Снятие'};

 constructor() {
  effect(onCleanup=>{
   const selector=this.pending()?'.confirm':(this.giftItem()||this.detail()||this.eventsOpen())?'.subpanel':null;
   if(!selector)return;
   const previous=document.activeElement as HTMLElement | null;
   const timer=setTimeout(()=>this.element.nativeElement.querySelector<HTMLElement>(selector+' button')?.focus());
   onCleanup(()=>{clearTimeout(timer);if(previous?.isConnected)previous.focus();else this.menuTrigger?.focus();});
  });
  effect((onCleanup) => {
   const token = this.token();
   const mode = this.mode();
   const previousFocus=document.activeElement as HTMLElement | null;
   const focusTimer=mode ? setTimeout(()=>this.element.nativeElement.querySelector<HTMLButtonElement>('header button')?.focus()) : undefined;
   onCleanup(()=>{clearTimeout(focusTimer);if(mode)previousFocus?.focus();});
   this.pending.set(null); this.giftItem.set(null); this.recipient.set(null);
   this.menu.set(null);this.detail.set(null);this.eventsOpen.set(false);this.adminTab.set('grant');
   this.history.set(null); this.people.set([]); this.searched.set(false); this.query=''; this.offset=0;
   this.error.set(''); this.success.set('');
   if (!token) return;
   let cancelled=false;
   const poll = async () => {
    try {
     const data = await this.request<Collection>('', 'GET', undefined, token);
     if(cancelled)return;
     this.accept(data);
    } catch { /* Keep last snapshot during a transient background connection failure. */ }
   };
   void this.reload();
   const timer=setInterval(()=>void poll(),15000);
   onCleanup(()=>{cancelled=true;clearInterval(timer);clearTimeout(focusTimer);if(mode)previousFocus?.focus();});
  });
 }
 image(id: string) { return `${API_BASE_URL}/api/inventory/assets/${encodeURIComponent(id)}`; }
 private accept(data: Collection) {
  const snapshot=data.items.filter(i=>i.equipped).map(i=>i.id).sort().join(',');
  if(this.equipmentSnapshot!==null && snapshot!==this.equipmentSnapshot)this.changed.emit();
  this.equipmentSnapshot=snapshot;
  this.items.set(data.items);this.notices.set(data.notifications);this.unread.emit(data.unread);
  this.unreadCount.set(data.unread);
 }
 avatar(p: Person) { return `${API_BASE_URL}/api/users/${p.id}/avatar?v=${encodeURIComponent(p.avatar_updated_at ?? 'default')}`; }
 private request<T>(path: string, method='GET', body?: unknown, token=this.token()) {
  return firstValueFrom(this.http.request<T>(method, `${API_BASE_URL}/api/inventory${path}`, {body,headers:{Authorization:`Bearer ${token}`}}));
 }
 private fail(e: unknown) { this.error.set(e instanceof HttpErrorResponse ? (e.error?.detail ?? 'Не удалось выполнить действие. Попробуйте ещё раз.') : 'Не удалось выполнить действие.'); }
 async reload() {
  this.loading.set(true);
  try {
   const data=await this.request<Collection>('');
   this.accept(data);
   if(this.mode()==='admin' && this.isAdmin()) {
    this.catalog.set(await this.request<Catalog[]>('/catalog'));
    await this.loadIssued();
   }
  } catch(e){this.fail(e);} finally{this.loading.set(false);}
 }
 async loadIssued() {
  this.issued.set(await this.request<Item[]>(`/issued?offset=${this.offset}${this.recipient() ? '&owner_id='+this.recipient()!.id : ''}`));
 }
 async page(delta: number) {
  this.offset=Math.max(0,this.offset+delta);this.loading.set(true);
  try{await this.loadIssued();}catch(e){this.fail(e);}finally{this.loading.set(false);}
 }
 async search() {
  const version=++this.searchVersion;
  this.recipient.set(null);this.error.set('');this.searched.set(false);
  if(this.query.trim().length<2){this.people.set([]);return;}
  try{const users=await this.request<Person[]>('/users?q='+encodeURIComponent(this.query.trim()));if(version===this.searchVersion){this.people.set(users);this.searched.set(true);}}
  catch(e){this.fail(e);}
 }
 async choose(person: Person) {
  this.recipient.set(person);this.people.set([]);this.offset=0;
  if(this.mode()==='admin')try{await this.loadIssued();}catch(e){this.fail(e);}
 }
 startGift(item: Item) {this.menu.set(null);this.giftItem.set(item);this.recipient.set(null);this.people.set([]);this.searched.set(false);this.query='';this.history.set(null);}
 confirm(action: string, item: Item | null) {
  if(this.busy())return;
  this.menu.set(null);
  const recipient=action==='revoke'?item?.owner ?? null:this.recipient();
  if((action==='grant'||action==='gift')&&!recipient)return;
  this.pending.set({action,item,recipient,request_id:crypto.randomUUID(),catalog_id:this.selectedCatalog});this.error.set('');this.success.set('');
 }
 async perform() {
  const op=this.pending();if(!op||this.busy())return;
  this.busy.set(true);this.error.set('');
  try {
   await this.request(op.action==='grant'?'/grant':`/items/${op.item!.id}/${op.action}`, 'POST',
     {request_id:op.request_id,recipient_id:['gift','grant','revoke'].includes(op.action) ? op.recipient?.id ?? null : null,...(op.action==='grant'?{catalog_id:op.catalog_id}:{})});
   this.pending.set(null);this.giftItem.set(null);this.success.set('Готово. Инвентарь обновлён.');this.changed.emit();await this.reload();
  }catch(e){this.fail(e);}finally{this.busy.set(false);}
 }
 async equip(item: Item) {this.confirm(item.equipped?'unequip':'equip',item);await this.perform();}
 async showHistory(item: Item) {this.menu.set(null);this.detail.set(item);this.history.set(null);try{this.history.set(await this.request<Event[]>(`/items/${item.id}/history`));}catch(e){this.fail(e);}}
 async markRead() {try{await this.request('/read','POST',{});await this.reload();}catch(e){this.fail(e);}}
 dismiss() {if(!this.busy())this.close.emit();}
 keydown(event: KeyboardEvent) {
  if(event.key==='Escape'){event.stopPropagation();if(!this.busy()){if(this.menu()){this.menu.set(null);this.menuTrigger?.focus();}else if(this.pending()||this.giftItem()||this.detail()||this.eventsOpen())this.closePanel();else this.dismiss();}}
  if(event.key!=='Tab')return;
  const root=this.element.nativeElement.querySelector(this.menu()?'.item-menu':this.pending()?'.confirm':(this.giftItem()||this.detail()||this.eventsOpen())?'.subpanel':'.inventory');
  const nodes=Array.from(root?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select')??[]).filter(e=>e.offsetParent!==null);
  const first=nodes[0],last=nodes[nodes.length-1];
  if(event.shiftKey && (document.activeElement===first || !root?.contains(document.activeElement))){event.preventDefault();last?.focus();}
  else if(!event.shiftKey && (document.activeElement===last || !root?.contains(document.activeElement))){event.preventDefault();first?.focus();}
 }
}
