import {Component, inject, input, output, signal, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {HttpClient, HttpErrorResponse} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';
import {WalletService} from './wallet.service';

interface BatchRow {user_id:string;name:string;before:number|null;after:number|null;error:string;status?:string}
interface BatchResult {batch_id:string;state:'preview'|'complete';items:BatchRow[];applied?:number}
interface BatchRequest {request_id:string;user_ids:string[];currency:string;action:string;amount:number;reason:string}

@Component({
 selector:'app-admin-wallet-batch', standalone:true, imports:[CommonModule,FormsModule],
 templateUrl:'./admin-wallet-batch.component.html', styleUrl:'./admin-wallet-batch.component.scss'
})
export class AdminWalletBatchComponent implements OnInit {
 readonly token=input.required<string>();readonly actorId=input.required<string>();readonly userIds=input.required<string[]>();
 readonly close=output<void>();readonly changed=output<void>();
 readonly busy=signal(false);readonly error=signal('');readonly result=signal<BatchResult|null>(null);
 readonly request=signal<BatchRequest|null>(null);readonly confirming=signal(false);
 currency='coins';action='credit';amount:number|null=null;reason='';
 private readonly http=inject(HttpClient);private readonly wallet=inject(WalletService);
 private get key(){return 'kva.admin.batch.'+this.actorId();}
 ngOnInit(){try{const saved=JSON.parse(localStorage.getItem(this.key)??'null');if(saved?.request?.request_id){this.request.set(saved.request);this.confirming.set(!!saved.confirming);void this.preview(saved.request);}}catch{this.error.set('Не удалось восстановить операцию.');}}
 private headers(){return {Authorization:'Bearer '+this.token()};}
 private message(e:unknown){return e instanceof HttpErrorResponse&&typeof e.error?.detail==='string'?e.error.detail:'Ответ сервера не получен. Повторите запрос — операция не выполнится дважды.';}
 private save(){localStorage.setItem(this.key,JSON.stringify({request:this.request(),confirming:this.confirming()}));}
 get eligible(){return this.result()?.items.filter(r=>!r.error).length??0;}
 get total(){return this.eligible*(this.request()?.amount??0);}
 async prepare(){
  if(this.busy())return;
  if(!this.userIds().length||!Number.isSafeInteger(this.amount)||this.amount!<1||this.amount!>1e9||!this.reason.trim()){
   this.error.set('Выберите пользователей, целую сумму от 1 до 1 000 000 000 и причину.');return;
  }
  const request={request_id:crypto.randomUUID(),user_ids:[...this.userIds()],currency:this.currency,action:this.action,amount:this.amount!,reason:this.reason.trim()};
  this.request.set(request);await this.preview(request);
 }
 async preview(request=this.request()){
  if(!request||this.busy())return;this.busy.set(true);this.error.set('');
  try{this.save();const result=await firstValueFrom(this.http.post<BatchResult>(API_BASE_URL+'/api/admin/wallet-batches/preview',request,{headers:this.headers()}));this.result.set(result);
   if(result.state==='complete'){localStorage.removeItem(this.key);this.changed.emit();}}
  catch(e){this.error.set(this.message(e));}finally{this.busy.set(false);}
 }
 async confirm(){
  const result=this.result();if(!result||this.busy()||result.state==='complete')return;
  this.busy.set(true);this.error.set('');this.confirming.set(true);
  try{this.save();const complete=await firstValueFrom(this.http.post<BatchResult>(API_BASE_URL+'/api/admin/wallet-batches/'+result.batch_id+'/confirm',{}, {headers:this.headers()}));
   this.result.set(complete);localStorage.removeItem(this.key);this.changed.emit();void this.wallet.refresh();}
  catch(e){this.error.set(this.message(e));}finally{this.busy.set(false);}
 }
 reset(){if(this.busy()||(this.confirming()&&this.result()?.state!=='complete'))return;localStorage.removeItem(this.key);this.request.set(null);this.result.set(null);this.confirming.set(false);this.error.set('');}
}
