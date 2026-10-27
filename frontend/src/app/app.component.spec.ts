import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AppComponent } from './app.component';
import { AuthApiService } from './core/api/auth-api.service';
import { SystemApiService } from './core/api/system-api.service';
import { WorkspaceApiService } from './core/api/workspace-api.service';
import { DirectCallService } from './core/services/direct-call.service';
import { VoiceRoomService } from './core/services/voice-room.service';

describe('AppComponent', () => {
  it('applies the general settings volume to the active direct call audio', () => {
    const direct = new DirectCallService();
    TestBed.overrideProvider(DirectCallService, {useValue: direct});
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    spyOn(app, 'activeCallSurface').and.returnValue({kind: 'direct'} as any);
    const audio = new Audio();
    (direct as any).remoteAudioElement = audio;
    for (const value of [35, 0, 80]) {
      app.changeMasterVolume(String(value));
      expect(app.activeCallVolume()).toBe(value);
      expect(audio.volume).toBeCloseTo(value / 100);
      expect(direct.localMuted()).toBeFalse();
    }
    fixture.destroy();
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        {
          provide: SystemApiService,
          useValue: {
            getHealth: () =>
              of({
                service: 'Altgramm API',
                status: 'ok',
                environment: 'test',
                database: 'online',
              }),
          },
        },
        {
          provide: AuthApiService,
          useValue: {
            login: () => of(null),
            register: () => of(null),
          },
        },
        {
          provide: WorkspaceApiService,
          useValue: {
            getCurrentUser: () => of(null),
            getServers: () => of([]),
            getConversations: () => of([]),
            getConversationDirectory: () => of([]),
            getChannels: () => of([]),
            getMembers: () => of([]),
            getVoicePresence: () => of([]),
          },
        },
        {
          provide: DirectCallService,
          useValue: {
            stop: () => undefined,
            connected: signal(true),
            state: signal('idle'),
            error: signal(null),
            notice: signal(null),
            peer: signal(null),
            canCall: computed(() => true),
            screenShareSupported: computed(() => true),
            isScreenSharing: computed(() => false),
            localScreenStream: signal(null),
            remoteScreenStream: signal(null),
            hasRemoteScreenShare: computed(() => false),
            hasActiveCall: computed(() => false),
          },
        },
        {
          provide: VoiceRoomService,
          useValue: {
            participants: signal([]),
            error: signal(null),
            state: signal('idle'),
            localMuted: signal(false),
            ownerMuted: signal(false),
            cameraSupported: computed(() => true),
            cameraEnabled: computed(() => false),
            localVideoStream: signal(null),
            screenShareSupported: computed(() => true),
            screenShareEnabled: computed(() => false),
            localScreenShareStream: signal(null),
            settings: signal({
              inputDeviceId: null,
              outputDeviceId: null,
              sensitivity: 50,
              microphoneGain: 100,
              masterVolume: 100,
              participantVolumes: {},
            }),
            settingsNotice: signal(null),
            devicesLoading: signal(false),
            inputDevices: signal([]),
            outputDevices: signal([]),
            outputDeviceSupported: computed(() => false),
            remoteVideoStreamForParticipant: () => null,
            remoteScreenShareStreamForParticipant: () => null,
          },
        },
      ],
    }).compileComponents();
  });

  it('creates', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
  it('reuses text models across a long history and invalidates edited text and search', () => {
    const fixture=TestBed.createComponent(AppComponent), app=fixture.componentInstance;
    const messages=Array.from({length:1000},(_,i)=>({id:String(i),content:'Message '+i+' https://example.com',mentioned_user_ids:[]} as any));
    const models=messages.map(m=>app.messageTextModel(m));
    for(let pass=0;pass<3;pass++) messages.forEach((m,i)=>expect(app.messageTextModel(m)).toBe(models[i]));
    messages[0].content='Edited';expect(app.messageTextModel(messages[0])).not.toBe(models[0]);
    const before=app.messageTextModel(messages[1]);app.messageSearchQuery.set('Message');
    expect(app.messageTextModel(messages[1])).not.toBe(before);
    fixture.destroy();
  });

});
