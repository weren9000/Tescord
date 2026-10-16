import {TestBed} from '@angular/core/testing';
import {StatisticsChartComponent,formatMetric} from './statistics-chart.component';

describe('Statistics time chart',()=>{
 it('positions by time, leaves gaps and exposes null instead of a false zero',()=>{
  const f=TestBed.createComponent(StatisticsChartComponent);
  f.componentRef.setInput('start','2026-10-15T00:00:00Z');f.componentRef.setInput('end','2026-10-15T04:00:00Z');
  f.componentRef.setInput('series',[{key:'n',label:'Users',color:'red'}]);
  f.componentRef.setInput('rows',[{at:'2026-10-15T00:00:00Z',n:2},{at:'2026-10-15T01:00:00Z',n:null},{at:'2026-10-15T03:00:00Z',n:4}]);
  f.detectChanges();const c=f.componentInstance;
  expect(c.x('2026-10-15T03:00:00Z')).toBe(452.5);
  expect((c.path('n').match(/M/g)||[]).length).toBe(2);
  c.chosen.set(1);expect(c.value(c.selected(),'n')).toBeNull();
  expect(c.detailTime()).toContain('01:00–02:00 UTC');
  c.key(new KeyboardEvent('keydown',{key:'ArrowRight'}));expect(c.index()).toBe(2);
  c.toggle('n');expect(c.visible().length).toBe(0);
 });
 it('formats resource units and unavailable measurements',()=>{
  expect(formatMetric(null)).toBe('Нет данных');
  expect(formatMetric(1048576,'bytes')).toBe('1 МБ');
  expect(formatMetric(2048,'rate')).toBe('2 КБ/с');
 });
});
