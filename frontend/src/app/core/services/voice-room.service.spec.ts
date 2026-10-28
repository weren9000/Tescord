import { TestBed } from '@angular/core/testing';
import { WorkspaceApiService } from '../api/workspace-api.service';
import { VoiceRoomService } from './voice-room.service';

describe('Voice room admission', () => {
  let service: any;
  let socket: any;
  beforeEach(() => {
    TestBed.configureTestingModule({providers: [VoiceRoomService, {provide: WorkspaceApiService, useValue: {}}]});
    service = TestBed.inject(VoiceRoomService);
    socket = {addEventListener: () => {}, close: jasmine.createSpy('close'), send: () => {}};
    spyOn(window, 'WebSocket').and.callFake(function() { return socket; } as any);
    spyOn(service, 'startSocketKeepAlive');
    spyOn(service, 'stopSocketKeepAlive');
    spyOn(service, 'updateOperationalState');
    spyOn(service, 'handleControlSocketMessage');
  });
  it('waits for server admission before allowing media connection', async () => {
    let admitted = false;
    const pending = service.openControlSocket('room', 'token').then(() => admitted = true);
    socket.onopen?.();
    await Promise.resolve();
    expect(admitted).toBeFalse();
    socket.onmessage({data: JSON.stringify({type: 'room_state'})});
    await pending;
    expect(admitted).toBeTrue();
    expect(service.startSocketKeepAlive).toHaveBeenCalledTimes(1);
  });
  it('keeps the local call when 29 peers join, leave and rejoin', () => {
    service.handleControlSocketMessage.and.callThrough();
    const fail = spyOn(service, 'failSession');
    const leave = spyOn(service, 'leave');
    const self = {id:'self',user_id:'self-user',nick:'Self',muted:false,owner_muted:false,is_self:true};
    service.selfId = 'self';service.activeChannelId.set('platform-room');service.state.set('connected');
    service.participants.set([self]);
    for (let i = 0; i < 29; i++) {
      service.handleControlSocketMessage(JSON.stringify({type:'peer_joined',participant:{...self,id:`peer-${i}`,user_id:`user-${i}`,is_self:false}}));
    }
    expect(service.participants().length).toBe(30);
    service.handleControlSocketMessage(JSON.stringify({type:'peer_left',participant_id:'peer-0'}));
    service.handleControlSocketMessage(JSON.stringify({type:'peer_joined',participant:{...self,id:'replacement',user_id:'user-0',is_self:false}}));
    expect(service.participants().length).toBe(30);
    expect(service.participants()[0].is_self).toBeTrue();
    expect(service.activeChannelId()).toBe('platform-room');expect(service.state()).toBe('connected');
    expect(fail).not.toHaveBeenCalled();expect(leave).not.toHaveBeenCalled();
  });
  it('rejects a full room before media connection with a readable message', async () => {
    const pending = service.openControlSocket('room', 'token');
    socket.onclose({code: 4429});
    await expectAsync(pending).toBeRejectedWithError(/30 участников/);
    expect(service.startSocketKeepAlive).not.toHaveBeenCalled();
  });
});
