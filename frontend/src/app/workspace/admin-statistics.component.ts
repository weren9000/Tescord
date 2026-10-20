import {Component,OnInit,OnDestroy,inject,input,output,signal,computed} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {HttpClient,HttpErrorResponse} from '@angular/common/http';
import {Subscription} from 'rxjs';
import {API_BASE_URL} from '../core/api/api-base';
import {StatisticsSparklineComponent} from './statistics-sparkline.component';
import {ChartRow,ChartSeries,StatisticsChartComponent,formatMetric} from './statistics-chart.component';
interface Day {day:string;active:number;visits:number;guest_visits:number;messages:number;registrations:number;voice_seconds:number;voice_sessions:number}
interface Resource {cpu_steal_percent?:number|null;cpu_iowait_percent?:number|null;backend_cpu_percent?:number|null;performance?:Record<string,{mean:number;max:number;count:number;sum:number;per_second:number}>;at:string;cpu_percent:number|null;cpu_count:number;memory_used:number;memory_total:number;swap_used:number;swap_total:number;disk_used:number;disk_total:number;net_in:number|null;net_out:number|null;uptime:number;backend_rss:number;active_rooms?:number;services:Record<string,string>}
interface Stats {activity_available:boolean;generated_at:string;start_date:string;end_date:string;start_at:string;end_at:string;visit_interval:'hour'|'day';resource_interval:'minute'|'hour';hourly_started_at:string|null;started_at:string|null;totals:Day&{online:number;voice:number};daily:Day[];top:{id:string;name:string;kind:string;messages:number}[];resources:Resource|null;resource_start_at?:string;resource_history:ChartRow[];visits_history:ChartRow[]}
@Component({selector:'app-admin-statistics',standalone:true,imports:[CommonModule,FormsModule,StatisticsChartComponent,StatisticsSparklineComponent],templateUrl:'./admin-statistics.component.html',styleUrl:'./admin-statistics.component.scss'})
export class AdminStatisticsComponent implements OnInit,OnDestroy{
 readonly token=input.required<string>();readonly forbidden=output<void>();
 readonly data=signal<Stats|null>(null);readonly error=signal('');readonly busy=signal(false);
 readonly tab=signal('overview');readonly paused=signal(false);readonly clock=signal(Date.now());
 readonly sections=[{key:'overview',label:'Обзор'},{key:'activity',label:'Активность'},{key:'server',label:'Сервер'},{key:'calls',label:'Звонки'}];
 selectTab(key:string){if(this.tab()===key)return;this.tab.set(key);this.load();}
 openResource(key:string){this.resourceKey.set(key);this.selectTab('server');}
 percent(used:number,total:number){return total>0?Math.max(0,Math.min(100,used/total*100)):0;}
 readonly callFields=[{key:'call_connect_ms',label:'Подключение медиа',unit:'ms'},{key:'call_rtt_ms',label:'RTT звонков',unit:'ms'},{key:'call_jitter_ms',label:'Jitter',unit:'ms'},{key:'call_loss_percent',label:'Потери пакетов',unit:'percent'}];
 readonly cpuFields=[{key:'cpu_percent',label:'CPU VPS'},{key:'backend_cpu_percent',label:'CPU приложения'},{key:'cpu_steal_percent',label:'CPU steal'},{key:'cpu_iowait_percent',label:'Ожидание диска'}];
 readonly cpuValues=computed(()=>{const r=this.data()?.resources;return [r?.cpu_percent,r?.backend_cpu_percent,r?.cpu_steal_percent,r?.cpu_iowait_percent];});
 readonly resourceHistory=computed(()=>this.data()?.resource_history??[]);
 readonly callSeries:ChartSeries[]=[{key:'call_rtt_ms',label:'RTT',color:'var(--palette-primary)'},{key:'call_jitter_ms',label:'Jitter',color:'var(--palette-text)'}];
 readonly panels=signal<Record<string,boolean>>({});readonly help=signal<string|null>(null);
 togglePanel(key:string){this.panels.update(value=>({...value,[key]:!value[key]}));}
 toggleHelp(key:string){this.help.update(value=>value===key?null:key);}
 days=1;excludeSelf=false;startDate='';endDate='';readonly resourceKey=signal('cpu_percent');
 readonly today=new Date().toISOString().slice(0,10);
 private timer?:ReturnType<typeof setInterval>;private sub?:Subscription;private http=inject(HttpClient);
 readonly activitySeries:ChartSeries[]=[{key:'online',label:'Онлайн',color:'var(--palette-primary)'},{key:'voice',label:'В голосе',color:'var(--palette-text)'}];
 readonly visitSeries:ChartSeries[]=[{key:'active',label:'Активные',color:'var(--palette-primary)'},{key:'visits',label:'Посещения',color:'var(--palette-text)'},{key:'guest_visits',label:'Гости',color:'var(--palette-warning)'}];
 readonly resourceOptions=[{key:'memory_used',label:'RAM'},{key:'disk_used',label:'Диск'},{key:'network',label:'Сеть'},{key:'cpu_percent',label:'CPU VPS'},{key:'backend_cpu_percent',label:'CPU приложения'},{key:'cpu_steal_percent',label:'CPU steal'},{key:'cpu_iowait_percent',label:'Ожидание диска'},{key:'api_ms',label:'Ответ API, мс'},{key:'sql_rate',label:'SQL запросов/с'},{key:'db_acquire_ms',label:'Получение соединения БД, мс'},{key:'call_rtt_ms',label:'RTT звонков, мс'},{key:'call_jitter_ms',label:'Jitter звонков, мс'},{key:'call_loss_percent',label:'Потери пакетов, %'},{key:'call_connect_ms',label:'Подключение медиа, мс'},{key:'call_reconnects',label:'Переподключения за интервал'}];
 readonly slowRoutes=computed(()=>{const data=this.data()?.resources?.performance??{};return Object.entries(data).filter(([key])=>key.startsWith('route_ms:')).sort((a,b)=>b[1].mean-a[1].mean).slice(0,5).map(([key,value])=>({route:key.slice(9),...value,sql:data['route_sql:'+key.slice(9)]?.mean}));});
 readonly performanceFields=[
  {key:'api_ms',label:'Ответ API',unit:'мс'}, {key:'sql_ms',label:'Выполнение SQL',unit:'мс'},
  {key:'db_acquire_ms',label:'Получение соединения БД',unit:'мс'},
  {key:'call_connect_ms',label:'Подключение медиасоединения',unit:'мс'},
  {key:'call_rtt_ms',label:'RTT звонков',unit:'мс'}, {key:'call_jitter_ms',label:'Jitter звонков',unit:'мс'},
  {key:'call_loss_percent',label:'Потери входящих пакетов',unit:'%'},
 ];
 metric(key:string){return this.data()?.resources?.performance?.[key];}
 readonly format=formatMetric;
 ngOnInit(){this.startDate=this.today;this.endDate=this.today;this.load();this.timer=setInterval(()=>{this.clock.set(Date.now());if(document.visibilityState==='visible'&&!this.paused()&&!this.busy()&&this.days!==0)this.load();},30000);}
 ngOnDestroy(){clearInterval(this.timer);this.sub?.unsubscribe();}
 load(){
  const params:Record<string,string|number|boolean>={days:this.days||1,exclude_self:this.excludeSelf,view:this.tab()};
  if(this.days===0){if(!this.startDate||!this.endDate||this.startDate>this.endDate||this.endDate>this.today||(Date.parse(this.endDate)-Date.parse(this.startDate))/86400000>=90){this.error.set('Выберите до 90 дней, без будущих дат.');return;}params['start_date']=this.startDate;params['end_date']=this.endDate;}
  this.sub?.unsubscribe();this.busy.set(true);this.error.set('');
  this.sub=this.http.get<Stats>(API_BASE_URL+'/api/admin/statistics',{params,headers:{Authorization:'Bearer '+this.token()}}).subscribe({next:d=>{this.clock.set(Date.now());this.data.set(d);this.busy.set(false);},error:e=>{this.busy.set(false);if(e instanceof HttpErrorResponse&&[401,403].includes(e.status))this.forbidden.emit();this.error.set('Не удалось обновить статистику. Данные могут устареть.');}});
 }
 period(){if(this.days!==0)this.load();}
 bytes(n:number|null|undefined){return formatMetric(n,'bytes');}
 stale(){const at=this.data()?.resources?.at;return !at||this.clock()-Date.parse(at)>60000;}
 state(v:string){return ({online:'Работает',offline:'Недоступен',disabled:'Не настроен',unknown:'Нет данных'} as Record<string,string>)[v]??'Нет данных';}
 readonly resourceSeries=computed<ChartSeries[]>(()=>this.resourceKey()==='network'?[{key:'net_in',label:'Входящий',color:'var(--palette-primary)'},{key:'net_out',label:'Исходящий',color:'var(--palette-text)'}]:[{key:this.resourceKey(),label:this.resourceOptions.find(o=>o.key===this.resourceKey())?.label??'RAM',color:'var(--palette-primary)'}]);
 resourceUnit(){return this.resourceKey().endsWith('_percent')?'percent':this.resourceKey().endsWith('_ms')?'ms':this.resourceKey()==='network'?'rate':['memory_used','disk_used'].includes(this.resourceKey())?'bytes':'';}
}
