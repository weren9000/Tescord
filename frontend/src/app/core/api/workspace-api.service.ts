import { HttpClient, HttpEventType, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, filter, map } from 'rxjs';

import { API_BASE_URL } from './api-base';
import {
  ConversationDirectoryUser,
  ConversationSummary,
  CreateDirectConversationRequest,
  CreateGroupConversationRequest,
} from '../models/conversation.models';
import {
  BlockedFriendSummary,
  CreateFriendRequestRequest,
  FriendRequestsOverview,
  FriendRequestSummary,
} from '../models/friend.models';
import {
  AddWorkspaceMemberRequest,
  BlockedServerSummary,
  CreateWorkspaceChannelRequest,
  CreateWorkspaceServerRequest,
  CurrentUserResponse,
  LeaveWorkspaceServerRequest,
  VoiceAdminChannel,
  VoiceAdminUser,
  VoiceChannelAccessEntry,
  VoiceJoinRequestCreateResponse,
  VoiceJoinRequestSummary,
  WorkspaceChannel,
  WorkspaceAttachmentDownloadLink,
  WorkspaceChatAttachmentSummary,
  WorkspaceMessage,
  WorkspaceChannelReadState,
  WorkspaceMessageReactionCode,
  WorkspaceMessageReactionsSnapshot,
  WorkspaceMessagePage,
  WorkspaceMember,
  WorkspaceServer,
  WorkspaceVoicePresenceChannel
} from '../models/workspace.models';
import {
  ConversationPushSettingRequest,
  ConversationPushSettingSummary,
  PushConfigResponse,
  PushSubscriptionUpsertRequest,
} from '../models/push.models';

@Injectable({
  providedIn: 'root'
})
export class WorkspaceApiService {
  private readonly http = inject(HttpClient);

