import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { AppComponent } from './app.component';
import { AuthApiService } from './core/api/auth-api.service';
import { SystemApiService } from './core/api/system-api.service';
import { WorkspaceApiService, WorkspaceMessageUploadEvent } from './core/api/workspace-api.service';
import { DirectCallService } from './core/services/direct-call.service';
import { VoiceRoomService } from './core/services/voice-room.service';
import { ConversationSummary } from './core/models/conversation.models';
import { CurrentUserResponse, WorkspaceMessage, WorkspaceMessageAttachment } from './core/models/workspace.models';

const reader: CurrentUserResponse = {
  id: 'reader', public_id: 1, email: 'reader@example.test', nick: 'Reader',
  avatar_updated_at: null, is_admin: false, created_at: '2026-10-29T00:00:00Z',
};
const conversation: ConversationSummary = {
  id: 'chat', kind: 'direct', title: 'Chat', subtitle: null,
  icon_asset: null, icon_updated_at: null, member_role: 'member',
  primary_channel_id: 'channel', unread_count: 0, mention_unread_count: 0,
  first_unread_message_id: null, first_mention_unread_message_id: null,
  push_enabled: false, members: [],
};
function incomingMessage(id: string): WorkspaceMessage {
  return {
    id, channel_id: 'channel', type: 'text', content: '@Reader привет',
    created_at: '2026-10-29T00:00:00Z', edited_at: null,
    author: {id: 'sender', public_id: 2, login: 'sender', nick: 'Sender', avatar_updated_at: null},
    reply_to: null, attachments: [], reactions: [], read_by: [], mentioned_user_ids: ['reader'],
  };
}

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

  it('updates unread state from incoming messages and clears it by channel on a read event', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.currentUser.set(reader);
    app.conversations.set([{...conversation}]);
    for (const id of ['first', 'second']) {
      app['handleMessageCreatedEvent']({type: 'message_created', server_id: 'chat', message: incomingMessage(id)});
    }
    expect(app.conversations()[0]).toEqual(jasmine.objectContaining({
      unread_count: 2, mention_unread_count: 2,
      first_unread_message_id: 'first', first_mention_unread_message_id: 'first',
    }));
    app['handleMessageReadUpdatedEvent']({
      type: 'message_read_updated', server_id: 'chat', channel_id: 'channel',
      state: {
        channel_id: 'channel', user_id: reader.id, last_read_message_id: 'second',
        last_read_at: '2026-10-29T00:01:00Z', nick: reader.nick, public_id: reader.public_id,
        avatar_updated_at: null,
      },
    });
    expect(app.conversations()[0]).toEqual(jasmine.objectContaining({
      unread_count: 0, mention_unread_count: 0,
      first_unread_message_id: null, first_mention_unread_message_id: null,
    }));
    fixture.destroy();
  });

  it('updates platform and channel counters together for a message in another channel', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.currentUser.set(reader);
    app.workspaceMode.set('platforms');
    app.servers.set([{
      id: 'platform', kind: 'workspace', name: 'Platform', slug: 'platform', description: null,
      icon_asset: null, icon_updated_at: null, member_role: 'member', unread_count: 0, mention_unread_count: 0,
    }]);
    app.channels.set([{
      id: 'channel', server_id: 'platform', name: 'Chat', topic: null, type: 'text', position: 0,
      voice_access_role: null, unread_count: 0, mention_unread_count: 0,
      first_unread_message_id: null, first_mention_unread_message_id: null,
    }]);
    app.selectedServerId.set('platform');
    app['handleMessageCreatedEvent']({type: 'message_created', server_id: 'platform', message: incomingMessage('first')});
    expect(app.servers()[0].unread_count).toBe(1);
    expect(app.servers()[0].mention_unread_count).toBe(1);
    expect(app.channels()[0].unread_count).toBe(1);
    expect(app.channels()[0].mention_unread_count).toBe(1);
    expect(app.channels()[0].first_unread_message_id).toBe('first');
    fixture.destroy();
  });

  it('refreshes rendered mentions when the current membership snapshot changes', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const message = incomingMessage('first');
    app.members.set([{
      id: 'membership', user_id: reader.id, public_id: reader.public_id,
      login: 'reader', nick: reader.nick, avatar_updated_at: null, role: 'member', is_online: true,
    }]);
    const initial = app.messageTextModel(message);
    expect(initial[0].mentionUserId).toBe(reader.id);
    app.members.set([]);
    const changed = app.messageTextModel(message);
    expect(changed).not.toBe(initial);
    expect(changed.every(segment => segment.mentionUserId === null)).toBeTrue();
    fixture.destroy();
  });

  it('cancels an upload on workspace reset without applying a late failure to the new draft', () => {
    const api = TestBed.inject(WorkspaceApiService);
    const request = new Subject<WorkspaceMessageUploadEvent>();
    api.sendMessage = jasmine.createSpy('sendMessage').and.returnValue(request);
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.session.set({access_token: 'test-token', token_type: 'bearer', user: reader});
    app.selectedChannelId.set('channel');
    spyOn(app, 'canSendMessage').and.returnValue(true);
    spyOn(app, 'activeMessagingChannel').and.returnValue({
      id: 'channel', server_id: 'chat', name: 'Chat', topic: null, type: 'text', position: 0,
      voice_access_role: null, unread_count: 0, mention_unread_count: 0,
      first_unread_message_id: null, first_mention_unread_message_id: null,
    });
    app.messageDraft.set('old draft');
    app.pendingFiles.set([new File(['image'], 'image.png')]);
    app.submitMessage();
    expect(app.messageSubmitting()).toBeTrue();
    app['resetTextChannelState']();
    expect(request.observed).toBeFalse();
    app.selectedChannelId.set('other-channel');
    app.messageDraft.set('new draft');
    request.error(new Error('late upload failure'));
    expect(app.messageError()).toBeNull();
    expect(app.messageDraft()).toBe('new draft');
    expect(app.messageSubmitting()).toBeFalse();
    expect(app.messageUploadProgress()).toBeNull();
    fixture.destroy();
  });

  it('marks a gone preview as deleted and prevents it from being requested again', () => {
    const api = TestBed.inject(WorkspaceApiService);
    const request = new Subject<Blob>();
    api.downloadAttachment = jasmine.createSpy('downloadAttachment').and.returnValue(request);
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const attachment: WorkspaceMessageAttachment = {
      id: 'image', filename: 'image.png', mime_type: 'image/png', size_bytes: 10,
      created_at: '2026-10-29T00:00:00Z', deleted_at: null,
    };
    app.session.set({access_token: 'test-token', token_type: 'bearer', user: reader});
    app.messages.set([{...incomingMessage('first'), attachments: [attachment]}]);
    app.openImageAttachment(attachment);
    expect(app.isAttachmentPreviewLoading(attachment)).toBeTrue();
    request.error(new HttpErrorResponse({status: 410}));
    const deleted = app.messages()[0].attachments[0];
    expect(deleted.deleted_at).not.toBeNull();
    expect(app.messageError()).toBe('Файл удален');
    expect(app.isAttachmentPreviewLoading(attachment)).toBeFalse();
    app.openImageAttachment(deleted);
    expect(api.downloadAttachment).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

});
