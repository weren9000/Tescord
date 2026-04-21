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
});