  getCurrentUser(token: string): Observable<CurrentUserResponse> {
    return this.http.get<CurrentUserResponse>(`${API_BASE_URL}/api/me`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  updateCurrentUserProfile(
    token: string,
    payload: {
      avatarFile?: File | null;
      removeAvatar?: boolean;
    }
  ): Observable<CurrentUserResponse> {
    const formData = new FormData();
    formData.append('remove_avatar', payload.removeAvatar === true ? 'true' : 'false');
    if (payload.avatarFile) {
      formData.append('avatar', payload.avatarFile, payload.avatarFile.name);
    }

    return this.http.put<CurrentUserResponse>(`${API_BASE_URL}/api/me/profile`, formData, {
      headers: this.buildAuthHeaders(token)
    });
  }

  getServers(token: string): Observable<WorkspaceServer[]> {
    return this.http.get<WorkspaceServer[]>(`${API_BASE_URL}/api/servers`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  getConversations(token: string): Observable<ConversationSummary[]> {
    return this.http.get<ConversationSummary[]>(`${API_BASE_URL}/api/conversations`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  getPushConfig(token: string): Observable<PushConfigResponse> {
    return this.http.get<PushConfigResponse>(`${API_BASE_URL}/api/push/config`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  registerPushSubscription(token: string, payload: PushSubscriptionUpsertRequest): Observable<void> {
    return this.http.post<void>(`${API_BASE_URL}/api/push/subscriptions`, payload, {
      headers: this.buildAuthHeaders(token)
    });
  }

  updateConversationPushSetting(
    token: string,
    conversationId: string,
    payload: ConversationPushSettingRequest
  ): Observable<ConversationPushSettingSummary> {
    return this.http.put<ConversationPushSettingSummary>(
      `${API_BASE_URL}/api/push/conversations/${conversationId}/setting`,
      payload,
      {
        headers: this.buildAuthHeaders(token)
      }
    );
  }

  getConversationDirectory(token: string): Observable<ConversationDirectoryUser[]> {
    return this.http.get<ConversationDirectoryUser[]>(`${API_BASE_URL}/api/conversations/directory`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  openDirectConversation(token: string, payload: CreateDirectConversationRequest): Observable<ConversationSummary> {
    return this.http.post<ConversationSummary>(
      `${API_BASE_URL}/api/conversations/direct`,
      payload,
      {
        headers: this.buildAuthHeaders(token)
      }
    );
  }

  createGroupConversation(
    token: string,
    payload: CreateGroupConversationRequest
  ): Observable<ConversationSummary> {
    return this.http.post<ConversationSummary>(`${API_BASE_URL}/api/conversations/group`, payload, {
      headers: this.buildAuthHeaders(token)
    });
  }

  getChannels(token: string, serverId: string): Observable<WorkspaceChannel[]> {
    return this.http.get<WorkspaceChannel[]>(`${API_BASE_URL}/api/servers/${serverId}/channels`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  getMembers(token: string, serverId: string): Observable<WorkspaceMember[]> {
    return this.http.get<WorkspaceMember[]>(`${API_BASE_URL}/api/servers/${serverId}/members`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  addServerMember(token: string, serverId: string, payload: AddWorkspaceMemberRequest): Observable<WorkspaceMember> {
    return this.http.post<WorkspaceMember>(
      `${API_BASE_URL}/api/servers/${serverId}/members`,
      payload,
      {
        headers: this.buildAuthHeaders(token)
      }
    );
  }

  removeServerMember(token: string, serverId: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/api/servers/${serverId}/members/${userId}`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  getBlockedServers(token: string): Observable<BlockedServerSummary[]> {
    return this.http.get<BlockedServerSummary[]>(`${API_BASE_URL}/api/servers/blocked`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  leaveServer(token: string, serverId: string, payload: LeaveWorkspaceServerRequest): Observable<void> {
    return this.http.post<void>(`${API_BASE_URL}/api/servers/${serverId}/leave`, payload, {
      headers: this.buildAuthHeaders(token)
    });
  }

  blockServer(token: string, serverId: string, payload: LeaveWorkspaceServerRequest): Observable<void> {
    return this.http.post<void>(`${API_BASE_URL}/api/servers/${serverId}/block`, payload, {
      headers: this.buildAuthHeaders(token)
    });
  }

  unblockServer(token: string, serverId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/api/servers/blocked/${serverId}`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  getFriendRequests(token: string): Observable<FriendRequestsOverview> {
    return this.http.get<FriendRequestsOverview>(`${API_BASE_URL}/api/friends/requests`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  createFriendRequest(token: string, payload: CreateFriendRequestRequest): Observable<FriendRequestSummary> {
    return this.http.post<FriendRequestSummary>(`${API_BASE_URL}/api/friends/requests`, payload, {
      headers: this.buildAuthHeaders(token)
    });
  }

  acceptFriendRequest(token: string, requestId: string): Observable<FriendRequestSummary> {
    return this.http.post<FriendRequestSummary>(`${API_BASE_URL}/api/friends/requests/${requestId}/accept`, null, {
      headers: this.buildAuthHeaders(token)
    });
  }

  rejectFriendRequest(token: string, requestId: string): Observable<FriendRequestSummary> {
    return this.http.post<FriendRequestSummary>(`${API_BASE_URL}/api/friends/requests/${requestId}/reject`, null, {
      headers: this.buildAuthHeaders(token)
    });
  }

  blockFriendRequest(token: string, requestId: string): Observable<FriendRequestSummary> {
    return this.http.post<FriendRequestSummary>(`${API_BASE_URL}/api/friends/requests/${requestId}/block`, null, {
      headers: this.buildAuthHeaders(token)
    });
  }

  getBlockedFriends(token: string): Observable<BlockedFriendSummary[]> {
    return this.http.get<BlockedFriendSummary[]>(`${API_BASE_URL}/api/friends/blocked`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  removeFriend(token: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/api/friends/${userId}`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  blockFriend(token: string, userId: string): Observable<void> {
    return this.http.post<void>(`${API_BASE_URL}/api/friends/${userId}/block`, null, {
      headers: this.buildAuthHeaders(token)
    });
  }

  unblockFriend(token: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/api/friends/blocked/${userId}`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  getVoicePresence(token: string, serverId: string): Observable<WorkspaceVoicePresenceChannel[]> {
    return this.http.get<WorkspaceVoicePresenceChannel[]>(`${API_BASE_URL}/api/servers/${serverId}/voice-presence`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  getVoiceAdminChannels(token: string): Observable<VoiceAdminChannel[]> {
    return this.http.get<VoiceAdminChannel[]>(`${API_BASE_URL}/api/voice/admin/channels`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  getVoiceAdminUsers(token: string): Observable<VoiceAdminUser[]> {
    return this.http.get<VoiceAdminUser[]>(`${API_BASE_URL}/api/voice/admin/users`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  getVoiceChannelAccess(token: string, channelId: string): Observable<VoiceChannelAccessEntry[]> {
    return this.http.get<VoiceChannelAccessEntry[]>(`${API_BASE_URL}/api/voice/channels/${channelId}/access`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  updateVoiceChannelAccess(
    token: string,
    channelId: string,
    userId: string,
    role: 'owner' | 'resident' | 'guest' | 'stranger' | null
  ): Observable<VoiceChannelAccessEntry[]> {
    return this.http.put<VoiceChannelAccessEntry[]>(
      `${API_BASE_URL}/api/voice/channels/${channelId}/access/${userId}`,
      { role },
      {
        headers: this.buildAuthHeaders(token)
      }
    );
  }

  requestVoiceJoin(token: string, channelId: string): Observable<VoiceJoinRequestCreateResponse> {
    return this.http.post<VoiceJoinRequestCreateResponse>(
      `${API_BASE_URL}/api/voice/channels/${channelId}/requests`,
      null,
      {
        headers: this.buildAuthHeaders(token)
      }
    );
  }

  getVoiceJoinRequest(token: string, requestId: string): Observable<VoiceJoinRequestSummary> {
    return this.http.get<VoiceJoinRequestSummary>(`${API_BASE_URL}/api/voice/requests/${requestId}`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  getVoiceJoinInbox(token: string): Observable<VoiceJoinRequestSummary[]> {
    return this.http.get<VoiceJoinRequestSummary[]>(`${API_BASE_URL}/api/voice/requests/inbox`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  resolveVoiceJoinRequest(
    token: string,
    requestId: string,
    action: 'allow' | 'resident' | 'reject'
  ): Observable<VoiceJoinRequestSummary> {
    return this.http.post<VoiceJoinRequestSummary>(
      `${API_BASE_URL}/api/voice/requests/${requestId}/resolve`,
      { action },
      {
        headers: this.buildAuthHeaders(token)
      }
    );
  }

  kickVoiceParticipant(token: string, channelId: string, userId: string): Observable<VoiceChannelAccessEntry[]> {
    return this.http.post<VoiceChannelAccessEntry[]>(
      `${API_BASE_URL}/api/voice/channels/${channelId}/participants/${userId}/kick`,
      null,
      {
        headers: this.buildAuthHeaders(token)
      }
    );
  }

  updateVoiceParticipantOwnerMute(
    token: string,
    channelId: string,
    userId: string,
    ownerMuted: boolean
  ): Observable<VoiceChannelAccessEntry[]> {
    return this.http.put<VoiceChannelAccessEntry[]>(
      `${API_BASE_URL}/api/voice/channels/${channelId}/participants/${userId}/owner-mute`,
      { owner_muted: ownerMuted },
      {
        headers: this.buildAuthHeaders(token)
      }
    );
  }

  sendPresenceHeartbeat(token: string): Observable<void> {
    return this.http.post<void>(`${API_BASE_URL}/api/presence/heartbeat`, null, {
      headers: this.buildAuthHeaders(token)
    });
  }

  createServer(token: string, payload: CreateWorkspaceServerRequest): Observable<WorkspaceServer> {
    return this.http.post<WorkspaceServer>(`${API_BASE_URL}/api/servers`, payload, {
      headers: this.buildAuthHeaders(token)
    });
  }

  updateServerIcon(token: string, serverId: string, iconAsset: string | null): Observable<WorkspaceServer> {
    return this.http.patch<WorkspaceServer>(
      `${API_BASE_URL}/api/servers/${serverId}/icon`,
      { icon_asset: iconAsset },
      {
        headers: this.buildAuthHeaders(token)
      }
    );
  }

  uploadServerIcon(token: string, serverId: string, iconFile: File): Observable<WorkspaceServer> {
    const formData = new FormData();
    formData.append('icon', iconFile, iconFile.name);

    return this.http.put<WorkspaceServer>(`${API_BASE_URL}/api/servers/${serverId}/icon-file`, formData, {
      headers: this.buildAuthHeaders(token)
    });
  }

  createChannel(token: string, serverId: string, payload: CreateWorkspaceChannelRequest): Observable<WorkspaceChannel> {
    return this.http.post<WorkspaceChannel>(`${API_BASE_URL}/api/servers/${serverId}/channels`, payload, {
      headers: this.buildAuthHeaders(token)
    });
  }

  deleteChannel(token: string, serverId: string, channelId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/api/servers/${serverId}/channels/${channelId}`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  getMessages(token: string, channelId: string, limit: number, before?: string | null): Observable<WorkspaceMessagePage> {
    let params = new HttpParams().set('limit', limit);
    if (before) {
      params = params.set('before', before);
    }

    return this.http.get<WorkspaceMessagePage>(`${API_BASE_URL}/api/channels/${channelId}/messages`, {
      headers: this.buildAuthHeaders(token),
      params
    });
  }

  sendMessage(
    token: string,
    channelId: string,
    payload: {
      content: string;
      files: File[];
      replyToMessageId?: string | null;
    }
  ): Observable<WorkspaceMessageUploadEvent> {
    const formData = new FormData();
    formData.append('content', payload.content);
    if (payload.replyToMessageId) {
      formData.append('reply_to_message_id', payload.replyToMessageId);
    }
    for (const file of payload.files) {
      formData.append('files', file, file.name);
    }

    return this.http.post<WorkspaceMessage>(`${API_BASE_URL}/api/channels/${channelId}/messages`, formData, {
      headers: this.buildAuthHeaders(token),
      observe: 'events',
      reportProgress: true
    }).pipe(
      map((event): WorkspaceMessageUploadEvent | null => {
        if (event.type === HttpEventType.UploadProgress) {
          const total = event.total ?? null;
          return {
            kind: 'progress',
            loaded: event.loaded,
            total,
            percent: total && total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : null
          };
        }

        if (event.type === HttpEventType.Response && event.body) {
          return {
            kind: 'response',
            message: event.body
          };
        }

        return null;
      }),
      filter((event): event is WorkspaceMessageUploadEvent => event !== null)
    );
  }

  markChannelRead(token: string, channelId: string, lastMessageId?: string | null): Observable<WorkspaceChannelReadState> {
    return this.http.post<WorkspaceChannelReadState>(
      `${API_BASE_URL}/api/channels/${channelId}/read`,
      { last_message_id: lastMessageId ?? null },
      {
        headers: this.buildAuthHeaders(token)
      }
    );
  }

  addMessageReaction(
    token: string,
    messageId: string,
    reactionCode: WorkspaceMessageReactionCode
  ): Observable<WorkspaceMessageReactionsSnapshot> {
    return this.http.put<WorkspaceMessageReactionsSnapshot>(
      `${API_BASE_URL}/api/messages/${messageId}/reactions/${reactionCode}`,
      null,
      {
        headers: this.buildAuthHeaders(token)
      }
    );
  }

  removeMessageReaction(
    token: string,
    messageId: string,
    reactionCode: WorkspaceMessageReactionCode
  ): Observable<WorkspaceMessageReactionsSnapshot> {
    return this.http.delete<WorkspaceMessageReactionsSnapshot>(
      `${API_BASE_URL}/api/messages/${messageId}/reactions/${reactionCode}`,
      {
        headers: this.buildAuthHeaders(token)
      }
    );
  }

  createAttachmentDownloadLink(token: string, attachmentId: string): Observable<WorkspaceAttachmentDownloadLink> {
    return this.http.post<WorkspaceAttachmentDownloadLink>(
      `${API_BASE_URL}/api/attachments/${attachmentId}/download-link`,
      null,
      {
        headers: this.buildAuthHeaders(token)
      }
    );
  }

  downloadAttachment(token: string, attachmentId: string): Observable<Blob> {
    return this.http.get(`${API_BASE_URL}/api/attachments/${attachmentId}`, {
      headers: this.buildAuthHeaders(token),
      responseType: 'blob'
    });
  }

  getChannelAttachments(token: string, channelId: string): Observable<WorkspaceChatAttachmentSummary[]> {
    return this.http.get<WorkspaceChatAttachmentSummary[]>(`${API_BASE_URL}/api/channels/${channelId}/attachments`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  deleteAttachment(token: string, attachmentId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/api/attachments/${attachmentId}`, {
      headers: this.buildAuthHeaders(token)
    });
  }

  private buildAuthHeaders(token: string): HttpHeaders {
    return new HttpHeaders({
      Authorization: `Bearer ${token}`
    });
  }
}

export interface WorkspaceMessageUploadProgressEvent {
  kind: 'progress';
  loaded: number;
  total: number | null;
  percent: number | null;
}

export interface WorkspaceMessageUploadResponseEvent {
  kind: 'response';
  message: WorkspaceMessage;
}

export type WorkspaceMessageUploadEvent =
  | WorkspaceMessageUploadProgressEvent
  | WorkspaceMessageUploadResponseEvent;
