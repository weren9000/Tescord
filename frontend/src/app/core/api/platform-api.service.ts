import {HttpClient, HttpHeaders} from '@angular/common/http';
import {Injectable, inject, signal} from '@angular/core';
import {Observable, firstValueFrom} from 'rxjs';
import {API_BASE_URL} from './api-base';

export interface PlatformSummary {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  icon_url?: string | null;
  member_role: 'owner' | 'admin' | 'member';
  notifications_enabled: boolean;
}
export interface PlatformMember {
  user_id: string;
  nick: string;
  public_id: number;
  avatar_updated_at?: string | null;
  role: 'owner' | 'admin' | 'member';
}
@Injectable({providedIn: 'root'})
export class PlatformApiService {
  private readonly http = inject(HttpClient);
  readonly loading = signal(false);
  readonly platforms = signal<PlatformSummary[]>([]);
  private generation = 0;
  private sessionToken: string | null = null;
  clear(): void {
    this.generation++;
    this.loading.set(false);
    this.sessionToken = null;
    this.platforms.set([]);
  }
  request<T>(token: string, method: string, path = '', body?: unknown): Observable<T> {
    return this.http.request<T>(method, `${API_BASE_URL}/api/platforms${path}`, {
      body, headers: new HttpHeaders({Authorization: `Bearer ${token}`}),
    });
  }
  async refresh(token: string): Promise<void> {
    if (token !== this.sessionToken) {
      this.platforms.set([]);
      this.sessionToken = token;
    }
    const generation = ++this.generation;
    this.loading.set(true);
    try {
      const platforms = await firstValueFrom(this.request<PlatformSummary[]>(token, 'GET'));
      if (generation === this.generation) this.platforms.set(platforms);
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }
}
