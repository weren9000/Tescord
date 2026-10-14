import {TestBed} from '@angular/core/testing';
import {AudioDevicePickerComponent} from './audio-device-picker.component';

describe('Audio device picker',()=>{
 it('normalizes the default alias without dropping distinct hardware',()=>{
  const f=TestBed.createComponent(AudioDevicePickerComponent);
  f.componentRef.setInput('label','Микрофон');
  f.componentRef.setInput('value','default');
  f.componentRef.setInput('devices',[{deviceId:'default',label:'Default - Headset'},{deviceId:'one',label:'Headset'},{deviceId:'two',label:'Headset'}]);
  f.detectChanges();
  expect(f.componentInstance.choices().map(d=>d.deviceId)).toEqual(['','one','two']);
  expect(f.componentInstance.selectedLabel()).toBe('Системное устройство');
 });
 it('keeps the displayed selection until the caller applies a change',()=>{
  const f=TestBed.createComponent(AudioDevicePickerComponent);
  f.componentRef.setInput('label','Микрофон');
  f.componentRef.setInput('value','one');
  f.componentRef.setInput('devices',[{deviceId:'one',label:'Old'},{deviceId:'two',label:'New'}]);
  const changed=jasmine.createSpy();f.componentInstance.changed.subscribe(changed);f.detectChanges();
  f.componentInstance.choose('two');
  expect(changed).toHaveBeenCalledWith('two');
  expect(f.componentInstance.selectedLabel()).toBe('Old');
  f.componentRef.setInput('disabled',true);f.detectChanges();f.componentInstance.choose('');
  expect(changed).toHaveBeenCalledTimes(1);
 });
});
