import {ChangeDetectionStrategy, Component, computed, input} from '@angular/core';
import {ChartRow} from './statistics-chart.component';

@Component({
 selector:'app-statistics-sparkline', standalone:true, changeDetection:ChangeDetectionStrategy.OnPush,
 template:`@if(path()){<svg viewBox="0 0 240 60" preserveAspectRatio="none" aria-hidden="true"><path [attr.d]="path()"/></svg>}@else{<span>Нет замеров</span>}`,
 styles:[`:host{display:block;height:60px;color:var(--palette-primary)}svg{width:100%;height:60px;display:block;overflow:visible}path{fill:none;stroke:currentColor;stroke-width:2;vector-effect:non-scaling-stroke;stroke-linejoin:round}span{font-size:12px;color:var(--palette-muted)}`]
})
export class StatisticsSparklineComponent {
 readonly rows=input<ChartRow[]>([]);
 readonly metric=input.required<string>();
 readonly interval=input<'minute'|'hour'>('minute');
 readonly path=computed(()=>{
  const rows=this.rows(), key=this.metric();
  const values=rows.map(r=>r[key]).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));
  if(!values.length)return '';
  const maximum=Math.max(1,...values), start=Date.parse(rows[0].at), end=Date.parse(rows[rows.length-1].at);
  const gap=this.interval()==='minute'?90000:5400000;
  let previous=0, pen=false;
  return rows.map(row=>{
   const value=row[key], at=Date.parse(row.at);
   if(typeof value!=='number'||!Number.isFinite(value)){pen=false;return '';}
   const command=pen&&at-previous<=gap?'L':'M';
   pen=true;previous=at;
   return `${command}${(at-start)/Math.max(1,end-start)*238+1},${58-value/maximum*54}l0.1,0`;
  }).join(' ');
 });
}
