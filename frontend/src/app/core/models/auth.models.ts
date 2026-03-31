export interface AuthLoginRequest {
  email: string;
  password: string;
}

export interface AuthRegisterRequest {
  email: string;
  password: string;
  password_confirmation: string;
  nick: string;
}

export interface AuthUser {
  id: string;
  public_id: number;
  email: string;
  nick: string;
  avatar_updated_at: string | null;
  is_admin: boolean;
  created_at: string;
}

export interface AuthSessionResponse {
  access_token: string;
  token_type: 'bearer';
  user: AuthUser;
}
