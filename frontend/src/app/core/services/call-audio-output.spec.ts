import { TestBed } from '@angular/core/testing';
import { WorkspaceApiService } from '../api/workspace-api.service';
import { DirectCallService } from './direct-call.service';
import { VoiceRoomService } from './voice-room.service';

describe('Call audio output', () => {
  it('silences direct-call playback and restores the selected volume without muting the microphone', () => {
    const call = new DirectCallService();
    const audio = new Audio();
    (call as any).remoteAudioElement = audio;
    call.updateRemoteVolume(65);
    call.toggleOutputMuted();
    expect(audio.volume).toBe(0);
    expect(audio.muted).toBeTrue();
    expect(call.localMuted()).toBeFalse();
    call.updateRemoteVolume(42);
    expect(audio.volume).toBe(0);
    call.toggleOutputMuted();
    expect(audio.volume).toBeCloseTo(.42);
    expect(audio.muted).toBeFalse();
    call.stop();
  });

  it('keeps new group audio tracks silent while output is muted, then restores individual gains', () => {
    TestBed.configureTestingModule({providers: [{provide: WorkspaceApiService, useValue: {}}]});
    const call = TestBed.inject(VoiceRoomService);
    const first = new Audio(), second = new Audio();
    const internals = call as any;
    internals.remoteAudioOutputs.set('one', {audioElement: first});
    call.updateMasterVolume(60);
    call.updateParticipantVolume('one', 50);
    expect(first.volume).toBeCloseTo(.3);
    call.toggleOutputMuted();
    expect(first.volume).toBe(0);
    internals.remoteAudioOutputs.set('two', {audioElement: second});
    call.updateParticipantVolume('two', 80);
    expect(second.volume).toBe(0);
    call.toggleOutputMuted();
    expect(first.volume).toBeCloseTo(.3);
    expect(second.volume).toBeCloseTo(.48);
    call.leave();
  });
});
