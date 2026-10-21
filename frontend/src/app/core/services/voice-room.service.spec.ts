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
  it('rejects a full room before media connection with a readable message', async () => {
    const pending = service.openControlSocket('room', 'token');
    socket.onclose({code: 4429});
    await expectAsync(pending).toBeRejectedWithError(/30 участников/);
    expect(service.startSocketKeepAlive).not.toHaveBeenCalled();
  });
});
