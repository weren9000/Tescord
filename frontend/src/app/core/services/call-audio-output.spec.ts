import { TestBed } from '@angular/core/testing';
import { WorkspaceApiService } from '../api/workspace-api.service';
import { DirectCallService } from './direct-call.service';
import { VoiceRoomService } from './voice-room.service';

describe('Call audio output', () => {
  let savedSettings: string | null;
  beforeEach(() => {
    savedSettings = localStorage.getItem('tescord.voice.settings');
    localStorage.removeItem('tescord.voice.settings');
  });
  afterEach(() => {
    if (savedSettings === null) localStorage.removeItem('tescord.voice.settings');
    else localStorage.setItem('tescord.voice.settings', savedSettings);
  });

  it('preserves personal silence through new tracks and reload, without silencing another participant', () => {
    TestBed.configureTestingModule({providers: [{provide: WorkspaceApiService, useValue: {}}]});
    let call = TestBed.inject(VoiceRoomService);
    const first = new Audio(), other = new Audio();
    let internals = call as any;
    internals.remoteAudioOutputs.set('silent', {audioElement: first});
    internals.remoteAudioOutputs.set('other', {audioElement: other});
    call.updateParticipantVolume('other', 70);
    call.updateParticipantVolume('silent', 0);
    expect(first.volume).toBe(0);
    expect(first.muted).toBeTrue();
    expect(other.volume).toBeCloseTo(.7);
    expect(other.muted).toBeFalse();
    expect(call.localMuted()).toBeFalse();
    call.toggleOutputMuted();
    call.toggleOutputMuted();
    expect(first.muted).toBeTrue();
    expect(other.volume).toBeCloseTo(.7);
    call.leave();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({providers: [{provide: WorkspaceApiService, useValue: {}}]});
    call = TestBed.inject(VoiceRoomService);
    internals = call as any;
    expect(call.getParticipantVolume('silent')).toBe(0);
    internals.ensureAudiblePlaybackSettings('silent');
    const replacement = new Audio();
    internals.remoteAudioOutputs.set('silent', {audioElement: replacement});
    internals.applyVolumesForUser('silent');
    expect(replacement.volume).toBe(0);
    expect(replacement.muted).toBeTrue();
    for (const value of [1, 5, 9, 100]) {
      call.updateParticipantVolume('silent', value);
      expect(replacement.volume).toBeCloseTo(value / 100);
      expect(replacement.muted).toBeFalse();
    }
    call.updateMasterVolume(0);
    expect(call.settings().masterVolume).toBe(10);
    call.leave();
  });
  it('restores the last audible personal volume after mute, reload and repeated zero updates', () => {
    TestBed.configureTestingModule({providers: [{provide: WorkspaceApiService, useValue: {}}]});
    let call = TestBed.inject(VoiceRoomService);
    call.updateParticipantVolume('one', 37);
    call.toggleParticipantMuted('one');
    call.updateParticipantVolume('one', 0);
    expect(call.getParticipantVolume('one')).toBe(0);
    call.leave();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({providers: [{provide: WorkspaceApiService, useValue: {}}]});
    call = TestBed.inject(VoiceRoomService);
    call.toggleParticipantMuted('one');
    expect(call.getParticipantVolume('one')).toBe(37);
    call.updateParticipantVolume('one', 9);
    call.updateParticipantVolume('one', 0);
    call.toggleOutputMuted();
    call.toggleParticipantMuted('one');
    expect(call.getParticipantVolume('one')).toBe(9);
    expect(call.outputMuted()).toBeTrue();
    call.toggleParticipantMuted('unknown');
    call.toggleParticipantMuted('unknown');
    expect(call.getParticipantVolume('unknown')).toBe(100);
    call.leave();
  });

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
