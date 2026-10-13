import {Component} from '@angular/core';
import {TestBed, fakeAsync, tick} from '@angular/core/testing';
import {MessageGestureDirective} from './message-gesture.directive';

@Component({standalone:true,imports:[MessageGestureDirective],template:`<article appMessageGesture (replyGesture)="replies=replies+1" (holdGesture)="holds=holds+1"><p>Text</p><button>Attachment</button></article>`})
class Host {replies=0;holds=0;}
describe('message touch gestures',()=>{
  function setup(){
    const fixture=TestBed.createComponent(Host);fixture.detectChanges();
    const article=fixture.nativeElement.querySelector('article') as HTMLElement;
    const send=(type:string,x=50,y=50,target:HTMLElement=article,pointerType='touch')=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:1,pointerType,isPrimary:true,button:0,clientX:x,clientY:y}));
    return {fixture,article,send};
  }
  it('opens actions only after a stationary hold',fakeAsync(()=>{
    const {fixture,send}=setup();send('pointerdown');tick(499);expect(fixture.componentInstance.holds).toBe(0);
    tick(1);expect(fixture.componentInstance.holds).toBe(1);send('pointerup');expect(fixture.componentInstance.replies).toBe(0);
    fixture.destroy();
  }));
  it('replies to a deliberate right swipe, not scrolling or a small move',fakeAsync(()=>{
    const {fixture,send}=setup();send('pointerdown');send('pointermove',120,52);send('pointerup',120,52);
    expect(fixture.componentInstance.replies).toBe(1);
    send('pointerdown');send('pointermove',55,110);tick(600);send('pointerup',55,110);
    send('pointerdown');send('pointermove',75,50);send('pointerup',75,50);tick(600);
    expect(fixture.componentInstance.replies).toBe(1);expect(fixture.componentInstance.holds).toBe(0);fixture.destroy();
  }));
  it('leaves attachments, mouse input and cancelled touches alone',fakeAsync(()=>{
    const {fixture,article,send}=setup();send('pointerdown',50,50,article.querySelector('button')!);tick(600);
    send('pointerdown',50,50,article,'mouse');tick(600);
    send('pointerdown');send('pointercancel');tick(600);
    expect(fixture.componentInstance.holds).toBe(0);expect(fixture.componentInstance.replies).toBe(0);fixture.destroy();
  }));
});
