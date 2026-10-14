import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InfoPanelComponent } from './info-panel.component';

@Component({standalone:true,imports:[InfoPanelComponent],template:`
  <button id="trigger" (click)="open=true">Info</button><input id="composer" aria-label="Message" />
  @if(open){<app-info-panel label="Conversation" (close)="open=false"><button id="action">Action</button></app-info-panel>}
`})
class HostComponent { open=false; }

describe('InfoPanelComponent',()=>{
  function open(mobile:boolean){
    spyOn(window,'matchMedia').and.returnValue({matches:mobile,addEventListener:()=>{},removeEventListener:()=>{}} as unknown as MediaQueryList);
    const fixture=TestBed.createComponent(HostComponent);fixture.detectChanges();
    const trigger=fixture.nativeElement.querySelector('#trigger') as HTMLButtonElement;
    trigger.focus();trigger.click();fixture.detectChanges();
    return {fixture,trigger,dialog:fixture.nativeElement.querySelector('dialog') as HTMLDialogElement};
  }
  it('keeps the conversation interactive on desktop',()=>{
    const {fixture,dialog}=open(false);
    expect(dialog.open).toBeTrue();expect(dialog.matches(':modal')).toBeFalse();
    const composer=fixture.nativeElement.querySelector('#composer') as HTMLInputElement;
    composer.focus();expect(document.activeElement).toBe(composer);
  });
  it('uses the modal top layer on mobile and restores focus on Escape',()=>{
    const {fixture,trigger,dialog}=open(true);
    expect(dialog.matches(':modal')).toBeTrue();
    dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);
  });
});
