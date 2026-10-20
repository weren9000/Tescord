import {Component, computed, input, signal, ElementRef, inject, AfterViewInit, OnDestroy} from '@angular/core';

export interface ChartRow {at:string;[key:string]:string|number|null}
export interface ChartSeries {key:string;label:string;color:string}
export function formatMetric(value:number|null|undefined,unit=''):string {
  if(value==null||!Number.isFinite(value))return 'Нет данных';
  if(unit==='bytes'||unit==='rate'){
    const units=['Б','КБ','МБ','ГБ','ТБ'];let i=0;
    while(value>=1024&&i<4){value/=1024;i++;}
    return `${value.toLocaleString('ru-RU',{maximumFractionDigits:1})} ${units[i]}${unit==='rate'?'/с':''}`;
  }
  return value.toLocaleString('ru-RU',{maximumFractionDigits:1})+(unit==='percent'?'%':unit==='ms'?' мс':'');
}
@Component({selector:'app-statistics-chart',standalone:true,template:`
 <div class="legend">@for(s of series();track s.key){<button type="button" [attr.aria-pressed]="!hidden().includes(s.key)" (click)="toggle(s.key)"><i [style.background]="s.color"></i>{{s.label}}</button>}</div>
 <svg [attr.viewBox]="'0 0 '+width()+' 140'" role="slider" tabindex="0" [attr.aria-label]="label()+' — выберите время стрелками или нажатием'" aria-valuemin="0" [attr.aria-valuemax]="Math.max(0,rows().length-1)" [attr.aria-valuenow]="index()" [attr.aria-valuetext]="detailTime()" (pointermove)="pick($event)" (pointerdown)="pick($event)" (keydown)="key($event)">
  @for(t of [0,0.5,1];track t){<line x1="55" [attr.x2]="width()-15" [attr.y1]="100-t*90" [attr.y2]="100-t*90"/><text x="49" [attr.y]="104-t*90" text-anchor="end">{{format(maximum()*t,unit())}}</text>}
  @for(s of visible();track s.key){<path [attr.d]="paths()[s.key]" [attr.stroke]="s.color"/>}
  @if(rows().length<=50){@for(r of rows();track r.at){@for(s of visible();track s.key){@if(value(r,s.key)!==null){<circle [attr.cx]="x(r.at)" [attr.cy]="100-(value(r,s.key)??0)/maximum()*90" r="2" [attr.fill]="s.color"/>}}}}
  @for(t of [0,0.5,1];track t){<text [attr.x]="55+t*(width()-70)" y="124" [attr.text-anchor]="t===0?'start':t===1?'end':'middle'">{{tick(t)}}</text>}
  @if(rows().length){<line class="cursor" [attr.x1]="x(selected().at)" [attr.x2]="x(selected().at)" y1="10" y2="100"/>@for(s of visible();track s.key){@if(value(selected(),s.key)!==null){<circle [attr.cx]="x(selected().at)" [attr.cy]="100-(value(selected(),s.key)??0)/maximum()*90" r="3" [attr.fill]="s.color"/>}}}
 </svg>
 <div class="detail" aria-live="polite"><time>{{detailTime()}}</time><div>@for(s of visible();track s.key){<span><i [style.background]="s.color"></i>{{s.label}}: <b>{{format(value(selected(),s.key),unit())}}</b></span>}</div></div>
 @if(!hasValues()){<p class="empty">Нет замеров за этот период</p>}
 `,styles:[`
 :host{display:block;min-width:0}.legend{display:flex;flex-wrap:wrap;gap:4px;min-height:32px}.legend button{display:flex;align-items:center;gap:5px;min-height:32px;padding:4px 7px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--palette-text);font:inherit;font-size:11px;cursor:pointer}.legend button[aria-pressed=false]{opacity:.45;text-decoration:line-through}.legend button:focus-visible,svg:focus-visible{outline:2px solid var(--palette-primary)}i{display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0}svg{width:100%;height:140px;display:block;touch-action:pan-y}line{stroke:var(--palette-border);stroke-width:1}path{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.cursor{stroke:var(--palette-muted);stroke-dasharray:3 4}text{fill:var(--palette-muted);font:11px sans-serif}.detail{min-height:40px;font-size:11px;line-height:1.5;border-top:1px solid var(--palette-border);padding-top:6px}.detail time{color:var(--palette-muted)}.detail>div{display:flex;flex-wrap:wrap;gap:3px 12px}.detail span{display:flex;align-items:center;gap:4px}.empty{font-size:12px;color:var(--palette-muted);margin:4px 0}@media(max-width:750px){.legend button{min-height:40px}svg{height:140px}}
 `]})
