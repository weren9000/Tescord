import {Component, ElementRef, effect, inject, input, output, signal, untracked, OnDestroy} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {HttpClient, HttpErrorResponse} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';

interface Choice {id:string;name:string;asset?:string;}
interface State {selected:string|null;scale:number;dim:number;personal:string|null;presets:Choice[];items:Choice[];}
export interface WallpaperStyle {image:string;size:string;}
@Component({selector:'app-wallpapers',standalone:true,imports:[FormsModule],templateUrl:'./wallpapers.component.html',styleUrl:'./wallpapers.component.scss'})
export class WallpapersComponent implements OnDestroy {
 readonly token=input.required<string>(); readonly open=input(false); readonly revision=input(0);
 readonly close=output<void>(); readonly applied=output<WallpaperStyle>();
 readonly http=inject(HttpClient); readonly element=inject<ElementRef<HTMLElement>>(ElementRef);
 readonly data=signal<State|null>(null); readonly error=signal(''); readonly busy=signal(false);
 selected:string|null=null;scale=100;dim=35;
 private personalUrl='';private personalKey='';private version=0;private accountToken='';
 constructor(){
  effect(cleanup=>{const token=this.token();this.revision();this.open();
   if(token!==this.accountToken){this.accountToken=token;this.data.set(null);this.personalKey='';if(this.personalUrl)URL.revokeObjectURL(this.personalUrl);this.personalUrl='';this.applied.emit({image:'none',size:'auto'});}
   untracked(()=>void this.load(token));
   const timer=setInterval(()=>{if(!this.open()&&!this.busy())void this.load(token);},15000);
   cleanup(()=>{clearInterval(timer);++this.version;});
  });
  effect(cleanup=>{if(!this.open())return;const previous=document.activeElement as HTMLElement;
   const timer=setTimeout(()=>this.element.nativeElement.querySelector<HTMLButtonElement>('.close')?.focus());
   cleanup(()=>{clearTimeout(timer);previous?.focus();});
  });
 }
 private request<T>(path='',method='GET',body?:unknown,token=this.token()){
  return firstValueFrom(this.http.request<T>(method,API_BASE_URL+'/api/wallpapers'+path,{body,headers:{Authorization:'Bearer '+token}}));
 }
 private fail(e:unknown){const detail=e instanceof HttpErrorResponse?e.error?.detail:null;this.error.set(typeof detail==='string'?detail:'Не удалось сохранить обои. Попробуйте ещё раз.');}
 async load(token=this.token()){
  if(!token)return;const version=++this.version;
  try{const data=await this.request<State>('','GET',undefined,token);if(version!==this.version)return;
   if(data.personal!==this.personalKey){
    let url='';
    if(data.personal){const blob=await firstValueFrom(this.http.get(API_BASE_URL+'/api/wallpapers/personal/'+data.personal,{headers:{Authorization:'Bearer '+token},responseType:'blob'}));if(version!==this.version)return;url=URL.createObjectURL(blob);}
    if(this.personalUrl)URL.revokeObjectURL(this.personalUrl);this.personalUrl=url;this.personalKey=data.personal??'';
   }
   this.data.set(data);this.selected=data.selected;this.scale=data.scale;this.dim=data.dim;
   this.applied.emit(this.style(data.selected,data.scale,data.dim));
  }catch(e){if(version===this.version&&this.open())this.fail(e);}
 }
 url(id:string|null):string{
  if(!id)return '';if(id==='personal')return this.personalUrl;
  if(id.startsWith('item:')){const asset=this.data()?.items.find(i=>i.id===id)?.asset;return asset?API_BASE_URL+asset:'';}
  return API_BASE_URL+'/api/wallpapers/presets/'+encodeURIComponent(id);
 }
 style(id=this.selected,scale=this.scale,dim=this.dim):WallpaperStyle{
  const url=this.url(id);return {image:url?`linear-gradient(rgba(12,16,26,${dim/100}),rgba(12,16,26,${dim/100})),url("${url}")`:'none',size:`auto, ${640*scale/100}px auto`};
 }
 async save(){if(this.busy())return;this.busy.set(true);this.error.set('');
  try{await this.request('','PUT',{selected:this.selected,scale:+this.scale,dim:+this.dim});await this.load();this.close.emit();}catch(e){this.fail(e);}finally{this.busy.set(false);}
 }
 dismiss(){if(!this.busy()){this.error.set('');this.close.emit();}}
 keydown(event:KeyboardEvent){
  if(event.key==='Escape'){event.stopPropagation();this.dismiss();}
  if(event.key!=='Tab')return;
  const nodes=Array.from(this.element.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')).filter(e=>e.offsetParent!==null);
  const first=nodes[0],last=nodes[nodes.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 }
 ngOnDestroy(){++this.version;if(this.personalUrl)URL.revokeObjectURL(this.personalUrl);}
}
