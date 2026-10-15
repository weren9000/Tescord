import {DestroyRef, Injectable, inject} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {API_BASE_URL} from '../api/api-base';

@Injectable({providedIn:'root'})
export class ActivityService {
 private readonly http=inject(HttpClient);
 private token:string|null|undefined;
 private last=0;
 private readonly action=()=>{if(this.token && document.visibilityState==='visible')this.send();};
 constructor(){
  document.addEventListener('pointerdown',this.action,{passive:true});document.addEventListener('keydown',this.action,{passive:true});
  inject(DestroyRef).onDestroy(()=>{document.removeEventListener('pointerdown',this.action);document.removeEventListener('keydown',this.action);});
 }
 setToken(token:string|null){
  if(token===this.token)return;this.token=token;this.last=0;
  if(token){this.send();return;}
  try{
   const key='kva-visitor';let id=localStorage.getItem(key);if(!id){id=crypto.randomUUID();localStorage.setItem(key,id);}
   this.http.post(API_BASE_URL+'/api/analytics/visit',{browser_id:id}).subscribe({error:()=>{}});
  }catch{/* Analytics never prevents sign-in. */}
 }
 private send(){
  if(!this.token||Date.now()-this.last<60000)return;this.last=Date.now();
  this.http.post(API_BASE_URL+'/api/analytics/activity',{}, {headers:{Authorization:'Bearer '+this.token}}).subscribe({error:()=>{}});
 }
}
