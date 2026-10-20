import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {signal} from '@angular/core';
import {Subject} from 'rxjs';
import {ShopComponent} from './shop.component';
import {WalletService} from './wallet.service';
import {ResourceRefreshService} from '../core/services/resource-refresh.service';

describe('Smart catalog',()=>{
 let component:ShopComponent;
 let http:HttpTestingController;
 beforeEach(()=>{
  TestBed.configureTestingModule({imports:[ShopComponent],providers:[provideHttpClient(),provideHttpClientTesting(),
   {provide:WalletService,useValue:{balance:signal({crystals:500}),error:signal(false),refresh:async()=>{}}},
   {provide:ResourceRefreshService,useValue:{changes$:new Subject()}}]});
  const fixture=TestBed.createComponent(ShopComponent);
  fixture.componentRef.setInput('token','test-token');
  fixture.componentRef.setInput('actorId','store-spec');
  component=fixture.componentInstance;
  http=TestBed.inject(HttpTestingController);
  localStorage.removeItem('kva-shop-pending:store-spec');
 });
 afterEach(()=>{http.verify();localStorage.removeItem('kva-shop-pending:store-spec');});
 const empty={items:[],page:1,pages:1,total:0};
 it('uses personal history and restores each tab’s filters',async()=>{
  component.q='cat';component.kind='avatar';component.priceBand='mid';
  const catalog=component.load();
  const req=http.expectOne(r=>r.url.includes('/api/shop?'));
  expect(req.request.url).toContain('min_price=101');
  expect(req.request.url).toContain('max_price=300');
  req.flush(empty);await catalog;
  const history=component.switchMode('purchases');
  const personal=http.expectOne(r=>r.url.includes('/api/shop/purchases?'));
  expect(personal.request.url).not.toContain('admin');
  expect(personal.request.url).not.toContain('kind=');
  personal.flush(empty);await history;
  const back=component.switchMode('browse');
  http.expectOne(r=>r.url.includes('q=cat')&&r.url.includes('kind=avatar')).flush(empty);
  await back;expect(component.priceBand).toBe('mid');
 });
 it('keeps one purchase request during double click and recovers its receipt',async()=>{
  component.selected.set({id:'cat',name:'Cat',kind:'avatar',price:100,version:2});
  const first=component.buy();
  await component.buy();
  const request=http.expectOne(r=>r.method==='POST'&&r.url.endsWith('/shop/purchases'));
  const id=request.request.body.request_id;
  expect(JSON.parse(localStorage.getItem('kva-shop-pending:store-spec')!).request_id).toBe(id);
  request.error(new ProgressEvent('network'));
  await first;
  expect(component.pending()?.request_id).toBe(id);
  const recovery=component.recover();
  http.expectOne(r=>r.method==='GET'&&r.url.endsWith('/purchases/'+id)).flush({id,item_id:'item',catalog_id:'cat',name:'Cat',price:100,balance_after:400});
  await recovery;
  expect(component.pending()).toBeNull();
  expect(component.result()?.item_id).toBe('item');
  expect(localStorage.getItem('kva-shop-pending:store-spec')).toBeNull();
 });
 it('Escape closes the purchase confirmation before the item',()=>{
  component.selected.set({id:'cat',name:'Cat',kind:'avatar'});
  component.confirming.set(true);
  component.escape(new Event('cancel'));
  expect(component.confirming()).toBeFalse();
  expect(component.selected()?.id).toBe('cat');
 });
});
