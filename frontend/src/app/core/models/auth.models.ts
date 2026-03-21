export interface AuthLoginRequest {
  login: string;
  password: string;
}

export interface AuthRegisterRequest {
  login: string;
  password: string;
  full_name: string;
  nick: string;
  character_name: string;
}

export interface AuthUser {
  id: string;
  login: string;
  full_name: string;
  nick: string;
  character_name: string | null;
  avatar_updated_at: string | null;
  is_admin: boolean;
  created_at: string;
}

export interface AuthSessionResponse {
  access_token: string;
  token_type: 'bearer';
  user: AuthUser;
}
