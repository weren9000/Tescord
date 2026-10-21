import {PlatformIconEditorComponent} from './platform-icon-editor.component';
import {PlatformInvitationsComponent} from './platform-invitations.component';
import {DatePipe} from '@angular/common';
import {Component, ElementRef, viewChild, computed, effect, inject, input, output, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {firstValueFrom} from 'rxjs';
import {PlatformApiService, PlatformMember, PlatformSummary} from '../core/api/platform-api.service';
import {ConversationSummary} from '../core/models/conversation.models';
import {UiIconComponent} from './ui-icon.component';
import {API_BASE_URL} from '../core/api/api-base';

@Component({
  selector: 'app-platform-chats', standalone: true, imports: [FormsModule, UiIconComponent, DatePipe, PlatformIconEditorComponent, PlatformInvitationsComponent],
  templateUrl: './platform-chats.component.html',
  styleUrl: './platform-chats.component.scss',
})
export class PlatformChatsComponent {
  private readonly api = inject(PlatformApiService);
  readonly token = input.required<string>();
  readonly platform = input<PlatformSummary | null>(null);
  readonly chats = input<ConversationSummary[]>([]);
  readonly selected = input<string | null>(null);
  readonly changed = output<string | null>();
  readonly open = output<string>();
  readonly back = output<void>();
  readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  readonly panel = signal<'create'|'join'|'settings'|'search'|'chat'|null>(null);
  readonly tab = signal('general');
  readonly notice = signal('');
  readonly memberMenu = signal<string|null>(null);
  readonly failedAvatars = signal(new Set<string>());
  readonly confirmation = signal<{title:string;description:string;action:()=>void}|null>(null);
  readonly joined = output<string>();
  readonly message = output<PlatformSearchResult>();
  readonly activeVoiceChat = input<string|null>(null);
  readonly entryMode = input<'create'|'join'>('create');
  readonly createRequest = input(0);
  readonly entryOpened = output<void>();
  readonly entryInvite = input('');
  private createSeen = 0;
  memberQuery=''; messageQuery='';
  readonly preview = signal<{name:string;description:string|null;icon_url?:string|null}|null>(null);
  readonly tabs = [{id:'general',label:'Основное',icon:'info'},{id:'members',label:'Участники',icon:'profile'},{id:'invites',label:'Приглашения',icon:'plus'},{id:'notifications',label:'Уведомления',icon:'settings'},{id:'manage',label:'Управление',icon:'settings'}];
  readonly members = signal<PlatformMember[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly editing = signal<string | null>(null);
  readonly voiceCounts = signal<Record<string,number>>({});
  readonly results = signal<PlatformSearchResult[] | null>(null);
  readonly manager = computed(() => ['owner','admin'].includes(this.platform()?.member_role ?? ''));
  query=''; name=''; description=''; newChatName=''; chatName=''; inviteToken='';
  visible(): ConversationSummary[] {return this.chats().filter(c => c.title.toLocaleLowerCase('ru').includes(this.query.trim().toLocaleLowerCase('ru')));}
  private previousPlatform: string | null = null;
  constructor(){
    effect(()=>{const n=this.createRequest();if(!n){this.createSeen=0;return;}if(this.dialog() && n!==this.createSeen){this.createSeen=n;this.show(this.entryMode());if(this.entryMode()==='join'&&this.entryInvite()){this.inviteToken=this.entryInvite();this.previewInvite();}this.entryOpened.emit();}});
    effect(onCleanup=>{
    const id=this.platform()?.id ?? null;
    const token=this.token();
    if(id!==this.previousPlatform){this.previousPlatform=id;this.members.set([]);this.editing.set(null);this.error.set('');this.results.set(null);this.voiceCounts.set({});}
    if(!id)return;
    let stopped=false;
    const refresh=async()=>{try{const rows=await firstValueFrom(this.api.request<{chat_id:string;count:number}[]>(token,'GET',`/${id}/voice-presence`));if(!stopped)this.voiceCounts.set(Object.fromEntries(rows.map(r=>[r.chat_id,r.count])));}catch{}};
    void refresh();const timer=setInterval(()=>void refresh(),5000);
    onCleanup(()=>{stopped=true;clearInterval(timer);});
  });}
  iconUrl(path:string|null|undefined):string{return path?API_BASE_URL+path:'';}
  roleLabel(role: string): string {return role==='owner'?'Владелец':role==='admin'?'Администратор':'Пользователь';}
  canManage(member: PlatformMember): boolean {return member.role!=='owner' && (this.platform()?.member_role==='owner' || (this.platform()?.member_role==='admin' && member.role==='member'));}
  async run(action: () => Promise<void>): Promise<void> {
    if(this.busy())return;
    this.busy.set(true);this.error.set('');
    try{await action();}catch(error: any){this.error.set(typeof error?.error?.detail==='string'?error.error.detail:'Не удалось выполнить действие. Повторите попытку.');}finally{this.busy.set(false);}
  }
  async request<T>(method: string, suffix='', body?: unknown): Promise<T>{return firstValueFrom(this.api.request<T>(this.token(),method,`/${this.platform()!.id}${suffix}`,body));}
  async refresh(chatId: string | null=null): Promise<void>{await this.api.refresh(this.token());this.changed.emit(chatId);}
  createPlatform(): void{void this.run(async()=>{const p=await firstValueFrom(this.api.request<PlatformSummary & {chat_id:string}>(this.token(),'POST','',{name:this.name.trim(),description:this.description.trim()||null}));await this.refresh(p.chat_id);this.close();this.name='';});}
  join(): void{void this.run(async()=>{const token=this.inviteCode();const p=await firstValueFrom(this.api.request<PlatformSummary>(this.token(),'POST',`/join/${encodeURIComponent(token)}`));await this.api.refresh(this.token());this.joined.emit(p.id);this.close();this.inviteToken='';});}
  openSettings(): void{this.show('settings');this.name=this.platform()!.name;this.description=this.platform()!.description??'';void this.run(async()=>{this.members.set(await this.request<PlatformMember[]>('GET','/members'));});}
  save(): void{void this.run(async()=>{await this.request('PATCH','',{name:this.name.trim(),description:this.description});await this.refresh();this.notice.set('Изменения сохранены');});}
  addChat(): void{void this.run(async()=>{const chat=await this.request<{id:string}>('POST','/chats',{name:this.newChatName});this.newChatName='';await this.refresh(chat.id);this.close();});}
  rename(chat: ConversationSummary): void{void this.run(async()=>{await this.request('PATCH',`/chats/${chat.id}`,{name:this.chatName});this.editing.set(null);await this.refresh();this.close();});}
  moveUp(chat: ConversationSummary): void{void this.run(async()=>{const ids=this.chats().map(c=>c.id);const i=ids.indexOf(chat.id);if(i<1)return;[ids[i-1],ids[i]]=[ids[i],ids[i-1]];await this.request('PUT','/chats/order',{chat_ids:ids});await this.refresh();});}
  deleteChat(chat: ConversationSummary): void{void this.run(async()=>{await this.request('DELETE',`/chats/${chat.id}`);await this.refresh();this.close();});}
  searchMessages(): void{void this.run(async()=>{this.results.set(await this.request('GET',`/search?query=${encodeURIComponent(this.messageQuery.trim())}`));});}
  notify(enabled: boolean): void{void this.run(async()=>{await this.request('PUT','/notifications',{enabled});await this.refresh();});}
  role(member: PlatformMember): void{void this.run(async()=>{await this.request('PUT',`/members/${member.user_id}/role`,{role:member.role==='admin'?'member':'admin'});this.members.set(await this.request('GET','/members'));await this.refresh();});}
  transfer(member: PlatformMember): void{void this.run(async()=>{await this.request('POST','/transfer',{user_id:member.user_id});this.members.set(await this.request('GET','/members'));await this.refresh();this.memberMenu.set(null);this.notice.set('Владение передано');});}
  remove(member: PlatformMember): void{void this.run(async()=>{await this.request('DELETE',`/members/${member.user_id}`);this.members.set(await this.request('GET','/members'));await this.refresh();this.memberMenu.set(null);});}
  leave(): void{void this.run(async()=>{await this.request('POST','/leave');await this.refresh();this.close();});}
  deletePlatform(): void{void this.run(async()=>{await this.request('DELETE');await this.refresh();this.close();});}
  show(panel: 'create'|'join'|'settings'|'search'|'chat'): void {
    this.error.set('');this.notice.set('');this.confirmation.set(null);this.memberMenu.set(null);
    if(panel==='create'){this.name='';this.description='';}
    if(panel==='join'){this.preview.set(null);}
    this.panel.set(panel);
    this.dialog()?.nativeElement.showModal();
  }
  close(): void {this.dialog()?.nativeElement.close();this.panel.set(null);this.confirmation.set(null);}
  dismiss(event: Event): void {event.preventDefault();if(this.busy())return;if(this.confirmation()){this.confirmation.set(null);return;}this.close();}
  backdrop(event: MouseEvent): void {if(!this.busy()&&event.target===this.dialog()?.nativeElement){const r=this.dialog()!.nativeElement.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)this.close();}}
  editChat(chat?: ConversationSummary): void {this.editing.set(chat?.id??null);this.chatName=chat?.title??'';this.newChatName='';this.show('chat');}
  editingChat(): ConversationSummary | undefined {return this.chats().find(c=>c.id===this.editing());}
  saveChat(): void {const chat=this.editingChat();if(chat)this.rename(chat);else this.addChat();}
  filteredMembers(): PlatformMember[]{return this.members().filter(m=>m.nick.toLocaleLowerCase().includes(this.memberQuery.trim().toLocaleLowerCase()));}
  ask(title: string, description: string, action:()=>void): void {this.confirmation.set({title,description,action});}
  confirmAction(): void {const c=this.confirmation();this.confirmation.set(null);c?.action();}
  askDeleteChat(chat:ConversationSummary):void{this.ask('Удалить чат «'+chat.title+'»?', 'Сообщения и вложения этого чата будут удалены. Остальные чаты сохранятся.',()=>this.deleteChat(chat));}
  askRemove(m:PlatformMember):void{this.ask('Удалить '+m.nick+' с площадки?', 'Участник потеряет доступ ко всем чатам площадки.',()=>this.remove(m));}
  askTransfer(m:PlatformMember):void{this.ask('Передать владение '+m.nick+'?', 'Вы станете администратором. Новый владелец сможет управлять всей площадкой.',()=>this.transfer(m));}
  askLeave():void{this.ask('Покинуть площадку?', 'Вы потеряете доступ ко всем её чатам. Для возвращения понадобится приглашение.',()=>this.leave());}
  askDelete():void{this.ask('Удалить площадку «'+this.platform()?.name+'»?', 'Все чаты, сообщения и приглашения площадки будут удалены без возможности восстановления.',()=>this.deletePlatform());}
  move(chat:ConversationSummary,delta:number):void{void this.run(async()=>{const ids=this.chats().map(c=>c.id);const i=ids.indexOf(chat.id);const j=i+delta;if(i<0||j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];await this.request('PUT','/chats/order',{chat_ids:ids});await this.refresh();this.notice.set('Порядок чатов обновлён');});}
  inviteCode():string{const value=this.inviteToken.trim();try{return new URL(value).pathname.split('/').filter(Boolean).pop()??'';}catch{return value;}}
  previewInvite():void{void this.run(async()=>{this.preview.set(await firstValueFrom(this.api.request<{name:string;description:string|null;icon_url?:string|null}>(this.token(),'GET',`/invitation/${encodeURIComponent(this.inviteCode())}`)));});}
  openResult(result:PlatformSearchResult):void{this.message.emit(result);this.close();}
  dateExpired(date:string|null):boolean{return !!date&&Date.parse(date)<=Date.now();}
  avatar(member:PlatformMember):string{return `${API_BASE_URL}/api/users/${encodeURIComponent(member.user_id)}/avatar?v=${encodeURIComponent(member.avatar_updated_at??'default')}&motion=false`;}
  avatarFailed(id:string):void{this.failedAvatars.update(ids=>new Set([...ids,id]));}

}

export interface PlatformSearchResult {id:string;channel_id:string;chat_id:string;chat_name:string;author:string;content:string;created_at:string}
