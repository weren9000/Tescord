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
  for (const kind of ['group', 'platform', 'direct'] as const) {
    it(`expands the ${kind} call in its own space when another chat is open`, () => {
      const fixture = TestBed.createComponent(AppComponent), app = fixture.componentInstance;
      spyOn(app, 'activeCallSurface').and.returnValue({kind, id:'call', channelId:kind === 'direct' ? null : 'voice', title:'Call', subtitle:'', participantCount:2, activeSpeakerLabel:null});
      spyOn(app, 'activeServer').and.returnValue({id:'other'} as any);
      if (kind === 'direct') {
        spyOn(app, 'directCallPeer').and.returnValue({user_id:'peer', nick:'Peer', avatar_updated_at:null});
        spyOn(app, 'findDirectConversationByUserId').and.returnValue({id:'target'} as any);
      } else {
        app.activeVoiceCallSnapshot.set({kind, serverId:'target', serverName:'Target', channel:{id:'voice',type:'voice'} as any});
      }
      app.selectedServerId.set('other');app.callWindowMode.set('minimized');
      const select = spyOn(app, 'selectServer');
      const leave = spyOn(app, 'leaveVoiceChannel');
      const hangup = spyOn(app, 'hangupDirectCall').and.resolveTo();
      const close = spyOn(app, 'closeMobilePanel');
      app.expandCallWindow();
      expect(select).toHaveBeenCalledWith('target');
      expect(app.workspaceMode()).toBe(kind === 'direct' ? 'chats' : kind === 'group' ? 'groups' : 'platforms');
      if (kind === 'platform') expect((app as any).pendingSearchNavigation()).toEqual({serverId:'target',channelId:'voice'});
      expect(app.callWindowMode()).toBe('expanded');expect(close).toHaveBeenCalled();
      expect(leave).not.toHaveBeenCalled();expect(hangup).not.toHaveBeenCalled();fixture.destroy();
    });
  }
  it('expands into the active voice room when another channel of the same platform is open', () => {
    const fixture = TestBed.createComponent(AppComponent), app = fixture.componentInstance;
    const channel = {id:'voice', type:'voice'} as any;
    spyOn(app,'activeCallSurface').and.returnValue({kind:'platform',id:'call',channelId:'voice',title:'Call',subtitle:'',participantCount:2,activeSpeakerLabel:null});
    app.activeVoiceCallSnapshot.set({kind:'platform',serverId:'target',serverName:'Target',channel});
    app.selectedServerId.set('target');app.selectedChannelId.set('other');app.channels.set([channel]);
    const select = spyOn(app,'selectChannel').and.resolveTo();
    const server = spyOn(app,'selectServer');
    app.expandCallWindow();
    expect(select).toHaveBeenCalledWith(channel,{connectVoice:false});
    expect(server).not.toHaveBeenCalled();expect(app.callWindowMode()).toBe('expanded');fixture.destroy();
  });
  it('opens the platform call chat without joining voice and keeps the draft', () => {
    const fixture = TestBed.createComponent(AppComponent), app = fixture.componentInstance;
    const channel = {id:'voice',type:'voice',name:'Room'} as any;
    spyOn(app,'activeCallSurface').and.returnValue({kind:'platform',id:'platform:voice',channelId:'voice',title:'Room',subtitle:'Space',participantCount:3,activeSpeakerLabel:null});
    app.activeVoiceCallSnapshot.set({kind:'platform',serverId:'space',serverName:'Space',channel});
    app.selectedServerId.set('space');app.selectedChannelId.set('other');app.channels.set([channel]);
    app.messageDraft.set('Unsent message');app.callWindowMode.set('expanded');
    const select=spyOn(app,'selectChannel').and.resolveTo();
    const leave=spyOn(app,'leaveVoiceChannel');
    app.openActiveCallChat();
    expect(select).toHaveBeenCalledWith(channel,{connectVoice:false});
    expect(app.callWindowMode()).toBe('minimized');expect(app.messageDraft()).toBe('Unsent message');
    expect(leave).not.toHaveBeenCalled();fixture.destroy();
  });
  it('returns to the group server without changing media state',()=>{
    const fixture=TestBed.createComponent(AppComponent),app=fixture.componentInstance;
    spyOn(app,'activeCallSurface').and.returnValue({kind:'group',id:'group:v',channelId:'v',title:'Group',subtitle:'Group',participantCount:2,activeSpeakerLabel:null});
    app.activeVoiceCallSnapshot.set({kind:'group',serverId:'group',serverName:'Group',channel:{id:'v',type:'voice'} as any});
    app.selectedServerId.set('elsewhere');const select=spyOn(app,'selectServer');const leave=spyOn(app,'leaveVoiceChannel');
    app.openActiveCallChat();expect(select).toHaveBeenCalledWith('group');expect(app.workspaceMode()).toBe('groups');expect(leave).not.toHaveBeenCalled();fixture.destroy();
  });
  it('selects a presentation locally and falls back when that screen ends',()=>{
    const fixture=TestBed.createComponent(AppComponent),app=fixture.componentInstance;
    spyOn(app,'activeCallSurface').and.returnValue({kind:'group',id:'group:v',channelId:'v',title:'Group',subtitle:'Group',participantCount:2,activeSpeakerLabel:null});
    const scene=signal<any>({stageTile:{id:'a',source:'screen-share'},secondaryTiles:[{id:'b',source:'screen-share'}],gridTiles:[]});
    spyOn(app,'voiceVideoSceneForChannel').and.callFake(()=>scene());
    app.conferenceScreenId.set('b');expect(app.activeCallVoiceVideoScene()?.stageTile?.id).toBe('b');
    scene.set({...scene(),secondaryTiles:[]});expect(app.activeCallVoiceVideoScene()?.stageTile?.id).toBe('a');fixture.destroy();
  });
  it('opens the existing direct conversation for the call peer',()=>{
    const fixture=TestBed.createComponent(AppComponent),app=fixture.componentInstance;
    spyOn(app,'activeCallSurface').and.returnValue({kind:'direct',id:'direct:peer',channelId:null,title:'Peer',subtitle:'Call',participantCount:2,activeSpeakerLabel:null});
    spyOn(app,'directCallPeer').and.returnValue({user_id:'peer',nick:'Peer',avatar_updated_at:null});
    spyOn(app,'findDirectConversationByUserId').and.returnValue({id:'direct-chat'} as any);
    const select=spyOn(app,'selectServer');const hangup=spyOn(app,'hangupDirectCall').and.resolveTo();
    app.openActiveCallChat();expect(select).toHaveBeenCalledWith('direct-chat');expect(app.workspaceMode()).toBe('chats');expect(hangup).not.toHaveBeenCalled();fixture.destroy();
  });
  it('toggles a voice roster without joining and preserves the mobile panel', async () => {
    const fixture = TestBed.createComponent(AppComponent), app = fixture.componentInstance;
    const select = spyOn(app, 'selectChannel').and.resolveTo();
    const channel = {id: 'voice-test', type: 'voice', name: 'Таверна'} as any;
    await app.togglePlatformVoiceRoom(channel);
    expect(app.expandedPlatformRosters().has(channel.id)).toBeTrue();
    expect(select).toHaveBeenCalledWith(channel, {connectVoice: false, preserveMobilePanel: true});
    app.selectedChannelId.set(channel.id);
    select.calls.reset();
    await app.togglePlatformVoiceRoom(channel);
    expect(app.expandedPlatformRosters().has(channel.id)).toBeFalse();
    expect(select).not.toHaveBeenCalled();
    fixture.destroy();
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
