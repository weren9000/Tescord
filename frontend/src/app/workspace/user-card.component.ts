import {AfterViewInit, Component, DestroyRef, ElementRef, ViewChild, effect, inject, input, output, signal, untracked} from '@angular/core';
import {HttpClient, HttpErrorResponse} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';
import {UserCardService} from './user-card.service';
interface Person {user_id:string;nick:string;public_id:number;avatar_updated_at:string|null;state:'self'|'unavailable'|'friends'|'outgoing'|'incoming'|'ready';request_id:string|null;server_id:string|null}
@Component({selector:'app-user-card',standalone:true,template:`
 <dialog #dialog aria-label="Карточка пользователя" (cancel)="$event.preventDefault();close()" (click)="backdrop($event)" (keydown)="$event.stopPropagation()">
  <section><header><strong>Пользователь</strong><button type="button" aria-label="Закрыть карточку пользователя" (click)="close()">×</button></header>
   @if(person();as p){<div class="identity"><img [src]="avatar(p)" alt="" width="64" height="64"/><div><h3>{{p.nick}}</h3><small>ID {{p.public_id}}</small></div></div>
    <div class="actions">
     @switch(p.state){
      @case('self'){<button type="button" (click)="profile.emit();close()">Мой профиль</button>}
      @case('ready'){<button type="button" [disabled]="busy()" (click)="act('send')">{{busy()?'Отправляем…':'Добавить в друзья'}}</button>}
      @case('outgoing'){<p role="status">Заявка отправлена</p><button type="button" [disabled]="busy()" (click)="act('cancel')">Отменить заявку</button>}
      @case('incoming'){<p>Хочет добавить вас в друзья</p><button type="button" [disabled]="busy()" (click)="act('accept')">Принять заявку</button><button type="button" [disabled]="busy()" (click)="act('reject')">Отклонить</button>}
      @case('friends'){<button type="button" [disabled]="busy()" (click)="write()">Написать сообщение</button>}
      @case('unavailable'){<p>Добавление в друзья недоступно.</p>}
     }
     @if(voiceControls()){<button type="button" (click)="voice.emit(p.user_id);close()">Громкость и действия участника</button>}
    </div>
   }@else if(loading()){<p role="status">Загрузка…</p>}
   @if(error()){<p role="alert">{{error()}}</p><button type="button" [disabled]="busy()" (click)="load()">Обновить</button>}
  </section>
 </dialog>`,styles:[`
 dialog{position:fixed;margin:0;box-sizing:border-box;width:300px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:auto;padding:0;border:1px solid var(--palette-border);border-radius:14px;background:var(--palette-surface);color:var(--palette-text);box-shadow:0 14px 48px #0004}dialog::backdrop{background:#0003}section{padding:16px}header{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px}button{font:inherit;font-size:13px;border:1px solid var(--palette-border);border-radius:8px;padding:10px 12px;min-height:40px;cursor:pointer;background:var(--palette-raised);color:inherit}button:focus-visible{outline:2px solid var(--palette-primary);outline-offset:2px}button:disabled{opacity:.55}.identity{display:flex;gap:12px;align-items:center;margin:16px 0}.identity img{border-radius:22%;object-fit:cover;flex-shrink:0}.identity div{min-width:0}h3{font-size:17px;margin:0 0 4px;overflow-wrap:anywhere}small,p{font-size:13px;color:var(--palette-muted)}.actions{display:grid;gap:8px}.actions p{margin:4px 0}@media(max-width:640px){dialog{left:12px!important;top:auto!important;bottom:12px;width:calc(100vw - 24px)}button{min-height:44px}}
 `]})
export class UserCardComponent implements AfterViewInit {
 readonly token=input.required<string>();readonly voiceControls=input(false);readonly profile=output<void>();readonly chat=output<string>();readonly voice=output<string>();
 readonly cards=inject(UserCardService);readonly person=signal<Person|null>(null);readonly busy=signal(false);readonly loading=signal(false);readonly error=signal('');
 @ViewChild('dialog') dialog!:ElementRef<HTMLDialogElement>;
 private readonly http=inject(HttpClient);private version=0;private alive=true;
 constructor(){effect(()=>{this.cards.selected();this.cards.revision();this.token();untracked(()=>void this.load());});const timer=setInterval(()=>{if(!document.hidden&&!this.busy())void this.load(true);},5000);inject(DestroyRef).onDestroy(()=>{this.alive=false;this.version++;clearInterval(timer);});}
 ngAfterViewInit(){this.dialog.nativeElement.showModal();this.position();}
 close(){this.dialog?.nativeElement.close();this.cards.close();}
 private position(){const node=this.dialog?.nativeElement,rect=this.cards.selected()?.rect;if(!node||!rect)return;const width=node.offsetWidth,height=node.offsetHeight;node.style.left=Math.max(12,Math.min(innerWidth-width-12,rect.right+8))+'px';node.style.top=Math.max(12,Math.min(innerHeight-height-12,rect.top))+'px';}
 backdrop(event:MouseEvent){if(event.target!==this.dialog.nativeElement)return;const r=this.dialog.nativeElement.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)this.close();}
 private headers(){return {Authorization:'Bearer '+this.token()};}
 avatar(p:Person){return API_BASE_URL+'/api/users/'+p.user_id+'/avatar?v='+encodeURIComponent(p.avatar_updated_at??'')+'&motion='+!matchMedia('(prefers-reduced-motion: reduce)').matches;}
 async load(silent=false){const id=this.cards.selected()?.id;if(!id||this.busy())return;const version=++this.version;if(!silent){this.loading.set(true);this.error.set('');if(this.person()?.user_id!==id)this.person.set(null);}
  try{const person=await firstValueFrom(this.http.get<Person>(API_BASE_URL+'/api/friends/users/'+id,{headers:this.headers()}));if(this.alive&&version===this.version){this.person.set(person);setTimeout(()=>{if(this.alive)this.position();});}}
  catch(e){if(this.alive&&version===this.version&&!silent)this.error.set(e instanceof HttpErrorResponse&&e.status===404?'Пользователь недоступен':'Не удалось загрузить карточку.');}finally{if(version===this.version)this.loading.set(false);}}
 async act(action:'send'|'cancel'|'accept'|'reject'){const p=this.person();if(!p||this.busy())return;this.busy.set(true);this.error.set('');++this.version;
  try{await firstValueFrom(this.http.post(API_BASE_URL+'/api/friends/requests'+(action==='send'?'':'/'+p.request_id+'/'+action),action==='send'?{user_id:p.user_id}:{},{headers:this.headers()}));this.cards.revision.update(v=>v+1);}
  catch(e){if(this.alive)this.error.set(e instanceof HttpErrorResponse&&typeof e.error?.detail==='string'?e.error.detail:'Не удалось обработать заявку.');}
  finally{this.busy.set(false);if(this.alive)await this.load(true);}}
 async write(){const p=this.person();if(!p||this.busy())return;if(p.server_id){this.chat.emit(p.server_id);this.close();return;}this.busy.set(true);
  try{const result=await firstValueFrom(this.http.post<{id:string}>(API_BASE_URL+'/api/conversations/direct',{user_id:p.user_id},{headers:this.headers()}));if(this.alive){this.chat.emit(result.id);this.close();}}
  catch{this.error.set('Не удалось открыть переписку.');}finally{this.busy.set(false);}}
}
