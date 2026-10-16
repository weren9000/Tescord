import { TestBed } from '@angular/core/testing';
import { WorkspaceApiService } from '../api/workspace-api.service';
import { DirectCallService } from './direct-call.service';
import { VoiceRoomService } from './voice-room.service';

describe('Call device changes', () => {
  function stream() {
    const track = {kind: 'audio', enabled: true, stop: jasmine.createSpy('stop')};
    return {track, media: {getTracks: () => [track], getAudioTracks: () => [track]} as unknown as MediaStream};
  }

  it('replaces a direct microphone without unmuting or replacing the connection', async () => {
    const call = new DirectCallService(), old = stream(), next = stream();
    const sender = {replaceTrack: jasmine.createSpy().and.resolveTo(), mute: jasmine.createSpy().and.resolveTo(), unmute: jasmine.createSpy().and.resolveTo()};
    const connection = {};
    Object.assign(call as any, {localStream: old.media, localAudioTrack: sender, room: connection});
    call.localMuted.set(true);
    spyOn(navigator.mediaDevices, 'getUserMedia').and.resolveTo(next.media);
    await call.updateInputDevice('second');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({audio: {
      deviceId: {exact: 'second'}, echoCancellation: true, noiseSuppression: true, autoGainControl: true
    }});
    expect(sender.replaceTrack).toHaveBeenCalledWith(next.track, true);
    expect(next.track.enabled).toBeFalse();
    expect(old.track.stop).toHaveBeenCalled();
    expect((call as any).room).toBe(connection);
    expect(call.inputDeviceId()).toBe('second');
  });

  it('keeps the old direct microphone on failure and disposes the rejected replacement', async () => {
    const call = new DirectCallService(), old = stream(), next = stream();
    Object.assign(call as any, {localStream: old.media, localAudioTrack: {replaceTrack: () => Promise.reject(new Error('closed'))}});
    spyOn(navigator.mediaDevices, 'getUserMedia').and.resolveTo(next.media);
    await call.updateInputDevice('second');
    expect(old.track.stop).not.toHaveBeenCalled();
    expect(next.track.stop).toHaveBeenCalled();
    expect(call.inputDeviceId()).toBeNull();
    expect(call.deviceNotice()).toBeTruthy();
  });

  it('disposes a late microphone result after the call has ended', async () => {
    const call = new DirectCallService(), old = stream(), next = stream();
    let resolve!: (value: MediaStream) => void;
    Object.assign(call as any, {localStream: old.media, localAudioTrack: {}});
    spyOn(navigator.mediaDevices, 'getUserMedia').and.returnValue(new Promise(r => resolve = r));
    const pending = call.updateInputDevice('second');
    (call as any).localStream = null;
    (call as any).localAudioTrack = null;
    resolve(next.media);
    await pending;
    expect(next.track.stop).toHaveBeenCalled();
    expect(call.inputDeviceId()).toBeNull();
    expect(call.deviceChanging()).toBeFalse();
  });

  it('preserves the selected output after a rejected direct device change', async () => {
    const call = new DirectCallService();
    (call as any).remoteAudioElement = {setSinkId: () => Promise.reject(new Error('denied'))};
    call.outputDeviceId.set('previous');
    await call.updateOutputDevice('missing');
    expect(call.outputDeviceId()).toBe('previous');
    expect(call.deviceNotice()).toBeTruthy();
  });

  it('returns voice playback to the default device without changing personal mute', async () => {
    TestBed.configureTestingModule({providers: [{provide: WorkspaceApiService, useValue: {}}]});
    const saved = localStorage.getItem('tescord.voice.settings');
    const call = TestBed.inject(VoiceRoomService);
    try {
      const audio = new Audio();
      const setSinkId = jasmine.createSpy().and.resolveTo();
      Object.assign(audio, {setSinkId});
      (call as any).remoteAudioOutputs.set('peer', {audioElement: audio});
      call.updateParticipantVolume('peer', 0);
      await call.updateOutputDevice('speaker');
      await call.updateOutputDevice(null);
      expect(setSinkId.calls.allArgs()).toEqual([['speaker'], ['']]);
      expect(audio.muted).toBeTrue();
    } finally {
      call.leave();
      if (saved === null) localStorage.removeItem('tescord.voice.settings');
      else localStorage.setItem('tescord.voice.settings', saved);
    }
  });

  it('changes an unpublished voice microphone while preserving the owner restriction', async () => {
    TestBed.configureTestingModule({providers: [{provide: WorkspaceApiService, useValue: {}}]});
    const saved = localStorage.getItem('tescord.voice.settings');
    const call = TestBed.inject(VoiceRoomService), old = stream(), next = stream();
    const room = {};
    const track = {isMuted: true};
    Object.assign(call as any, {rawLocalStream: old.media, localStream: old.media, localAudioTrack: {sender: null}, room});
    spyOn(call as any, 'createLocalAudioTrack').and.returnValue(track);
    spyOn(call, 'refreshDevices').and.resolveTo();
    spyOn(navigator.mediaDevices, 'getUserMedia').and.resolveTo(next.media);
    spyOn(call, 'ownerMuted').and.returnValue(true);
    try {
      await call.updateInputDevice('second');
      expect((call as any).room).toBe(room);
      expect((call as any).localAudioTrack).toBe(track);
      expect(next.track.enabled).toBeFalse();
      expect(old.track.stop).toHaveBeenCalled();
      expect(call.settings().inputDeviceId).toBe('second');
    } finally {
      if (saved === null) localStorage.removeItem('tescord.voice.settings');
      else localStorage.setItem('tescord.voice.settings', saved);
    }
  });
});
