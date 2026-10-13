import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { API_BASE_URL } from './api-base';

export interface InviteSummary {
  id: string; created_by: string; created_at: string; expires_at: string | null;
  max_uses: number | null; uses: number; state: 'active' | 'expired' | 'revoked' | 'exhausted';
}
export interface InvitePreview {
  server_id: string; name: string; kind: 'workspace' | 'group_chat';
  icon_asset: string | null; icon_updated_at: string | null;
}
@Injectable({providedIn: 'root'})
export class InvitesApiService {
  private readonly http = inject(HttpClient);
  private headers(token: string) { return {headers: new HttpHeaders({Authorization: `Bearer ${token}`})}; }
  preview(code: string) { return this.http.get<InvitePreview>(`${API_BASE_URL}/api/invites/${encodeURIComponent(code)}`); }
  join(token: string, code: string) {
    return this.http.post<{server_id: string; channel_id: string; kind: string; joined: boolean}>(`${API_BASE_URL}/api/invites/${encodeURIComponent(code)}/join`, {}, this.headers(token));
  }
  list(token: string, serverId: string) {
    return this.http.get<InviteSummary[]>(`${API_BASE_URL}/api/servers/${serverId}/invites`, this.headers(token));
  }
  create(token: string, serverId: string, expires_in_days: number | null, max_uses: number | null) {
    return this.http.post<InviteSummary & {token: string}>(`${API_BASE_URL}/api/servers/${serverId}/invites`, {expires_in_days, max_uses}, this.headers(token));
  }
  revoke(token: string, serverId: string, id: string) {
    return this.http.delete<void>(`${API_BASE_URL}/api/servers/${serverId}/invites/${id}`, this.headers(token));
  }
}
