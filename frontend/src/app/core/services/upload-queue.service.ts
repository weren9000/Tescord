import {Injectable, inject, signal, computed} from '@angular/core';
import {HttpClient, HttpEventType, HttpHeaders, HttpErrorResponse} from '@angular/common/http';
import {Observable, Subject, firstValueFrom, takeUntil, tap, filter} from 'rxjs';
import type {HttpEvent} from '@angular/common/http';
import {API_BASE_URL} from '../api/api-base';
import type {WorkspaceMessageUploadEvent} from '../api/workspace-api.service';
import type {WorkspaceMessage} from '../models/workspace.models';
export interface UploadPayload {content:string;files:File[];replyToMessageId?:string|null;clientMessageId:string;}
export interface UploadEntry {id:string;file:File;status:'waiting'|'uploading'|'ready'|'error';loaded:number;error:string;}
export interface UploadJob {token:string;channelId:string;title:string;payload:UploadPayload;entries:UploadEntry[];status:'uploading'|'finalizing'|'failed'|'paused'|'done';error:string;}
@Injectable({providedIn:'root'})
export class UploadQueueService {
  private readonly http=inject(HttpClient);
  readonly job=signal<UploadJob|null>(null);
  readonly limits=signal({max_files:10,max_file_bytes:500*1024*1024,max_message_bytes:500*1024*1024});
  readonly ready=computed(()=>this.job()?.entries.filter(e=>e.status==='ready').length??0);
  readonly total=computed(()=>this.job()?.entries.reduce((n,e)=>n+e.file.size,0)??0);
  readonly loaded=computed(()=>this.job()?.entries.reduce((n,e)=>n+e.loaded,0)??0);
  readonly percent=computed(()=>this.total()?Math.floor(this.loaded()*100/this.total()):0);
  readonly busy=computed(()=>['uploading','finalizing'].includes(this.job()?.status??''));
  title='';
  readonly uncertain=computed(()=>this.job()?.status==='failed' && this.job()?.entries.every(e=>e.status==='ready'));
  private headers(token:string){return new HttpHeaders({Authorization:'Bearer '+token});}
  async loadLimits(token:string){try{const limits=await firstValueFrom(this.http.get<{max_files:number;max_file_bytes:number;max_message_bytes:number}>(API_BASE_URL+'/api/uploads/limits',{headers:this.headers(token)}));this.limits.set(limits);}catch{/* Server still enforces its limits. */}}
  errorText(error:unknown):string {
    if(error instanceof HttpErrorResponse){
      if(error.status===0)return 'Соединение прервано. Проверьте сеть и повторите.';
      if(error.status===401)return 'Сессия истекла. Войдите снова.';
      if(error.status===413)return typeof error.error?.detail==='string'?error.error.detail:'Превышен допустимый размер загрузки.';
      if(typeof error.error?.detail==='string')return error.error.detail;
    }
    return 'Не удалось загрузить. Повторите попытку.';
  }
  send(token:string,channelId:string,payload:UploadPayload):Observable<WorkspaceMessageUploadEvent>{
    return new Observable(subscriber=>{
      const existing=this.job();
      if(existing && existing.status!=='done' && existing.payload.clientMessageId!==payload.clientMessageId){
        subscriber.error(new HttpErrorResponse({status:409,error:{detail:'Завершите или отмените предыдущую отправку файлов.'}}));return;
      }
      if(payload.files.length>10 || payload.files.reduce((n,f)=>n+f.size,0)>this.limits().max_message_bytes){
        subscriber.error(new HttpErrorResponse({status:413,error:{detail:'До 10 файлов. Превышен допустимый размер или количество вложений.'}}));return;
      }
      const entries:UploadEntry[]=existing?.payload.clientMessageId===payload.clientMessageId?existing.entries.map(e=>({...e,status:e.status==='ready'?'ready' as const:'waiting' as const,error:'',loaded:e.status==='ready'?e.file.size:0})):payload.files.map(file=>({id:crypto.randomUUID(),file,status:'waiting' as const,loaded:0,error:''}));
      const job:UploadJob={token,channelId,payload,entries,title:existing?.payload.clientMessageId===payload.clientMessageId?existing.title:this.title,status:'uploading',error:''};
      this.job.set(job);const cancel=new Subject<void>();let stopped=false,finished=false;
      const update=()=>{if(!stopped){this.job.set({...job,entries:[...entries]});subscriber.next({kind:'progress',loaded:this.loaded(),total:this.total(),percent:this.percent()});}};
      let cursor=0;
      const worker=async()=>{
        while(!stopped && cursor<entries.length){
          const entry=entries[cursor++];if(entry.status==='ready')continue;
          entry.status='uploading';update();const form=new FormData();form.append('file',entry.file,entry.file.name);
          try{
            await firstValueFrom(this.http.put<{id:string}>(`${API_BASE_URL}/api/channels/${channelId}/uploads/${entry.id}`,form,{headers:this.headers(token),observe:'events',reportProgress:true}).pipe(takeUntil(cancel),tap(event=>{
              if(stopped)return;
              if(event.type===HttpEventType.UploadProgress){entry.loaded=Math.min(entry.file.size,event.loaded);update();}
              if(event.type===HttpEventType.Response){entry.status='ready';entry.loaded=entry.file.size;update();}
            }),
            // Wait for the response, not the initial Sent event.
            filterResponse()));
          }catch(error){if(!stopped){entry.status='error';entry.error=this.errorText(error);entry.loaded=0;if(error instanceof HttpErrorResponse && error.status===410)entry.id=crypto.randomUUID();update();}}
        }
      };
      void(async()=>{
        try{
          await Promise.all([worker(),worker(),worker()]);if(stopped)return;
          if(entries.some(e=>e.status==='error'))throw new HttpErrorResponse({status:503,error:{detail:'Часть файлов не загрузилась. Остальные готовы. Повторите неудачные.'}});
          job.status='finalizing';update();
          const form=new FormData();form.append('content',payload.content);form.append('client_message_id',payload.clientMessageId);
          if(payload.replyToMessageId)form.append('reply_to_message_id',payload.replyToMessageId);
          for(const entry of entries)form.append('upload_ids',entry.id);
          const message=await firstValueFrom(this.http.post<WorkspaceMessage>(`${API_BASE_URL}/api/channels/${channelId}/messages`,form,{headers:this.headers(token)}).pipe(takeUntil(cancel)));
          if(stopped)return;job.status='done';finished=true;update();subscriber.next({kind:'response',message});subscriber.complete();
        }catch(error){if(!stopped){
          if(error instanceof HttpErrorResponse && [404,410].includes(error.status))for(const entry of entries){entry.status='error';entry.error='Загрузка устарела. Повторите.';entry.id=crypto.randomUUID();entry.loaded=0;}
          job.status='failed';job.error=this.errorText(error);finished=true;update();subscriber.error(error);
        }}
      })();
      return ()=>{stopped=true;cancel.next();cancel.complete();if(!finished){job.status='paused';this.job.set({...job,entries:[...entries]});}};
    });
  }
  dropFailed():void {
    const job=this.job();if(!job || this.busy() || !job.entries.some(e=>e.status==='error'))return;
    job.entries=job.entries.filter(e=>e.status==='ready');job.payload={...job.payload,files:job.entries.map(e=>e.file)};this.job.set({...job});
  }
  discard():void {
    const job=this.job();if(!job || this.busy())return;
    for(const entry of job.entries)this.http.delete(API_BASE_URL+'/api/uploads/'+entry.id,{headers:this.headers(job.token)}).subscribe({error:()=>{}});
    this.job.set(null);
  }
}
function filterResponse<T>(){return filter((event:HttpEvent<T>)=>event.type===HttpEventType.Response);}
