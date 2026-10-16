import {Component, computed, input, signal} from '@angular/core';

@Component({selector:'app-friend-link',standalone:true,template:`
  <section aria-label="Пригласить в друзья">
    <label for="friend-invite-link">Пригласить в друзья</label>
    <div class="link-row"><input id="friend-invite-link" #link readonly [value]="url()" (click)="link.select()" /><button type="button" (click)="copy(link)">{{copied()?'Скопировано':'Копировать'}}</button></div>
    @if(canShare){<button class="share" type="button" [disabled]="sharing()" (click)="share()">Поделиться</button>}
    <small role="status">{{notice()}}</small>
  </section>`,styles:[`
    :host{display:block;margin-top:20px}section{border-top:1px solid var(--palette-border);padding-top:16px}label{display:block;font-size:13px;margin-bottom:8px;color:var(--palette-muted)}.link-row{display:flex;gap:6px;min-width:0}input{min-width:0;flex:1;padding:9px;border:1px solid var(--palette-border);border-radius:7px;background:var(--palette-canvas);color:var(--palette-text);font:inherit;font-size:13px}button{flex-shrink:0;padding:9px;border:1px solid var(--palette-border);border-radius:7px;background:var(--palette-raised);color:var(--palette-text);font:inherit;font-size:12px;cursor:pointer}.share{margin-top:8px}small{display:block;min-height:16px;margin-top:6px;color:var(--palette-muted);font-size:12px}button:focus-visible,input:focus-visible{outline:2px solid var(--palette-primary);outline-offset:2px}
  `]})
export class FriendLinkComponent {
  readonly userId=input.required<string>();
  readonly url=computed(()=>window.location.origin+'/?friend='+encodeURIComponent(this.userId()));
  readonly copied=signal(false);readonly notice=signal('');readonly sharing=signal(false);
  readonly canShare=typeof navigator.share==='function';
  async copy(input:HTMLInputElement){
    try{await navigator.clipboard.writeText(this.url());this.copied.set(true);this.notice.set('Ссылка скопирована');}
    catch{input.focus();input.select();this.notice.set('Выделите и скопируйте ссылку вручную.');}
  }
  async share(){
    this.sharing.set(true);this.notice.set('');
    try{await navigator.share({title:'Добавить в друзья в Квачате',url:this.url()});}
    catch(e){if(!(e instanceof DOMException && e.name==='AbortError'))this.notice.set('Не удалось поделиться. Скопируйте ссылку.');}
    finally{this.sharing.set(false);}
  }
}
