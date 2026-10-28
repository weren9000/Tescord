import {Component, OnInit, OnDestroy, inject, input, signal} from '@angular/core';
import {DatePipe} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {firstValueFrom} from 'rxjs';
import {PlatformApiService} from '../core/api/platform-api.service';
import {API_BASE_URL} from '../core/api/api-base';
interface Friend {user_id:string;nick:string;avatar_updated_at?:string|null;state:'available'|'member'|'pending'|'rejected'}
interface Link {id:string;expires_at:string|null;revoked_at:string|null;uses:number;max_uses:number|null}
@Component({selector:'app-platform-invitations',standalone:true,imports:[FormsModule,DatePipe],templateUrl:'./platform-invitations.component.html',styleUrl:'./platform-invitations.component.scss'})
export class PlatformInvitationsComponent implements OnInit,OnDestroy {
 readonly token=input.required<string>();readonly platformId=input.required<string>();
 readonly tab=signal<'friends'|'links'>('friends');readonly friends=signal<Friend[]>([]);readonly links=signal<Link[]>([]);
 readonly selected=signal(new Set<string>());readonly busy=signal(false);readonly error=signal('');readonly notice=signal('');readonly link=signal('');
 readonly failed=signal(new Set<string>());query='';hours:number|null=24;limit:number|null=null;private alive=true;private createdId:string|null=null;
 private api=inject(PlatformApiService);
 ngOnInit(){void this.refresh();}ngOnDestroy(){this.alive=false;}
 request<T>(method:string,suffix:string,body?:unknown){return firstValueFrom(this.api.request<T>(this.token(),method,'/'+this.platformId()+suffix,body));}
 async run(work:()=>Promise<void>){if(this.busy())return;this.busy.set(true);this.error.set('');this.notice.set('');try{await work();}catch(e:any){if(this.alive)this.error.set(typeof e?.error?.detail==='string'?e.error.detail:'Не удалось выполнить действие. Повторите попытку.');}finally{if(this.alive)this.busy.set(false);}}
 refresh(){return this.run(async()=>{const [friends,links]=await Promise.all([this.request<Friend[]>('GET','/friend-invites'),this.request<Link[]>('GET','/invites')]);if(!this.alive)return;this.friends.set(friends);this.links.set(links);});}
 filtered(){return this.friends().filter(f=>f.nick.toLocaleLowerCase().includes(this.query.trim().toLocaleLowerCase()));}
 toggle(id:string){this.selected.update(ids=>{const next=new Set(ids);next.has(id)?next.delete(id):next.add(id);return next;});}
 send(ids=[...this.selected()]){void this.run(async()=>{const result=await this.request<{sent:number}>('POST','/friend-invites',{user_ids:ids});if(!this.alive)return;this.selected.set(new Set());this.notice.set('Отправлено приглашений: '+result.sent);this.friends.set(await this.request<Friend[]>('GET','/friend-invites'));});}
 validLimit(){return this.limit===null || Number.isInteger(this.limit)&&this.limit>=1&&this.limit<=10000;}
 create(){if(!this.validLimit())return;void this.run(async()=>{const result=await this.request<{id:string;token:string}>('POST','/invites',{expires_in_hours:this.hours,max_uses:this.limit});if(!this.alive)return;this.createdId=result.id;this.link.set('https://kvachat.ru/platform-invite/'+result.token);this.links.set(await this.request<Link[]>('GET','/invites'));});}
 revoke(id:string){void this.run(async()=>{await this.request('DELETE','/invites/'+id);if(id===this.createdId)this.link.set('');if(this.alive)this.links.set(await this.request<Link[]>('GET','/invites'));});}
 async copy(){try{await navigator.clipboard.writeText(this.link());this.notice.set('Ссылка скопирована');}catch{this.error.set('Выделите ссылку и скопируйте вручную.');}}
 state(link:Link){return link.revoked_at?'Отключена':link.expires_at&&Date.parse(link.expires_at)<=Date.now()?'Срок истёк':link.max_uses!==null&&link.uses>=link.max_uses?'Лимит исчерпан':'Активна';}
 avatar(f:Friend){return API_BASE_URL+'/api/users/'+f.user_id+'/avatar?motion=false&v='+encodeURIComponent(f.avatar_updated_at??'default');}
 failedAvatar(id:string){this.failed.update(ids=>new Set([...ids,id]));}
}
