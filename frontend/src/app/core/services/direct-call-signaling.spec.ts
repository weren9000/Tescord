import {DirectCallService} from './direct-call.service';

describe('Direct call signaling lifecycle', () => {
  it('releases a microphone granted after the call was cancelled', async () => {
    const call = new DirectCallService();
    let grant!: (stream: MediaStream) => void;
    spyOn(navigator.mediaDevices,'getUserMedia').and.returnValue(new Promise(resolve=>grant=resolve));
    const track={stop:jasmine.createSpy('stop')};
    const pending=(call as any).ensureLocalStream();
    (call as any).resetCallState();
    grant({getTracks:()=>[track]} as unknown as MediaStream);
    await pending;
    expect(track.stop).toHaveBeenCalled();
    expect((call as any).localStream).toBeNull();
  });
  it('buffers early ICE candidates and applies them after the answer', async () => {
    const call=new DirectCallService(), candidate={candidate:'candidate:1 1 UDP 1 127.0.0.1 5000 typ host',sdpMid:'0',sdpMLineIndex:0};
    const connection={remoteDescription:null,setRemoteDescription:jasmine.createSpy().and.resolveTo(),addIceCandidate:jasmine.createSpy().and.resolveTo()};
    Object.assign(call as any,{peerConnection:connection});
    await (call as any).handleMessage({type:'ice_candidate',payload:candidate});
    expect(connection.addIceCandidate).not.toHaveBeenCalled();
    await (call as any).handleMessage({type:'answer',payload:{type:'answer',sdp:''}});
    expect(connection.addIceCandidate).toHaveBeenCalledTimes(1);
    expect((call as any).pendingIce.length).toBe(0);
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
