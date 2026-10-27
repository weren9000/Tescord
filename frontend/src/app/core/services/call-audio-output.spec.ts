import { TestBed } from '@angular/core/testing';
import { WorkspaceApiService } from '../api/workspace-api.service';
import { DirectCallService } from './direct-call.service';
import { VoiceRoomService } from './voice-room.service';

describe('Call audio output', () => {
  it('retries the decoder and processed output together after autoplay is blocked', async () => {
    TestBed.configureTestingModule({providers: [{provide: WorkspaceApiService, useValue: {}}]});
    const call = TestBed.inject(VoiceRoomService), internals = call as any;
    const playback = {play: jasmine.createSpy().and.resolveTo(), dispose: () => {}};
    internals.remoteAudioOutputs.set('peer', {audioElement: new Audio(), playback});
    internals.pendingPlaybackUnlock.add('peer');
    spyOn(internals, 'ensureAudioContext').and.resolveTo(null);
    await internals.retryPendingAudioPlayback();
    expect(playback.play).toHaveBeenCalled();
    expect(internals.pendingPlaybackUnlock.size).toBe(0);
    call.leave();
  });
  it('applies personal gain when saving settings throws', () => {
    TestBed.configureTestingModule({providers: [{provide: WorkspaceApiService, useValue: {}}]});
    const call = TestBed.inject(VoiceRoomService), audio = new Audio();
    (call as any).remoteAudioOutputs.set('peer', {audioElement: audio});
    spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');
    expect(() => call.updateParticipantVolume('peer', 23)).not.toThrow();
    expect(audio.volume).toBeCloseTo(.23);
    expect(call.getParticipantVolume('peer')).toBe(23);
    call.leave();
  });
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
    expect(call.settings().masterVolume).toBe(0);
    call.leave();
  });
  it('ignores retired general volume without attenuating individual outputs', () => {
    TestBed.configureTestingModule({providers: [{provide: WorkspaceApiService, useValue: {}}]});
    const call = TestBed.inject(VoiceRoomService);
    const first = new Audio(), second = new Audio();
    const internals = call as any;
    internals.remoteAudioOutputs.set('one', {audioElement: first});
    internals.remoteAudioOutputs.set('two', {audioElement: second});
    call.updateParticipantVolume('two', 50);
    for (const value of [100, 40, 9, 1, 0, 75]) {
      call.updateMasterVolume(value);
      expect(first.volume).toBe(1);
      expect(second.volume).toBeCloseTo(.5);
      expect(first.muted).toBeFalse();
      expect(second.muted).toBeFalse();
      expect(call.getParticipantVolume('two')).toBe(50);
      expect(call.localMuted()).toBeFalse();
    }
    for (const invalid of [NaN, Infinity, -Infinity]) call.updateMasterVolume(invalid);
    expect(call.settings().masterVolume).toBe(75);
    expect(first.volume).toBe(1);
    call.leave();
  });

  it('does not let retired zero master volume silence a new participant', () => {
    TestBed.configureTestingModule({providers: [{provide: WorkspaceApiService, useValue: {}}]});
    let call = TestBed.inject(VoiceRoomService);
    call.updateMasterVolume(0);
    call.leave();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({providers: [{provide: WorkspaceApiService, useValue: {}}]});
    call = TestBed.inject(VoiceRoomService);
    const internals = call as any;
    internals.ensureAudiblePlaybackSettings('one');
    const audio = new Audio();
    internals.remoteAudioOutputs.set('one', {audioElement: audio});
    internals.applyVolumesForUser('one');
    expect(call.settings().masterVolume).toBe(0);
    expect(audio.volume).toBe(1);
    expect(audio.muted).toBeFalse();
    call.updateMasterVolume(25);
    expect(audio.volume).toBe(1);
    expect(audio.muted).toBeFalse();
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
    expect(audio.volume).toBeCloseTo(.42);
    expect(call.outputMuted()).toBeFalse();
    call.toggleOutputMuted();
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
    expect(first.volume).toBeCloseTo(.5);
    call.toggleOutputMuted();
    expect(first.volume).toBe(0);
    internals.remoteAudioOutputs.set('two', {audioElement: second});
    call.updateParticipantVolume('two', 80);
    expect(second.volume).toBe(0);
    call.toggleOutputMuted();
    expect(first.volume).toBeCloseTo(.5);
    expect(second.volume).toBeCloseTo(.8);
    call.leave();
  });
});
