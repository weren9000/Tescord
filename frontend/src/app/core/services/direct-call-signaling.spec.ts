import {DirectCallService} from './direct-call.service';

describe('Direct call signaling lifecycle', () => {
  it('stops a microphone granted after the LiveKit join was cancelled', async () => {
    const call=new DirectCallService();
    const previousAndroid = window.kvaAndroid;
    const directAudio = jasmine.createSpy('directAudio');
    window.kvaAndroid = {pendingCall: () => null, directAudio};
    let grant!: (stream: MediaStream) => void;
    let requested!: () => void;
    const request=new Promise<void>(resolve=>requested=resolve);
    spyOn(navigator.mediaDevices,'getUserMedia').and.callFake(()=>{requested();return new Promise(resolve=>grant=resolve);});
    const track={kind:'audio',enabled:true,stop:jasmine.createSpy('stop')};
    const join=(call as any).connectMedia({url:'ws://localhost',token:'unused'},'friend');
    await request;
    await call.hangUp();
    grant({getTracks:()=>[track],getAudioTracks:()=>[track],getVideoTracks:()=>[]} as unknown as MediaStream);
    await join;
    expect(track.stop).toHaveBeenCalled();
    expect((call as any).localStream).toBeNull();
    expect((call as any).room).toBeNull();
    expect(directAudio.calls.allArgs()).toEqual([[true], [false]]);
    window.kvaAndroid = previousAndroid;
  });
  it('never joins a call that was cancelled before acceptance arrived', async () => {
    const call=new DirectCallService();
    const join=spyOn(call as any,'connectMedia');
    const send=spyOn(call as any,'send');
    await (call as any).handleMessage({type:'call_accepted',call_id:'late',transport:'sfu',peer:{user_id:'friend'}});
    expect(join).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({type:'hangup',call_id:'late'});
  });
  it('does not capture media when token issuance completes after cancellation', async () => {
    const call=new DirectCallService();
    let reply!: (response: Response) => void;
    spyOn(window,'fetch').and.returnValue(new Promise(resolve=>reply=resolve));
    const join=spyOn(call as any,'connectMedia');
    (call as any).activeCallId='call';
    const pending=(call as any).handleMessage({type:'call_accepted',call_id:'call',transport:'sfu',peer:{user_id:'friend'}});
    await call.hangUp();
    reply(new Response(JSON.stringify({url:'ws://localhost',token:'test'})));
    await pending;
    expect(join).not.toHaveBeenCalled();
    expect(call.state()).toBe('idle');
  });
  it('cancels a late ringing acknowledgement instead of resurrecting a cancelled call', async () => {
    const call=new DirectCallService();const send=spyOn(call as any,'send');
    await (call as any).handleMessage({type:'call_ringing',call_id:'late',peer:{user_id:'friend'}});
    expect(send).toHaveBeenCalledWith({type:'hangup',call_id:'late'});
    expect(call.state()).toBe('idle');
  });
  it('stops incoming tone when the caller cancels', async () => {
    const call=new DirectCallService(),ring=(call as any).ringtone;
    spyOn(ring,'start');spyOn(ring,'stop');
    await (call as any).handleMessage({type:'incoming_call',call_id:'test',peer:{user_id:'friend',nick:'Друг'}});
    expect(ring.start).toHaveBeenCalledWith('incoming');
    await (call as any).handleMessage({type:'call_ended',call_id:'test',detail:'Отменён'});
    expect(ring.stop).toHaveBeenCalled();expect(call.state()).toBe('idle');
  });
});
