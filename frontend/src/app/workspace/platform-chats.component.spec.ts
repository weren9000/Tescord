import {TestBed} from '@angular/core/testing';
import {signal} from '@angular/core';
import {of, throwError} from 'rxjs';
import {PlatformChatsComponent} from './platform-chats.component';
import {PlatformApiService} from '../core/api/platform-api.service';

describe('Platform interface actions',()=>{
  const platform={id:'p',name:'Company',description:null,owner_id:'owner',member_role:'owner' as const,notifications_enabled:true};
  let api:any;
  beforeEach(()=>{
    api={platforms:signal([platform]),request:jasmine.createSpy().and.returnValue(of([])),refresh:jasmine.createSpy().and.resolveTo()};
    TestBed.configureTestingModule({imports:[PlatformChatsComponent],providers:[{provide:PlatformApiService,useValue:api}]});
  });
  function setup(){const f=TestBed.createComponent(PlatformChatsComponent);f.componentRef.setInput('token','test');f.detectChanges();return f;}
  it('keeps the creation form and input after a failed request, then emits the created chat',async()=>{
    const f=setup(),c=f.componentInstance;const changed=jasmine.createSpy();c.changed.subscribe(changed);
    c.show('create');c.name=' New company ';c.description='Details';
    api.request.and.returnValue(throwError(()=>({error:{detail:'Please retry'}})));
    c.createPlatform();await new Promise(resolve=>setTimeout(resolve,0));
    expect(c.error()).toBe('Please retry');expect(c.name).toBe(' New company ');expect(c.dialog()!.nativeElement.open).toBeTrue();
    api.request.and.returnValue(of({...platform,chat_id:'new-chat'}));
    c.createPlatform();await new Promise(resolve=>setTimeout(resolve,0));
    expect(api.request).toHaveBeenCalledWith('test','POST','',{name:'New company',description:'Details'});
    expect(changed).toHaveBeenCalledWith('new-chat');expect(c.dialog()!.nativeElement.open).toBeFalse();f.destroy();
  });
  it('previews an invitation without joining and normalizes the link',async()=>{
    const f=setup(),c=f.componentInstance;c.inviteToken='https://kvachat.ru/platform-invite/code/?source=chat';
    api.request.and.returnValue(of({name:'Invited company',description:null}));
    c.previewInvite();await new Promise(resolve=>setTimeout(resolve,0));
    expect(api.request).toHaveBeenCalledOnceWith('test','GET','/invitation/code');expect(c.preview()?.name).toBe('Invited company');f.destroy();
  });
  it('requires explicit confirmation before deleting a platform',async()=>{
    const f=setup(),c=f.componentInstance;f.componentRef.setInput('platform',platform);f.detectChanges();
    api.request.calls.reset();c.show('settings');c.askDelete();
    expect(api.request).not.toHaveBeenCalled();expect(c.confirmation()).not.toBeNull();
    c.confirmAction();await new Promise(resolve=>setTimeout(resolve,0));expect(api.request).toHaveBeenCalledWith('test','DELETE','/p',undefined);f.destroy();
  });
  it('emits the precise message target and closes search',()=>{
    const f=setup(),c=f.componentInstance;const listener=jasmine.createSpy();c.message.subscribe(listener);c.show('search');
    const result={id:'m',chat_id:'c',channel_id:'text',chat_name:'General',author:'A',content:'Found',created_at:'2026-10-21'};
    c.openResult(result);expect(listener).toHaveBeenCalledWith(result);expect(c.dialog()!.nativeElement.open).toBeFalse();f.destroy();
  });
});
