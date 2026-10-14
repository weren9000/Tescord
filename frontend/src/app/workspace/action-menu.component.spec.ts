import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActionMenuComponent } from './action-menu.component';

@Component({standalone: true, imports: [ActionMenuComponent], template: `
  <button id="opener" (click)="open = true">Open</button>
  @if (open) { <app-action-menu label="Actions" (close)="open = false">
    <button id="first">First</button><button disabled>Unavailable</button><button id="last">Last</button>
  </app-action-menu> }
`})
class HostComponent { open = false; }

describe('ActionMenuComponent', () => {
  function setup() {
    const fixture = TestBed.createComponent(HostComponent); fixture.detectChanges();
    const opener = fixture.nativeElement.querySelector('#opener') as HTMLButtonElement;
    opener.focus(); opener.click(); fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    return {fixture, opener, dialog};
  }
  it('uses the top layer and restores the trigger on Escape', () => {
    const {fixture, opener, dialog} = setup();
    expect(dialog.matches(':modal')).toBeTrue();
    dialog.dispatchEvent(new Event('cancel', {cancelable:true})); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
  it('skips disabled actions with arrows and contains Tab at both edges', () => {
    const {dialog} = setup();
    const first = dialog.querySelector('#first') as HTMLButtonElement;
    const last = dialog.querySelector('#last') as HTMLButtonElement;
    first.focus(); first.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true,cancelable:true}));
    expect(document.activeElement).toBe(last);
    last.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab',bubbles:true,cancelable:true}));
    expect(document.activeElement).toBe(dialog.querySelector('button'));
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
    expect(document.activeElement).toBe(last);
  });
  it('dismisses on the backdrop but not the surface', () => {
    const {fixture,dialog} = setup();
    const r = dialog.getBoundingClientRect();
    dialog.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    dialog.dispatchEvent(new MouseEvent('click',{clientX:r.left+5,clientY:r.top+5,bubbles:true})); fixture.detectChanges();
    expect(fixture.componentInstance.open).toBeTrue();
    dialog.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    dialog.dispatchEvent(new MouseEvent('click',{clientX:0,clientY:0,bubbles:true})); fixture.detectChanges();
    expect(fixture.componentInstance.open).toBeFalse();
  });
});
