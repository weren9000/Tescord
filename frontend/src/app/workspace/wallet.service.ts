import {DestroyRef, Injectable, inject, signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';
export interface WalletOperation {id:string;currency:'coins'|'crystals';delta:number;balance_after:number;reason:string;created_at:string;actor_name?:string;actor_id?:string}
export interface Wallet {coins:number;crystals:number;user_id:string;nick:string;public_id:number;items:WalletOperation[];page:number;pages:number;total:number}
@Injectable({providedIn:'root'})
export class WalletService {
  readonly balance=signal<Wallet|null>(null);readonly error=signal(false);
  private token='';private loading=false;private readonly http=inject(HttpClient);
  constructor(){const timer=setInterval(()=>{if(this.token&&!document.hidden)void this.refresh();},20000);inject(DestroyRef).onDestroy(()=>clearInterval(timer));}
  connect(token:string){if(this.token===token)return;this.token=token;this.balance.set(null);this.error.set(false);void this.refresh();}
  async refresh(){const token=this.token;if(!token||this.loading)return;this.loading=true;
    try{const wallet=await firstValueFrom(this.http.get<Wallet>(API_BASE_URL+'/api/wallet',{headers:{Authorization:'Bearer '+token}}));if(this.token===token){this.balance.set(wallet);this.error.set(false);}}
    catch{if(this.token===token)this.error.set(true);}finally{this.loading=false;if(token!==this.token&&this.token)void this.refresh();}
  }
}
