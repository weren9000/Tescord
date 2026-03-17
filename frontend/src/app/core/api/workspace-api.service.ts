import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from './api-base';
import {
  CreateWorkspaceChannelRequest,
  CreateWorkspaceServerRequest,
  CurrentUserResponse,
  WorkspaceChannel,
  WorkspaceMessage,
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

  createChannel(token: string, serverId: string, payload: CreateWorkspaceChannelRequest): Observable<WorkspaceChannel> {
    return this.http.post<WorkspaceChannel>(`${API_BASE_URL}/api/servers/${serverId}/channels`, payload, {
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
