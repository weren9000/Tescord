import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from './api-base';
import {
  CreateWorkspaceChannelRequest,
  CreateWorkspaceServerRequest,
  CurrentUserResponse,
  VoiceAdminChannel,
  VoiceAdminUser,
  VoiceChannelAccessEntry,
  VoiceJoinRequestCreateResponse,
  VoiceJoinRequestSummary,
  WorkspaceChannel,
  WorkspaceMessage,
  WorkspaceMessageReactionCode,
  WorkspaceMessageReactionsSnapshot,
  WorkspaceMessagePage,
  WorkspaceMember,
  WorkspaceServer,
  WorkspaceVoicePresenceChannel
} from '../models/workspace.models';

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
      characterName: string;
      avatarFile?: File | null;
      removeAvatar?: boolean;
    }
  ): Observable<CurrentUserResponse> {
    const formData = new FormData();
    formData.append('character_name', payload.characterName);
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
    role: 'owner' | 'resident' | 'stranger' | null
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
    }
  ): Observable<WorkspaceMessage> {
    const formData = new FormData();
    formData.append('content', payload.content);
    for (const file of payload.files) {
      formData.append('files', file, file.name);
    }

    return this.http.post<WorkspaceMessage>(`${API_BASE_URL}/api/channels/${channelId}/messages`, formData, {
      headers: this.buildAuthHeaders(token)
    });
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

  downloadAttachment(token: string, attachmentId: string): Observable<Blob> {
    return this.http.get(`${API_BASE_URL}/api/attachments/${attachmentId}`, {
      headers: this.buildAuthHeaders(token),
      responseType: 'blob'
    });
  }

  private buildAuthHeaders(token: string): HttpHeaders {
    return new HttpHeaders({
      Authorization: `Bearer ${token}`
    });
  }
}
