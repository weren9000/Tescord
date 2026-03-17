import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AppComponent } from './app.component';
import { AuthApiService } from './core/api/auth-api.service';
import { SystemApiService } from './core/api/system-api.service';
import { WorkspaceApiService } from './core/api/workspace-api.service';
import { VoiceRoomService } from './core/services/voice-room.service';

describe('AppComponent', () => {
  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        {
          provide: SystemApiService,
          useValue: {
            getHealth: () =>
              of({
                service: 'Tescord API',
                status: 'ok',
                environment: 'test',
                database: 'online'
              })
          }
        },
        {
          provide: AuthApiService,
          useValue: {
            login: () =>
              of({
                access_token: 'admin-token',
                token_type: 'bearer',
                user: {
                  id: 'user-1',
                  login: 'weren9000',
                  full_name: 'Верен Чебыкин',
                  nick: 'weren9000',
                  character_name: 'Архимаг Кельн',
                  is_admin: true,
                  created_at: '2026-03-17T00:00:00Z'
                }
              }),
            register: () =>
              of({
                access_token: 'player-token',
                token_type: 'bearer',
                user: {
                  id: 'user-2',
                  login: 'player',
                  full_name: 'Иван Петров',
                  nick: 'hero',
                  character_name: 'Рыцарь',
                  is_admin: false,
                  created_at: '2026-03-17T00:00:00Z'
                }
              })
          }
        },
        {
          provide: WorkspaceApiService,
          useValue: {
            getCurrentUser: () =>
              of({
                id: 'user-1',
                login: 'weren9000',
                full_name: 'Верен Чебыкин',
                nick: 'weren9000',
                character_name: 'Архимаг Кельн',
                is_admin: true,
                created_at: '2026-03-17T00:00:00Z'
              }),
            getServers: () =>
              of([
                {
                  id: 'server-1',
                  name: 'Forgehold Collective',
                  slug: 'forgehold-collective',
                  description: 'Admin workspace',
                  member_role: 'owner'
                }
              ]),
            getChannels: () =>
              of([
                {
                  id: 'channel-1',
                  server_id: 'server-1',
                  name: 'backend',
                  topic: 'API work',
                  type: 'text',
                  position: 0
                }
              ]),
            getMembers: () =>
              of([
                {
                  id: 'member-1',
                  user_id: 'user-1',
                  login: 'weren9000',
                  nick: 'weren9000',
                  full_name: 'Верен Чебыкин',
                  character_name: 'Архимаг Кельн',
                  role: 'owner'
                }
              ]),
            createServer: () =>
              of({
                id: 'server-2',
                name: 'Новая группа',
                slug: 'novaya-gruppa',
                description: 'Описание',
                member_role: 'owner'
              }),
            createChannel: () =>
              of({
                id: 'channel-2',
                server_id: 'server-1',
                name: 'новости',
                topic: 'Обновления',
                type: 'text',
                position: 1
              })
          }
        },
        {
          provide: VoiceRoomService,
          useValue: {
            participants: signal([]),
            error: signal(null),
            state: signal('idle'),
            localMuted: signal(false),
            settings: signal({
              inputDeviceId: null,
              outputDeviceId: null,
              sensitivity: 58,
              masterVolume: 100,
              participantVolumes: {}
            }),
            settingsNotice: signal(null),
            devicesLoading: signal(false),
            inputDevices: signal([]),
            outputDevices: signal([]),
            outputDeviceSupported: computed(() => true),
            activeChannelId: signal(null),
            isConnected: computed(() => false),
            join: async () => undefined,
            leave: () => undefined,
            toggleMute: () => undefined,
            refreshDevices: async () => undefined,
            updateInputDevice: async () => undefined,
            updateOutputDevice: async () => undefined,
            updateSensitivity: () => undefined,
            updateMasterVolume: () => undefined,
            updateParticipantVolume: () => undefined,
            getParticipantVolume: () => 100
          }
        }
      ]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
