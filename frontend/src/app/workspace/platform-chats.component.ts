import {Component, computed, effect, inject, input, output, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {firstValueFrom} from 'rxjs';
import {PlatformApiService, PlatformMember, PlatformSummary} from '../core/api/platform-api.service';
import {ConversationSummary} from '../core/models/conversation.models';
import {UiIconComponent} from './ui-icon.component';

@Component({
  selector: 'app-platform-chats', standalone: true, imports: [FormsModule, UiIconComponent],
  template: `
    <header>
      <button type="button" aria-label="Назад к площадкам" (click)="back.emit()"><app-ui-icon name="back"/></button>
      <div><strong>{{platform()?.name || 'Площадки'}}</strong><small>Чаты сообщества</small></div>
      @if(platform()) {<button type="button" aria-label="Настройки площадки" (click)="openSettings()"><app-ui-icon name="more"/></button>}
    </header>
    @if(error()){<p role="alert" class="error">{{error()}}</p>}
    @if(busy()){<p role="status">Сохраняем…</p>}
    @if(!platform()){
      <p>Выберите площадку или создайте новую.</p>
      <label>Название<input [(ngModel)]="name" maxlength="80"/></label>
      <button class="wide" [disabled]="busy() || !name.trim()" (click)="createPlatform()">Создать площадку</button>
      <label>Приглашение<input [(ngModel)]="inviteToken" placeholder="Ссылка или код"/></label>
      <button class="wide" [disabled]="busy() || !inviteToken.trim()" (click)="join()">Присоединиться</button>
    } @else if(settings()) {
      <button class="wide" (click)="settings.set(false)"><app-ui-icon name="back"/>К чатам</button>
      @if(manager()){
        <label>Название<input [(ngModel)]="name" maxlength="80"/></label>
        <label>Описание<textarea [(ngModel)]="description" maxlength="2000"></textarea></label>
        <button class="wide" [disabled]="busy() || !name.trim()" (click)="save()">Сохранить</button>
        <button class="wide" [disabled]="busy()" (click)="invite()"><app-ui-icon name="plus"/>Пригласить по ссылке</button>
        @if(inviteLink()){<label>Ссылка действует 7 дней<input readonly [value]="inviteLink()" (focus)="$any($event.target).select()"/></label>}
        @for(link of invites();track link.id){<div class="chat-edit"><span>{{link.revoked_at?'Отключено':'Приглашение'}} · использований: {{link.uses}}</span>@if(!link.revoked_at){<button [disabled]="busy()" (click)="revoke(link.id)">Отключить</button>}</div>}
      }
      <label class="check"><input type="checkbox" [ngModel]="platform()!.notifications_enabled" (ngModelChange)="notify($event)"/>Уведомления площадки</label>
      <h3>Участники · {{members().length}}</h3>
      <div class="members">
        @for(member of members();track member.user_id){
          <article><strong>{{member.nick}}</strong><small>{{roleLabel(member.role)}}</small>
            @if(canManage(member)){
              @if(platform()!.member_role==='owner'){
                <button [disabled]="busy()" (click)="role(member)">{{member.role==='admin'?'Снять администратора':'Назначить администратором'}}</button>
                <button [disabled]="busy()" (click)="transfer(member)">Передать владение</button>
              }
              <button [disabled]="busy()" (click)="remove(member)">Удалить с площадки</button>
            }
          </article>
        }
      </div>
      @if(platform()!.member_role==='owner'){
        <button class="wide danger" [disabled]="busy()" (click)="deletePlatform()">Удалить площадку</button>
      }@else{<button class="wide danger" [disabled]="busy()" (click)="leave()">Покинуть площадку</button>}
    } @else {
      <label class="search"><app-ui-icon name="search"/><input [(ngModel)]="query" placeholder="Найти чат" aria-label="Найти чат"/></label>
      <button class="wide" [disabled]="busy() || !query.trim()" (click)="searchMessages()">Найти сообщения во всех чатах</button>
      @if(results() !== null){<section aria-label="Результаты поиска"><button class="wide" (click)="results.set(null)">Закрыть результаты</button>@for(result of results();track result.id){<button class="wide" (click)="open.emit(result.chat_id)"><span><strong>{{result.chat_name}} · {{result.author}}</strong><small>{{result.content}}</small></span></button>}@empty{<p>Сообщения не найдены</p>}</section>}
      <nav aria-label="Чаты площадки">
        @for(chat of visible(); track chat.id){
          <div class="chat-row">
            <button class="chat" [class.active]="selected()===chat.id" [attr.aria-current]="selected()===chat.id?'page':null" (click)="open.emit(chat.id)">
              <app-ui-icon name="chat"/><span><strong>{{chat.title}}</strong><small>{{chat.subtitle || 'Начните общение'}}</small></span>
              @if(chat.unread_count){<b class="badge">{{chat.mention_unread_count?'@':''}}{{chat.unread_count}}</b>}
              @if(voiceCounts()[chat.id]){<small class="voice" [attr.aria-label]="'В созвоне: '+voiceCounts()[chat.id]">● {{voiceCounts()[chat.id]}}</small>}
            </button>
            @if(manager()){<button aria-label="Действия чата" (click)="editing.set(editing()===chat.id?null:chat.id);chatName=chat.title"><app-ui-icon name="more"/></button>}
          </div>
          @if(editing()===chat.id && manager()){
            <div class="chat-edit"><input aria-label="Название чата" [(ngModel)]="chatName" maxlength="80"/>
              <button [disabled]="busy() || !chatName.trim()" (click)="rename(chat)">Сохранить</button>
              <button [disabled]="busy() || $first" (click)="moveUp(chat)">Выше</button>
              <button [disabled]="busy()" (click)="deleteChat(chat)">Удалить чат</button>
            </div>
          }
        } @empty {<p>{{query ? 'Чаты не найдены' : 'Чатов пока нет'}}</p>}
      </nav>
      @if(manager()){
        <form (ngSubmit)="addChat()"><label>Новый чат<input [(ngModel)]="newChatName" name="chat" maxlength="80" placeholder="Например, Игры"/></label>
          <button class="wide" [disabled]="busy() || !newChatName.trim()"><app-ui-icon name="plus"/>Создать чат</button></form>
      }
      <small class="hint">Все участники площадки имеют доступ ко всем чатам. В созвоне — до 30 человек.</small>
    }
  `,
  styles: [`:host{display:flex;flex-direction:column;min-height:0;height:100%;overflow:auto;background:var(--palette-surface);color:var(--palette-text);font-size:13px}
    header{display:flex;align-items:center;gap:8px;padding:14px 10px;border-bottom:1px solid var(--palette-border)}header div{flex:1;min-width:0}header strong{display:block;overflow:hidden;text-overflow:ellipsis}small{display:block;color:var(--palette-muted);font-size:12px}button,input,textarea{font:inherit;color:inherit;border:1px solid var(--palette-border);border-radius:8px;background:var(--palette-raised);padding:9px}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}button:hover{background:var(--palette-hover)}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--palette-primary);outline-offset:2px}label{display:flex;flex-direction:column;gap:6px;margin:12px}input,textarea{min-width:0;width:100%;box-sizing:border-box}.wide{margin:8px 12px;display:flex;align-items:center;gap:8px;justify-content:center}.search{flex-direction:row;align-items:center}.search input{flex:1}nav{flex:1;padding:6px}.chat-row{display:flex;align-items:center}.chat{flex:1;min-width:0;display:flex;gap:10px;align-items:center;text-align:left;border-color:transparent;background:transparent}.chat span{flex:1;min-width:0}.chat strong,.chat small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chat.active{background:var(--palette-selected)}.badge{padding:3px 6px;background:var(--palette-primary);color:white;border-radius:12px}.hint,p,h3{margin:12px;line-height:1.5}.chat-edit{display:flex;gap:6px;flex-wrap:wrap;margin:8px}.members article{display:flex;flex-direction:column;gap:5px;margin:12px;padding-bottom:10px;border-bottom:1px solid var(--palette-border)}.check{flex-direction:row;align-items:center}.check input{width:auto}.error,.danger{color:var(--palette-danger,#e87878)}@media(max-width:980px){button{min-height:44px}}`],
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
  readonly settings = signal(false);
  readonly members = signal<PlatformMember[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly editing = signal<string | null>(null);
  readonly inviteLink = signal('');
  readonly invites = signal<{id:string;revoked_at:string|null;uses:number}[]>([]);
  readonly voiceCounts = signal<Record<string,number>>({});
  readonly results = signal<{id:string;chat_id:string;chat_name:string;author:string;content:string}[] | null>(null);
  readonly manager = computed(() => ['owner','admin'].includes(this.platform()?.member_role ?? ''));
  query=''; name=''; description=''; newChatName=''; chatName=''; inviteToken='';
  visible(): ConversationSummary[] {return this.chats().filter(c => c.title.toLocaleLowerCase('ru').includes(this.query.trim().toLocaleLowerCase('ru')));}
  private previousPlatform: string | null = null;
  constructor(){effect(onCleanup=>{
    const id=this.platform()?.id ?? null;
    const token=this.token();
    if(id!==this.previousPlatform){this.previousPlatform=id;this.settings.set(false);this.members.set([]);this.invites.set([]);this.inviteLink.set('');this.editing.set(null);this.error.set('');this.results.set(null);this.voiceCounts.set({});}
    if(!id)return;
    let stopped=false;
    const refresh=async()=>{try{const rows=await firstValueFrom(this.api.request<{chat_id:string;count:number}[]>(token,'GET',`/${id}/voice-presence`));if(!stopped)this.voiceCounts.set(Object.fromEntries(rows.map(r=>[r.chat_id,r.count])));}catch{}};
    void refresh();const timer=setInterval(()=>void refresh(),5000);
    onCleanup(()=>{stopped=true;clearInterval(timer);});
  });}
  roleLabel(role: string): string {return role==='owner'?'Владелец':role==='admin'?'Администратор':'Пользователь';}
  canManage(member: PlatformMember): boolean {return member.role!=='owner' && (this.platform()?.member_role==='owner' || (this.platform()?.member_role==='admin' && member.role==='member'));}
  async run(action: () => Promise<void>): Promise<void> {
    if(this.busy())return;
    this.busy.set(true);this.error.set('');
    try{await action();}catch(error: any){this.error.set(typeof error?.error?.detail==='string'?error.error.detail:'Не удалось выполнить действие. Повторите попытку.');}finally{this.busy.set(false);}
  }
  async request<T>(method: string, suffix='', body?: unknown): Promise<T>{return firstValueFrom(this.api.request<T>(this.token(),method,`/${this.platform()!.id}${suffix}`,body));}
  async refresh(chatId: string | null=null): Promise<void>{await this.api.refresh(this.token());this.changed.emit(chatId);}
  createPlatform(): void{void this.run(async()=>{const p=await firstValueFrom(this.api.request<PlatformSummary & {chat_id:string}>(this.token(),'POST','',{name:this.name}));await this.refresh(p.chat_id);this.name='';});}
  join(): void{void this.run(async()=>{const token=this.inviteToken.trim().split('/').pop()!;const p=await firstValueFrom(this.api.request<PlatformSummary>(this.token(),'POST',`/join/${encodeURIComponent(token)}`));await this.refresh();this.inviteToken='';});}
  openSettings(): void{this.settings.set(true);this.name=this.platform()!.name;this.description=this.platform()!.description??'';void this.run(async()=>{this.members.set(await this.request<PlatformMember[]>('GET','/members'));if(this.manager())this.invites.set(await this.request('GET','/invites'));});}
  save(): void{void this.run(async()=>{await this.request('PATCH','',{name:this.name,description:this.description});await this.refresh();});}
  addChat(): void{void this.run(async()=>{const chat=await this.request<{id:string}>('POST','/chats',{name:this.newChatName});this.newChatName='';await this.refresh(chat.id);});}
  rename(chat: ConversationSummary): void{void this.run(async()=>{await this.request('PATCH',`/chats/${chat.id}`,{name:this.chatName});this.editing.set(null);await this.refresh();});}
  moveUp(chat: ConversationSummary): void{void this.run(async()=>{const ids=this.chats().map(c=>c.id);const i=ids.indexOf(chat.id);if(i<1)return;[ids[i-1],ids[i]]=[ids[i],ids[i-1]];await this.request('PUT','/chats/order',{chat_ids:ids});await this.refresh();});}
  deleteChat(chat: ConversationSummary): void{if(!confirm(`Удалить чат «${chat.title}» и его сообщения?`))return;void this.run(async()=>{await this.request('DELETE',`/chats/${chat.id}`);await this.refresh();});}
  invite(): void{void this.run(async()=>{const link=await this.request<{token:string}>('POST','/invites',{});this.inviteLink.set(`${location.origin}/platform-invite/${link.token}`);this.invites.set(await this.request('GET','/invites'));});}
  revoke(id: string): void{void this.run(async()=>{await this.request('DELETE',`/invites/${id}`);this.invites.set(await this.request('GET','/invites'));});}
  searchMessages(): void{void this.run(async()=>{this.results.set(await this.request('GET',`/search?query=${encodeURIComponent(this.query.trim())}`));});}
  notify(enabled: boolean): void{void this.run(async()=>{await this.request('PUT','/notifications',{enabled});await this.refresh();});}
  role(member: PlatformMember): void{void this.run(async()=>{await this.request('PUT',`/members/${member.user_id}/role`,{role:member.role==='admin'?'member':'admin'});this.members.set(await this.request('GET','/members'));await this.refresh();});}
  transfer(member: PlatformMember): void{if(!confirm(`Передать площадку пользователю ${member.nick}?`))return;void this.run(async()=>{await this.request('POST','/transfer',{user_id:member.user_id});this.members.set(await this.request('GET','/members'));await this.refresh();});}
  remove(member: PlatformMember): void{if(!confirm(`Удалить ${member.nick} с площадки?`))return;void this.run(async()=>{await this.request('DELETE',`/members/${member.user_id}`);this.members.set(await this.request('GET','/members'));await this.refresh();});}
  leave(): void{if(!confirm('Покинуть площадку и все её чаты?'))return;void this.run(async()=>{await this.request('POST','/leave');this.settings.set(false);await this.refresh();});}
  deletePlatform(): void{if(!confirm('Удалить площадку, все чаты и сообщения без возможности восстановления?'))return;void this.run(async()=>{await this.request('DELETE');this.settings.set(false);await this.refresh();});}
}