export class StatisticsChartComponent implements AfterViewInit,OnDestroy {
 readonly width=signal(600);private element=inject(ElementRef<HTMLElement>);private observer?:ResizeObserver;
 ngAfterViewInit(){this.observer=new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(width>0)this.width.set(Math.max(240,width));});this.observer.observe(this.element.nativeElement);}
 ngOnDestroy(){this.observer?.disconnect();}

 readonly rows=input<ChartRow[]>([]);readonly series=input<ChartSeries[]>([]);readonly start=input.required<string>();readonly end=input.required<string>();readonly interval=input<'minute'|'hour'|'day'>('hour');readonly unit=input('');readonly label=input('График');
 readonly hidden=signal<string[]>([]);readonly chosen=signal<number|null>(null);readonly Math=Math;readonly format=formatMetric;
 readonly visible=computed(()=>this.series().filter(s=>!this.hidden().includes(s.key)));
 readonly index=computed(()=>Math.max(0,Math.min(this.chosen()??this.rows().length-1,this.rows().length-1)));
 readonly selected=computed<ChartRow>(()=>this.rows()[this.index()]??{at:this.start()});
 readonly maximum=computed(()=>this.unit()==='percent'?100:Math.max(1,...this.rows().flatMap(r=>this.visible().map(s=>this.value(r,s.key)??0))));
 readonly hasValues=computed(()=>this.rows().some(r=>this.visible().some(s=>this.value(r,s.key)!==null)));
 value(row:ChartRow,key:string):number|null {const v=row[key];return typeof v==='number'&&Number.isFinite(v)?v:null;}
 toggle(key:string){this.hidden.update(h=>h.includes(key)?h.filter(k=>k!==key):[...h,key]);}
 x(at:string){const a=Date.parse(this.start()),b=Date.parse(this.end());return 55+(this.width()-70)*Math.max(0,Math.min(1,(Date.parse(at)-a)/Math.max(1,b-a)));}
 path(key:string){return this.paths()[key]??'';}
 readonly paths=computed(()=>Object.fromEntries(this.visible().map(series=>{const key=series.key;const makePath=()=>{let pen=false;let prev=0;const step={minute:60000,hour:3600000,day:86400000}[this.interval()];return this.rows().map(r=>{const n=this.value(r,key),at=Date.parse(r.at);if(n===null){pen=false;return '';}const command=pen&&at-prev<=step*1.5?'L':'M';pen=true;prev=at;const x=this.x(r.at),y=100-n/this.maximum()*90;return `${command}${x},${y}l0.01,0`;}).join(' ');};return [key,makePath()];})));
 tick(t:number){const at=Date.parse(this.start())+(Date.parse(this.end())-Date.parse(this.start()))*t;return new Date(at).toLocaleString('ru-RU',{timeZone:'UTC',...(this.interval()==='day'?{day:'2-digit',month:'2-digit'}:{hour:'2-digit',minute:'2-digit',...(Date.parse(this.end())-Date.parse(this.start())>86400000?{day:'2-digit',month:'2-digit'}:{})})});}
 detailTime(){const at=Date.parse(this.selected().at),until=Math.min(Date.parse(this.end()),at+{minute:60000,hour:3600000,day:86400000}[this.interval()]);const date=new Date(at).toLocaleDateString('ru-RU',{timeZone:'UTC'});const time=(v:number)=>new Date(v).toLocaleTimeString('ru-RU',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'});return this.interval()==='day'?`${date} · сутки UTC`:`${date} · ${time(at)}–${time(until)} UTC`;}
 pick(event:PointerEvent){const rect=(event.currentTarget as SVGElement).getBoundingClientRect();const ratio=Math.max(0,Math.min(1,((event.clientX-rect.left)/rect.width*this.width()-55)/(this.width()-70)));const stamp=Date.parse(this.start())+ratio*(Date.parse(this.end())-Date.parse(this.start()));let best=0;this.rows().forEach((r,i)=>{if(Math.abs(Date.parse(r.at)-stamp)<Math.abs(Date.parse(this.rows()[best].at)-stamp))best=i;});this.chosen.set(best);}
 key(e:KeyboardEvent){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();this.chosen.set(e.key==='Home'?0:e.key==='End'?this.rows().length-1:this.index()+(e.key==='ArrowRight'?1:-1));}
}
