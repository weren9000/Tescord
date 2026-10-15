import {Component, OnInit, OnDestroy, inject, input, output, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {HttpClient,HttpErrorResponse} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';
import {AssetPreviewComponent} from './asset-preview.component';

interface Catalog {id:string;name:string;kind:string;hidden:boolean}
interface Person {id:string;nick:string;public_id:number}
interface Page<T>{items:T[];page:number;pages:number;total:number}
interface Payload {request_id:string;catalog_ids:string[];recipient_ids:string[];skip_existing:boolean;retry_of?:string}
interface Result {request_id?:string;total:number;ready:number;granted:number;skipped:number;failed:number;rows:{catalog_id:string;recipient_id:string;name:string;nick:string;status:string;reason?:string}[]}
@Component({selector:'app-batch-grant',standalone:true,imports:[CommonModule,FormsModule,AssetPreviewComponent],templateUrl:'./batch-grant.component.html',styleUrl:'./batch-grant.component.scss'})
export class BatchGrantComponent implements OnInit,OnDestroy{
 readonly token=input.required<string>();readonly actorId=input.required<string>();readonly issued=output<void>();
 readonly step=signal<'items'|'people'|'review'|'result'>('items');
 readonly catalog=signal<Page<Catalog>>({items:[],page:1,pages:1,total:0});readonly users=signal<Page<Person>>({items:[],page:1,pages:1,total:0});
 readonly selectedItems=signal<Catalog[]>([]);readonly selectedUsers=signal<Person[]>([]);
 readonly busy=signal(false);readonly loading=signal(false);readonly error=signal('');readonly notice=signal('');readonly result=signal<Result|null>(null);
 readonly history=signal<{id:string;created_at:string;granted:number;skipped:number;failed:number}[]>([]);
 kind='avatar';query='';userQuery='';onlySelected=false;skipExisting=true;
 pending:Payload|null=null;private previewPayload:Payload|null=null;private version=0;private readonly http=inject(HttpClient);
 private key(){return 'kva-batch-draft:'+this.actorId();}
 private request<T>(path:string,body?:unknown){return firstValueFrom(this.http.request<T>(body===undefined?'GET':'POST',API_BASE_URL+'/api/inventory'+path,{body,headers:{Authorization:'Bearer '+this.token()}}));}
 ngOnInit(){try{const d=JSON.parse(sessionStorage.getItem(this.key())??'null');if(d && Array.isArray(d.items)&&Array.isArray(d.users)){this.selectedItems.set(d.items.slice(0,500));this.selectedUsers.set(d.users.slice(0,500));this.skipExisting=d.skip!==false;this.pending=d.pending??null;if(this.pending)this.step.set('review');}}catch{}void this.loadItems();void this.loadHistory();if(this.pending)void this.recover();}
 ngOnDestroy(){++this.version;this.save();}
 save(){try{sessionStorage.setItem(this.key(),JSON.stringify({items:this.selectedItems(),users:this.selectedUsers(),skip:this.skipExisting,pending:this.pending}));}catch{this.notice.set('Черновик не удалось сохранить в браузере. Не закрывайте страницу до завершения.');}}
 count(){return this.selectedItems().length*this.selectedUsers().length;}
 isRetry(){return !!(this.pending??this.previewPayload)?.retry_of;}
 hasItem(id:string){return this.selectedItems().some(x=>x.id===id);}hasUser(id:string){return this.selectedUsers().some(x=>x.id===id);}
 toggleItem(item:Catalog){if(this.pending||this.busy()||item.hidden)return;this.selectedItems.update(old=>old.some(x=>x.id===item.id)?old.filter(x=>x.id!==item.id):[...old,item]);this.save();}
 toggleUser(person:Person){if(this.pending||this.busy())return;this.selectedUsers.update(old=>old.some(x=>x.id===person.id)?old.filter(x=>x.id!==person.id):[...old,person]);this.save();}
 selectPage(){if(this.pending||this.busy())return;this.selectedItems.update(old=>[...old,...this.catalog().items.filter(x=>!x.hidden&&!old.some(y=>x.id===y.id))]);this.save();}
 clearItems(){if(this.pending||this.busy())return;this.selectedItems.set([]);this.save();}
 image(id:string){return API_BASE_URL+'/api/inventory/assets/'+encodeURIComponent(id)+'?preview=true';}
 avatar(id:string){return API_BASE_URL+'/api/users/'+id+'/avatar?preview=true';}
 private fail(e:unknown){const detail=e instanceof HttpErrorResponse?e.error?.detail:null;this.error.set(typeof detail==='string'?detail:'Не удалось выполнить запрос. Повторите попытку.');}
 async loadItems(page=1){const version=++this.version;this.loading.set(true);this.error.set('');try{const d=await this.request<Page<Catalog>>('/catalog?'+new URLSearchParams({kind:this.kind,q:this.query,page:String(page)}));if(version===this.version)this.catalog.set(d);}catch(e){if(version===this.version)this.fail(e);}finally{if(version===this.version)this.loading.set(false);}}
 async loadUsers(page=1){const version=++this.version;this.loading.set(true);this.error.set('');try{const d=await this.request<Page<Person>>('/batches/recipients?'+new URLSearchParams({q:this.userQuery,page:String(page)}));if(version===this.version)this.users.set(d);}catch(e){if(version===this.version)this.fail(e);}finally{if(version===this.version)this.loading.set(false);}}
 people(){return this.onlySelected?this.selectedUsers():this.users().items;}
 toItems(){if(this.pending||this.busy())return;this.step.set('items');this.result.set(null);void this.loadItems(this.catalog().page);}
 toPeople(){if(this.pending||this.busy())return;this.step.set('people');this.result.set(null);void this.loadUsers();}
 async review(){if(!this.count()||this.count()>500||this.busy()||this.pending)return;this.busy.set(true);this.error.set('');this.save();const body:Payload={request_id:crypto.randomUUID(),catalog_ids:this.selectedItems().map(x=>x.id),recipient_ids:this.selectedUsers().map(x=>x.id),skip_existing:this.skipExisting};try{this.result.set(await this.request<Result>('/batches/preview',body));this.previewPayload=body;this.step.set('review');}catch(e){this.fail(e);}finally{this.busy.set(false);}}
 async submit(){const body=this.pending??this.previewPayload;if(!body||this.busy())return;this.pending=body;this.save();this.busy.set(true);this.error.set('');try{const r=await this.request<Result>('/batches',body);this.result.set(r);this.pending=null;this.previewPayload=null;this.step.set('result');this.notice.set('');this.save();void this.loadHistory();}catch(e){if(e instanceof HttpErrorResponse && [400,401,403,409,422].includes(e.status)){this.pending=null;this.save();}this.fail(e);this.notice.set('Результат не подтверждён. Повтор использует тот же номер операции и не создаст дубликатов.');}finally{this.busy.set(false);}}
 async recover(){if(!this.pending)return;try{const r=await this.request<Result>('/batches/'+this.pending.request_id);this.result.set(r);this.pending=null;this.step.set('result');this.notice.set('');this.save();}catch(e){if(!(e instanceof HttpErrorResponse && e.status===404))this.fail(e);this.notice.set('Есть незавершённый запрос. Проверьте результат или повторите отправку с тем же номером.');}}
 async loadHistory(){try{this.history.set(await this.request('/batches'));}catch(e){this.fail(e);}}
 async showResult(id:string){if(this.pending||this.busy())return;this.busy.set(true);this.error.set('');try{this.result.set(await this.request<Result>('/batches/'+id));this.step.set('result');}catch(e){this.fail(e);}finally{this.busy.set(false);}}
 async retryFailed(){const previous=this.result();if(!previous?.request_id||!previous.failed||this.busy()||this.pending)return;this.busy.set(true);this.error.set('');const body:Payload={request_id:crypto.randomUUID(),catalog_ids:[],recipient_ids:[],skip_existing:this.skipExisting,retry_of:previous.request_id};try{this.result.set(await this.request<Result>('/batches/preview',body));this.previewPayload=body;this.step.set('review');}catch(e){this.fail(e);}finally{this.busy.set(false);}}
 reset(){if(this.pending||this.busy())return;this.selectedItems.set([]);this.selectedUsers.set([]);this.result.set(null);this.previewPayload=null;this.notice.set('');this.error.set('');this.step.set('items');this.save();void this.loadItems();}
 status(value:string){return ({ready:'Будет выдано',granted:'Выдано',skipped:'Пропущено',failed:'Ошибка'} as Record<string,string>)[value]??value;}
}
