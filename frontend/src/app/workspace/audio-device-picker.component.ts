import {Component, ElementRef, computed, effect, inject, input, output, signal} from '@angular/core';
import {ActionMenuComponent} from './action-menu.component';

@Component({selector:'app-audio-device-picker',standalone:true,imports:[ActionMenuComponent],
 template:`<button class="device-choice" type="button" [disabled]="disabled()" [attr.aria-label]="label() + ': ' + selectedLabel()" aria-haspopup="dialog" [attr.aria-expanded]="opened()" (click)="opened.set(true)"><span>{{selectedLabel()}}</span><span aria-hidden="true">⌄</span></button>
 @if(opened()) {<app-action-menu [label]="label()" (close)="opened.set(false)">
 <p class="menu-note">Выберите устройство. Изменение применяется сразу.</p>
 @for(device of choices();track device.deviceId){<button type="button" [disabled]="disabled()" [attr.aria-pressed]="(value() === 'default' ? '' : value() || '') === device.deviceId" (click)="choose(device.deviceId)"><span class="choice-mark" aria-hidden="true">{{(value() === 'default' ? '' : value() || '') === device.deviceId ? '✓' : ''}}</span>{{device.label}}</button>}
 </app-action-menu>}`,
 styles:[`:host{display:block;min-width:0}.device-choice{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:48px;padding:12px 14px;border:1px solid var(--palette-border);border-radius:10px;background:var(--palette-raised);color:var(--palette-text);font:inherit;text-align:left;cursor:pointer}.device-choice span:first-child{overflow-wrap:anywhere;min-width:0}.device-choice:hover{background:var(--palette-hover)}.device-choice:focus-visible{outline:2px solid var(--palette-primary);outline-offset:2px}.device-choice:disabled{opacity:.55;cursor:default}.choice-mark{width:18px;flex:0 0 18px;color:var(--palette-primary-text)}`]
})
export class AudioDevicePickerComponent {
 private readonly host=inject<ElementRef<HTMLElement>>(ElementRef);
 private readonly restorePending=signal(false);
 constructor(){effect(()=>{
  if(!this.restorePending() || this.disabled() || this.opened())return;
  this.restorePending.set(false);
  queueMicrotask(()=>this.host.nativeElement.querySelector<HTMLButtonElement>('.device-choice')?.focus({preventScroll:true}));
 });}
 readonly label=input.required<string>();readonly value=input<string|null>(null);
 readonly devices=input<{deviceId:string;label:string}[]>([]);readonly disabled=input(false);
 readonly changed=output<string>();readonly opened=signal(false);
 readonly choices=computed(()=>[
  {deviceId:'',label:'Системное устройство'},
  ...this.devices().filter(d=>d.deviceId && d.deviceId!=='default').map(d=>({deviceId:d.deviceId,label:d.deviceId==='communications'?'Для связи · '+d.label.replace(/^.*? - /,''):d.label}))
 ]);
 readonly selectedLabel=computed(()=>this.choices().find(d=>d.deviceId===(this.value()==='default'?'':this.value()||''))?.label ?? 'Устройство недоступно — выберите другое');
 choose(id:string){if(this.disabled())return;this.restorePending.set(true);this.opened.set(false);this.changed.emit(id);}
}
