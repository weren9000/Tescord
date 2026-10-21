import {TestBed, ComponentFixture} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {provideHttpClientTesting} from '@angular/common/http/testing';
import {signal} from '@angular/core';
import {InventoryComponent} from './inventory.component';
import {WalletService} from './wallet.service';

describe('Inventory above a clipped store dialog', () => {
 let fixture: ComponentFixture<InventoryComponent>, store: HTMLDialogElement;
 beforeEach(async () => {
  await TestBed.configureTestingModule({imports:[InventoryComponent],providers:[provideHttpClient(),provideHttpClientTesting(),
   {provide:WalletService,useValue:{balance:signal({crystals:500}),error:signal(false),refresh:async()=>{}}}]}).compileComponents();
  store=document.createElement('dialog');
  store.style.cssText='width:600px;height:300px;overflow:hidden';
  document.body.append(store);store.showModal();
  fixture=TestBed.createComponent(InventoryComponent);
  store.append(fixture.nativeElement);
  fixture.componentRef.setInput('token','');
  fixture.componentRef.setInput('mode','inventory');
  fixture.componentRef.setInput('embedded',true);
  fixture.componentRef.setInput('storeLayout',true);
  fixture.detectChanges();
 });
 afterEach(()=>{fixture.destroy();store.close();store.remove();});

 for(const kind of ['avatar','frame','wallpaper','theme']){
  it(`keeps ${kind} details above the store, with a visible header and scrollable history`, async()=>{
   const app=fixture.componentInstance;
   app.detail.set({id:'test',catalog_id:'test',kind,name:'Test',created_at:new Date().toISOString(),equipped:false,revoked:false,owner:null});
   app.history.set(Array.from({length:30},()=>({action:'gift',actor:null,recipient:null,created_at:new Date().toISOString()})));
   fixture.detectChanges();await new Promise(resolve=>setTimeout(resolve,0));
   const layer:HTMLDialogElement=fixture.nativeElement.querySelector('dialog[appModalLayer]');
   expect(layer.matches(':modal')).toBeTrue();expect(store.matches(':modal')).toBeTrue();
   const header=layer.querySelector('header')!.getBoundingClientRect();
   expect(header.top).toBeGreaterThanOrEqual(0);expect(header.bottom).toBeLessThanOrEqual(innerHeight);
   const button=layer.querySelector('header button')!;
   const r=button.getBoundingClientRect();
   expect(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)).toBe(button);
   const body=layer.querySelector<HTMLElement>('.panel-body')!;
   expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
   body.scrollTop=body.scrollHeight;expect(body.scrollTop).toBeGreaterThan(0);
   layer.dispatchEvent(new Event('cancel',{cancelable:true}));fixture.detectChanges();
   expect(app.detail()).toBeNull();expect(store.open).toBeTrue();
  });
 }
 it('closes only the confirmation and respects an operation in progress',()=>{
  const app=fixture.componentInstance;
  app.eventsOpen.set(true);fixture.detectChanges();
  app.pending.set({action:'gift',item:null,recipient:null,request_id:'test'});fixture.detectChanges();
  const top:HTMLDialogElement=fixture.nativeElement.querySelector('dialog.confirmation');
  app.busy.set(true);top.dispatchEvent(new Event('cancel',{cancelable:true}));fixture.detectChanges();
  expect(app.pending()).not.toBeNull();expect(top.open).toBeTrue();
  app.busy.set(false);top.dispatchEvent(new Event('cancel',{cancelable:true}));fixture.detectChanges();
  expect(app.pending()).toBeNull();expect(app.eventsOpen()).toBeTrue();expect(store.open).toBeTrue();
 });
});
