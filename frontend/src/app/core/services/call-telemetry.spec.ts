import {fakeAsync, flushMicrotasks, tick} from '@angular/core/testing';
import type {Room} from 'livekit-client';
import {observeCall} from './call-telemetry';

describe('passive call telemetry', () => {
  it('reports deltas, deduplicates reconnect events and disposes timers', fakeAsync(() => {
    const handlers = new Map<string, () => void>();
    let received = 100, lost = 2;
    const getRTCStatsReport = jasmine.createSpy().and.callFake(async () => new Map([
      ['rtp', {id:'rtp',type:'inbound-rtp',jitter:.004,packetsReceived:received,packetsLost:lost}],
      ['pair', {id:'pair',type:'candidate-pair',currentRoundTripTime:.03}],
    ]));
    const track = {sid:'audio',getRTCStatsReport};
    const room = {state:'connected',localParticipant:{trackPublications:new Map()},
      remoteParticipants:new Map([['peer',{trackPublications:new Map([['audio',{track}]])}]]),
      on:(key:string, fn:()=>void)=>handlers.set(key,fn),
      off:(key:string)=>handlers.delete(key),
    } as unknown as Room;
    const fetchSpy=spyOn(window,'fetch').and.resolveTo(new Response(null,{status:204}));
    const stop=observeCall(room,()=> 'test-only');
    handlers.get('connected')!();
    tick(15000);flushMicrotasks();
    expect(fetchSpy.calls.count()).toBe(1);
    expect(JSON.parse(fetchSpy.calls.mostRecent().args[1]!.body as string).loss_percent).toBeNull();
    received+=98;lost+=2;
    handlers.get('reconnecting')!();handlers.get('signalReconnecting')!();handlers.get('reconnected')!();
    tick(15000);flushMicrotasks();
    const sample=JSON.parse(fetchSpy.calls.mostRecent().args[1]!.body as string);
    expect(sample.loss_percent).toBe(2);expect(sample.jitter_ms).toBe(4);expect(sample.rtt_ms).toBe(30);
    expect(sample.reconnects).toBe(1);
    stop();tick(30000);
    expect(fetchSpy.calls.count()).toBe(2);expect(handlers.size).toBe(0);
    expect(room.state).toBe('connected');
  }));
});
