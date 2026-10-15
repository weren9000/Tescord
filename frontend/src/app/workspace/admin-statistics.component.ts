import {Component,OnInit,OnDestroy,inject,input,output,signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {HttpClient,HttpErrorResponse} from '@angular/common/http';
import {Subscription} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';
interface Day {day:string;active:number;visits:number;guest_visits:number;messages:number;registrations:number;voice_seconds:number;voice_sessions:number}
interface Resource {at:string;cpu_percent:number;cpu_count:number;memory_used:number;memory_total:number;swap_used:number;swap_total:number;disk_used:number;disk_total:number;net_in:number|null;net_out:number|null;uptime:number;backend_rss:number;services:Record<string,string>}
interface Stats {started_at:string|null;totals:Day&{online:number;voice:number};daily:Day[];top:{id:string;name:string;kind:string;messages:number}[];resources:Resource|null;resource_history:Record<string,number|string|null>[]}
@Component({selector:'app-admin-statistics',standalone:true,imports:[CommonModule,FormsModule],templateUrl:'./admin-statistics.component.html',styleUrl:'./admin-statistics.component.scss'})
export class AdminStatisticsComponent implements OnInit,OnDestroy{
 readonly token=input.required<string>();readonly forbidden=output<void>();
 readonly data=signal<Stats|null>(null);readonly error=signal('');readonly busy=signal(false);readonly Math=Math;
 days=1;excludeSelf=false;private timer?:ReturnType<typeof setInterval>;private sub?:Subscription;private http=inject(HttpClient);
 readonly resourceCharts=[{key:'cpu_percent',name:'Процессор, %'},{key:'memory_used',name:'Память, байт'},{key:'net_in',name:'Входящий трафик, байт/с'},{key:'net_out',name:'Исходящий трафик, байт/с'}];
 readonly activityCharts=[{key:'active',name:'Активные пользователи'},{key:'visits',name:'Посещения'},{key:'messages',name:'Сообщения'},{key:'voice_seconds',name:'Голос, пользовательские секунды'}];
 ngOnInit(){this.load();this.timer=setInterval(()=>{if(document.visibilityState==='visible'&&!this.busy())this.load();},15000);}
 ngOnDestroy(){clearInterval(this.timer);this.sub?.unsubscribe();}
 load(){this.sub?.unsubscribe();this.busy.set(true);this.error.set('');this.sub=this.http.get<Stats>(API_BASE_URL+'/api/admin/statistics',{params:{days:this.days,exclude_self:this.excludeSelf},headers:{Authorization:'Bearer '+this.token()}}).subscribe({next:d=>{this.data.set(d);this.busy.set(false);},error:e=>{this.busy.set(false);if(e instanceof HttpErrorResponse && [401,403].includes(e.status))this.forbidden.emit();this.error.set('Не удалось обновить статистику. Показанные данные могут устареть.');}});}
 bytes(n:number|null|undefined){if(n==null)return 'Нет данных';const units=['Б','КБ','МБ','ГБ','ТБ'];let i=0;while(n>=1024&&i<4){n/=1024;i++;}return n.toFixed(i?1:0)+' '+units[i];}
 percent(used:number,total:number){return total?Math.min(100,used/total*100):0;}
 hours(seconds:number){return (seconds/3600).toFixed(1);}
 stale(){const at=this.data()?.resources?.at;return !at || Date.now()-Date.parse(at)>60000;}
 state(value:string){return ({online:'Работает',offline:'Недоступен',disabled:'Не настроен',unknown:'Нет данных'} as Record<string,string>)[value]??'Нет данных';}
 points(rows:object[],key:string){const values=rows.map(r=>Number((r as Record<string,unknown>)[key])||0);const max=Math.max(1,...values);return values.map((v,i)=>(values.length>1?i/(values.length-1)*600:300)+','+(125-v/max*115)).join(' ');}
 maximum(rows:object[],key:string){return Math.max(0,...rows.map(r=>Number((r as Record<string,unknown>)[key])||0));}
 value(row:object,key:string){return Number((row as Record<string,unknown>)[key])||0;}
}
