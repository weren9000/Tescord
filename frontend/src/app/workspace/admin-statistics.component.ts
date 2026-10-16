import {Component,OnInit,OnDestroy,inject,input,output,signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {HttpClient,HttpErrorResponse} from '@angular/common/http';
import {Subscription} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';
import {ChartRow,ChartSeries,StatisticsChartComponent,formatMetric} from './statistics-chart.component';
interface Day {day:string;active:number;visits:number;guest_visits:number;messages:number;registrations:number;voice_seconds:number;voice_sessions:number}
interface Resource {at:string;cpu_percent:number|null;cpu_count:number;memory_used:number;memory_total:number;swap_used:number;swap_total:number;disk_used:number;disk_total:number;net_in:number|null;net_out:number|null;uptime:number;backend_rss:number;active_rooms?:number;services:Record<string,string>}
interface Stats {activity_available:boolean;generated_at:string;start_date:string;end_date:string;start_at:string;end_at:string;visit_interval:'hour'|'day';resource_interval:'minute'|'hour';hourly_started_at:string|null;started_at:string|null;totals:Day&{online:number;voice:number};daily:Day[];top:{id:string;name:string;kind:string;messages:number}[];resources:Resource|null;resource_history:ChartRow[];visits_history:ChartRow[]}
@Component({selector:'app-admin-statistics',standalone:true,imports:[CommonModule,FormsModule,StatisticsChartComponent],templateUrl:'./admin-statistics.component.html',styleUrl:'./admin-statistics.component.scss'})
export class AdminStatisticsComponent implements OnInit,OnDestroy{
 readonly token=input.required<string>();readonly forbidden=output<void>();
 readonly data=signal<Stats|null>(null);readonly error=signal('');readonly busy=signal(false);
 readonly tab=signal('activity');readonly history=signal(false);
 readonly panels=signal<Record<string,boolean>>({});readonly help=signal<string|null>(null);
 togglePanel(key:string){this.panels.update(value=>({...value,[key]:!value[key]}));}
 toggleHelp(key:string){this.help.update(value=>value===key?null:key);}
 days=1;excludeSelf=false;startDate='';endDate='';resourceKey='cpu_percent';
 readonly today=new Date().toISOString().slice(0,10);
 private timer?:ReturnType<typeof setInterval>;private sub?:Subscription;private http=inject(HttpClient);
 readonly activitySeries:ChartSeries[]=[{key:'online',label:'Онлайн',color:'#a78bfa'},{key:'voice',label:'В голосе',color:'#55cbd3'}];
 readonly visitSeries:ChartSeries[]=[{key:'active',label:'Активные',color:'#a78bfa'},{key:'visits',label:'Посещения',color:'#55cbd3'},{key:'guest_visits',label:'Гости',color:'#e7ae62'}];
 readonly format=formatMetric;
 ngOnInit(){this.startDate=this.today;this.endDate=this.today;this.load();this.timer=setInterval(()=>{if(document.visibilityState==='visible'&&!this.busy()&&this.days!==0)this.load();},30000);}
 ngOnDestroy(){clearInterval(this.timer);this.sub?.unsubscribe();}
 load(){
  const params:Record<string,string|number|boolean>={days:this.days||1,exclude_self:this.excludeSelf};
  if(this.days===0){if(!this.startDate||!this.endDate||this.startDate>this.endDate||this.endDate>this.today||(Date.parse(this.endDate)-Date.parse(this.startDate))/86400000>=90){this.error.set('Выберите до 90 дней, без будущих дат.');return;}params['start_date']=this.startDate;params['end_date']=this.endDate;}
  this.sub?.unsubscribe();this.busy.set(true);this.error.set('');
  this.sub=this.http.get<Stats>(API_BASE_URL+'/api/admin/statistics',{params,headers:{Authorization:'Bearer '+this.token()}}).subscribe({next:d=>{this.data.set(d);this.busy.set(false);},error:e=>{this.busy.set(false);if(e instanceof HttpErrorResponse&&[401,403].includes(e.status))this.forbidden.emit();this.error.set('Не удалось обновить статистику. Данные могут устареть.');}});
 }
 period(){if(this.days!==0)this.load();}
 bytes(n:number|null|undefined){return formatMetric(n,'bytes');}
 stale(){const at=this.data()?.resources?.at;return !at||Date.now()-Date.parse(at)>60000;}
 state(v:string){return ({online:'Работает',offline:'Недоступен',disabled:'Не настроен',unknown:'Нет данных'} as Record<string,string>)[v]??'Нет данных';}
 resourceSeries():ChartSeries[]{return this.resourceKey==='network'?[{key:'net_in',label:'Входящий',color:'#a78bfa'},{key:'net_out',label:'Исходящий',color:'#55cbd3'}]:[{key:this.resourceKey,label:this.resourceKey==='cpu_percent'?'CPU':'RAM',color:'#a78bfa'}];}
 resourceUnit(){return this.resourceKey==='cpu_percent'?'percent':this.resourceKey==='network'?'rate':'bytes';}
}
