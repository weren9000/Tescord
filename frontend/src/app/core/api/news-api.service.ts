import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { API_BASE_URL } from './api-base';

export interface NewsPost {
  id: string;
  title: string;
  excerpt: string;
  body?: string;
  published_at: string | null;
  image_url: string | null;
}
export interface AdminNewsPost extends NewsPost {
  body: string;
  published: boolean;
  version: number;
  has_image: boolean;
  created_at: string;
  updated_at: string;
}
export interface NewsPage<T = NewsPost> {
  items: T[];
  page: number;
  pages: number;
  total: number;
}

export function newsDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(
        new Date(value),
      )
    : '';
}

@Injectable({ providedIn: 'root' })
export class NewsApiService {
  private readonly http = inject(HttpClient);
  list(page = 1, size = 12) {
    return this.http.get<NewsPage>(`${API_BASE_URL}/api/news`, { params: { page, size } });
  }
  detail(id: string) {
    return this.http.get<NewsPost>(`${API_BASE_URL}/api/news/${encodeURIComponent(id)}`);
  }
  imageUrl(path: string): string {
    return API_BASE_URL + path;
  }
  adminList(token: string, page = 1) {
    return this.http.get<NewsPage<AdminNewsPost>>(`${API_BASE_URL}/api/admin/news`, {
      params: { page },
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  save(token: string, id: string | null, payload: FormData) {
    const url = `${API_BASE_URL}/api/admin/news${id ? '/' + id : ''}`;
    const options = { headers: { Authorization: `Bearer ${token}` } };
    return id
      ? this.http.put<AdminNewsPost>(url, payload, options)
      : this.http.post<AdminNewsPost>(url, payload, options);
  }
  adminImage(token: string, id: string) {
    return this.http.get(`${API_BASE_URL}/api/admin/news/${id}/image`, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'blob',
    });
  }
}
