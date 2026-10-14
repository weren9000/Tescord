import {AssetPreviewComponent} from './asset-preview.component';
import {Component, ElementRef, effect, inject, input, output, signal, untracked, OnDestroy} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {HttpClient, HttpErrorResponse} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';

interface Choice {id:string;name:string;asset?:string;}
interface Selection {selected:string|null;scale:number;dim:number;asset?:string|null;}
interface Context {shared:Selection;override:Selection|null;effective:Selection;source:'personal'|'peer'|'owner';can_manage:boolean;kind:string;name:string;}
interface State extends Selection {presets:Choice[];items:Choice[];context?:Context;}
export interface WallpaperStyle {image:string;size:string;}
type Target = 'personal'|'shared'|'profile';
@Component({selector:'app-wallpapers',standalone:true,imports:[AssetPreviewComponent, FormsModule],templateUrl:'./wallpapers.component.html',styleUrl:'./wallpapers.component.scss'})
export class WallpapersComponent implements OnDestroy {
 readonly previewErrors=signal(false); readonly previewRetry=signal(0);
 retryPreviews(){this.previewErrors.set(false);this.previewRetry.update(v=>v+1);}
 readonly token=input.required<string>(); readonly open=input(false); readonly revision=input(0); readonly serverId=input<string|null>(null);
 readonly close=output<void>(); readonly applied=output<WallpaperStyle>();
 readonly http=inject(HttpClient); readonly element=inject<ElementRef<HTMLElement>>(ElementRef);
 readonly data=signal<State|null>(null); readonly error=signal(''); readonly busy=signal(false);
 selected:string|null=null;scale=100;dim=35;target:Target='personal';inherit=true;
 private version=0;private contextKey='';
 constructor(){
  effect(cleanup=>{const token=this.token(),serverId=this.serverId();this.revision();const open=this.open();
   const key=token+'|'+serverId;
   if(key!==this.contextKey){this.contextKey=key;this.data.set(null);this.error.set('');this.target=serverId?'personal':'profile';this.applied.emit({image:'none',size:'auto'});}
   if(open)this.data.set(null);
   untracked(()=>void this.load(token,serverId));
   const refresh=()=>{if(!this.open()&&!this.busy()&&document.visibilityState==='visible')void this.load(token,serverId);};
   const timer=setInterval(refresh,15000);
   document.addEventListener('visibilitychange',refresh);
   cleanup(()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refresh);++this.version;});
  });
  effect(cleanup=>{if(!this.open())return;const previous=document.activeElement as HTMLElement;
   const timer=setTimeout(()=>this.element.nativeElement.querySelector<HTMLButtonElement>('.close')?.focus());
   cleanup(()=>{clearTimeout(timer);previous?.focus();});
  });
 }
 private path(serverId=this.serverId()){return serverId?'/chats/'+encodeURIComponent(serverId):'';}
 private request<T>(path='',method='GET',body?:unknown,token=this.token()){
  return firstValueFrom(this.http.request<T>(method,API_BASE_URL+'/api/wallpapers'+path,{body,headers:{Authorization:'Bearer '+token}}));
 }
 private fail(e:unknown){const detail=e instanceof HttpErrorResponse?e.error?.detail:null;this.error.set(typeof detail==='string'?detail:'Не удалось загрузить или сохранить обои. Попробуйте ещё раз.');}
 async load(token=this.token(),serverId=this.serverId()){
  if(!token)return;const version=++this.version;
  try{const data=await this.request<State>(this.path(serverId),'GET',undefined,token);if(version!==this.version)return;
   this.data.set(data);this.selectTarget(this.target);
   const choice=data.context?.effective;
   this.applied.emit(choice?this.assetStyle(choice.asset,choice.scale,choice.dim):{image:'none',size:'auto'});
  }catch(e){if(version===this.version&&this.open())this.fail(e);}
 }
 selectTarget(target:Target){
  const data=this.data();if(!data)return;
  this.target=!data.context?'profile':target==='shared'&&!data.context.can_manage?'personal':target;
  const selection=this.target==='profile'?data:this.target==='shared'?data.context!.shared:data.context!.override;
  this.inherit=this.target==='personal'&&!selection;
  this.selected=selection?.selected??null;this.scale=selection?.scale??100;this.dim=selection?.dim??35;
 }
 inheritedLabel(){return this.data()?.context?.kind==='direct'?'Обои собеседника':'Выбор владельца';}
 sourceLabel(){return this.data()?.context?.source==='personal'?'Ваши обои':this.inheritedLabel();}
 url(id:string|null):string{
  if(!id)return '';
  if(id.startsWith('item:')){const asset=this.data()?.items.find(i=>i.id===id)?.asset;return asset?API_BASE_URL+asset:'';}
  return API_BASE_URL+'/api/wallpapers/presets/'+encodeURIComponent(id);
 }
 private assetStyle(asset:string|null|undefined,scale:number,dim:number):WallpaperStyle{
  const url=asset?API_BASE_URL+asset:'';
  return {image:url?`linear-gradient(rgba(12,16,26,${dim/100}),rgba(12,16,26,${dim/100})),url("${url}")`:'none',size:`auto, ${640*scale/100}px auto`};
 }
 style():WallpaperStyle{
  if(this.target==='personal'&&this.inherit){const shared=this.data()?.context?.shared;return shared?this.assetStyle(shared.asset,shared.scale,shared.dim):{image:'none',size:'auto'};}
  const url=this.url(this.selected);return {image:url?`linear-gradient(rgba(12,16,26,${this.dim/100}),rgba(12,16,26,${this.dim/100})),url("${url}")`:'none',size:`auto, ${640*this.scale/100}px auto`};
 }
 async save(){if(this.busy())return;this.busy.set(true);this.error.set('');
  const token=this.token(),serverId=this.serverId(),key=this.contextKey;
  const body={selected:this.selected,scale:+this.scale,dim:+this.dim,target:this.target,inherit:this.inherit};
  try{await this.request(this.target==='profile'?'':this.path(serverId),'PUT',body,token);
   if(key!==this.contextKey)return;
   await this.load(token,serverId);if(key===this.contextKey)this.close.emit();
  }catch(e){if(key===this.contextKey)this.fail(e);}finally{this.busy.set(false);}
 }
 dismiss(){if(!this.busy()){this.error.set('');this.close.emit();}}
 keydown(event:KeyboardEvent){
  if(event.key==='Escape'){event.stopPropagation();this.dismiss();}
  if(event.key!=='Tab')return;
  const nodes=Array.from(this.element.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')).filter(e=>e.offsetParent!==null);
  const first=nodes[0],last=nodes[nodes.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 }
 ngOnDestroy(){++this.version;}
}
