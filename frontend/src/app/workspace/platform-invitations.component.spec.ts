import {TestBed} from '@angular/core/testing';
import {of,throwError} from 'rxjs';
import {PlatformApiService} from '../core/api/platform-api.service';
import {PlatformInvitationsComponent} from './platform-invitations.component';

describe('Platform invitation controls',()=>{
 let api:any;
 beforeEach(()=>{api={request:jasmine.createSpy().and.returnValue(of([]))};TestBed.configureTestingModule({imports:[PlatformInvitationsComponent],providers:[{provide:PlatformApiService,useValue:api}]});});
 function setup(){const f=TestBed.createComponent(PlatformInvitationsComponent);f.componentRef.setInput('token','token');f.componentRef.setInput('platformId','platform');return f;}
 const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
 it('creates a one-day link using successful-entry limits and supports no expiry',async()=>{
  const f=setup(),c=f.componentInstance;
  api.request.and.callFake((_t:string,method:string)=>of(method==='POST'?{id:'link',token:'secret'}:[]));
  c.limit=5;c.create();await tick();
  expect(api.request).toHaveBeenCalledWith('token','POST','/platform/invites',{expires_in_hours:24,max_uses:5});
  c.hours=null;c.limit=null;c.create();await tick();
  expect(api.request).toHaveBeenCalledWith('token','POST','/platform/invites',{expires_in_hours:null,max_uses:null});f.destroy();
 });
 it('retains selected friends when sending fails so the user can retry',async()=>{
  const f=setup(),c=f.componentInstance;c.toggle('friend');
  api.request.and.returnValue(throwError(()=>({error:{detail:'Retry'}})));c.send();await tick();
  expect(c.selected().has('friend')).toBeTrue();expect(c.error()).toBe('Retry');
  api.request.and.callFake((_t:string,method:string)=>of(method==='POST'?{sent:1}:[]));c.send();await tick();
  expect(c.selected().size).toBe(0);expect(c.notice()).toContain('1');f.destroy();
 });
 it('rejects invalid limits and clears the copyable URL after revoking its link',async()=>{
  const f=setup(),c=f.componentInstance;c.limit=0;c.create();expect(api.request).not.toHaveBeenCalled();
  api.request.and.callFake((_t:string,method:string)=>of(method==='POST'?{id:'link',token:'secret'}:[]));
  c.limit=1;c.create();await tick();expect(c.link()).toContain('secret');c.revoke('link');await tick();expect(c.link()).toBe('');f.destroy();
 });
});
