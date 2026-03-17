import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from './api-base';
import {
  CreateWorkspaceChannelRequest,
  CreateWorkspaceServerRequest,
  CurrentUserResponse,
  WorkspaceChannel,
  WorkspaceMember,
  WorkspaceServer
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

  private buildAuthHeaders(token: string): HttpHeaders {
    return new HttpHeaders({
      Authorization: `Bearer ${token}`
    });
  }
}
