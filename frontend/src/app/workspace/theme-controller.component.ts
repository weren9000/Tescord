import {ResourceRefreshService} from '../core/services/resource-refresh.service';
import {Component, effect, inject, input, OnDestroy} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';

interface ThemeState {id:string|null;scheme:'light'|'dark';palette:Record<string,string>;}
@Component({selector:'app-theme-controller',standalone:true,template:''})
export class ThemeControllerComponent implements OnDestroy {
 readonly token=input.required<string>();readonly revision=input(0);
 private readonly refreshEvents=inject(ResourceRefreshService);
 private readonly http=inject(HttpClient);private version=0;private applied:string|null=null;private keys:string[]=[];private account='';
 constructor(){effect(cleanup=>{
  const token=this.token();this.revision();
  if(token!==this.account){this.clear();this.account=token;}
  void this.load(token);
  const refreshSub=this.refreshEvents.changes$.subscribe(()=>{if(!document.hidden)void this.load(token);});
  cleanup(()=>{++this.version;refreshSub.unsubscribe();});
 });}
 private async load(token:string){
  if(!token)return;const version=++this.version;
  try{const theme=await firstValueFrom(this.http.get<ThemeState>(API_BASE_URL+'/api/inventory/theme',{headers:{Authorization:'Bearer '+token}}));
   if(version!==this.version||theme.id===this.applied)return;
   this.clear();if(!theme.id)return;
   const root=document.documentElement;root.dataset['uiTheme']=theme.id;root.dataset['uiScheme']=theme.scheme;root.style.colorScheme=theme.scheme;
   for(const [key,value] of Object.entries(theme.palette)){
    if(!/^[a-z-]+$/.test(key)||!/^#[0-9a-f]{6}$/i.test(value))continue;
    root.style.setProperty('--palette-'+key,value);
    root.style.setProperty('--rgb-'+key,[1,3,5].map(i=>parseInt(value.slice(i,i+2),16)).join(' '));this.keys.push(key);
   }
   this.applied=theme.id;
  }catch{/* Keep the last verified theme during a temporary connection failure. */}
 }
 private clear(){const root=document.documentElement;for(const key of this.keys){root.style.removeProperty('--palette-'+key);root.style.removeProperty('--rgb-'+key);}this.keys=[];delete root.dataset['uiTheme'];delete root.dataset['uiScheme'];root.style.removeProperty('color-scheme');this.applied=null;}
 ngOnDestroy(){++this.version;this.clear();}
}
