import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_BASE_URL } from './api-base';
import {
  AuthLoginRequest,
  AuthRegisterRequest,
  AuthSessionResponse,
  TwoFactorChallenge,
  AuthChallenge,
  EmailVerification,
} from '../models/auth.models';

@Injectable({
  providedIn: 'root',
})
export class AuthApiService {
  private readonly http = inject(HttpClient);

  login(payload: AuthLoginRequest): Observable<AuthSessionResponse | TwoFactorChallenge> {
    return this.http.post<AuthSessionResponse | TwoFactorChallenge>(
      `${API_BASE_URL}/api/auth/login`,
      { ...payload, auth_protocol: 2 },
    );
  }

  register(payload: AuthRegisterRequest): Observable<AuthSessionResponse> {
    return this.http.post<AuthSessionResponse>(`${API_BASE_URL}/api/auth/register`, payload);
  }

  startEmail(email: string, challenge_token?: string): Observable<AuthChallenge> {
    return this.http.post<AuthChallenge>(`${API_BASE_URL}/api/auth/email/start`, {
      email,
      challenge_token,
    });
  }

  verifyEmail(challenge_token: string, code: string): Observable<EmailVerification> {
    return this.http.post<EmailVerification>(`${API_BASE_URL}/api/auth/email/verify`, {
      challenge_token,
      code,
    });
  }

  verifyLogin(challenge_token: string, code: string): Observable<AuthSessionResponse> {
    return this.http.post<AuthSessionResponse>(`${API_BASE_URL}/api/auth/login/verify`, {
      challenge_token,
      code,
    });
  }
}
