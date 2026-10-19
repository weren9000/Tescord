import {Component, effect, inject, input, output, signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';
interface Preview {nick:string;state:'login'|'ready'|'self'|'friends';server_id?:string}
@Component({selector:'app-friend-invite',standalone:true,template:`
 <section aria-label="Приглашение в друзья">
  <h2>Приглашение в друзья</h2>
  @if(loading()){<p role="status">Проверяем приглашение…</p>}
  @if(error()){<p role="alert">{{error()}}</p><button type="button" (click)="load()" [disabled]="busy()">Повторить</button>}
  @if(preview();as person){
    <strong>{{person.nick}}</strong>
    @if(labels[person.state]){<p role="status">{{labels[person.state]}}</p>}
    @if(person.state==='ready'){<p role="status">Добавляем в друзья…</p>}
  }
  <button type="button" [disabled]="busy()" (click)="close.emit()">{{token()?'Закрыть':'Продолжить без приглашения'}}</button>
 </section>`,styles:[`
 :host{display:block}section{box-sizing:border-box;width:100%;padding:20px;border:1px solid var(--palette-border);border-radius:12px;background:var(--palette-surface);color:var(--palette-text)}h2{font-size:18px;margin:0 0 16px}strong{font-size:17px;overflow-wrap:anywhere}p{font-size:14px;line-height:1.5;color:var(--palette-muted)}button{margin:8px 8px 0 0;padding:10px 12px;border:1px solid var(--palette-border);border-radius:7px;background:var(--palette-raised);color:var(--palette-text);font:inherit;font-size:13px;cursor:pointer}button.primary{background:var(--palette-primary);color:white}button:disabled{opacity:.6}button:focus-visible{outline:2px solid var(--palette-cyan);outline-offset:2px}
 `]})
export class FriendInviteComponent {
 readonly userId=input.required<string>();readonly token=input('');readonly close=output<void>();readonly joined=output<string>();
 readonly preview=signal<Preview|null>(null);readonly loading=signal(true);readonly busy=signal(false);readonly error=signal('');
 readonly labels={login:'Войдите или зарегистрируйтесь — вы добавитесь в друзья автоматически.',ready:'',self:'Это ваша ссылка.',friends:'Вы в друзьях.'};
 private readonly http=inject(HttpClient);private version=0;
 constructor(){effect(()=>{this.userId();this.token();void this.load();});}
 private headers():Record<string,string>{return this.token()?{Authorization:'Bearer '+this.token()}:{};}
 async load(){const version=++this.version;this.loading.set(true);this.error.set('');this.preview.set(null);
  try{const endpoint=API_BASE_URL+'/api/friends/invites/'+encodeURIComponent(this.userId());
    const result=await firstValueFrom(this.http.get<Preview>(endpoint,{headers:this.headers()}));
    if(version!==this.version)return;
    this.preview.set(result);
    if(this.token()&&result.state==='ready'){
      this.busy.set(true);
      const joined=await firstValueFrom(this.http.post<Preview>(endpoint,{},{headers:this.headers()}));
      if(version!==this.version)return;
      this.preview.set(joined);if(joined.server_id)this.joined.emit(joined.server_id);
    }
  }
  catch(e:any){if(version===this.version){this.preview.set(null);this.error.set(e.status===404||e.status===422?'Ссылка истекла или отозвана. Попросите новую.':'Не удалось принять приглашение. Повторите попытку.');}}
  finally{if(version===this.version){this.loading.set(false);this.busy.set(false);}}
 }
}
