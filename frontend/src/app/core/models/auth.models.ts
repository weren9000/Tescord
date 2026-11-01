export interface AuthLoginRequest {
  auth_protocol?: number;
  email: string;
  password: string;
}

export interface AuthRegisterRequest {
  registration_token?: string;
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

export interface AuthChallenge {
  challenge_token: string;
  expires_in: number;
  resend_after?: number;
}

export interface TwoFactorChallenge extends AuthChallenge {
  status: 'two_factor_required';
}

export interface EmailVerification {
  registration_token: string;
  email: string;
}

export interface AccountSecurity {
  email_verified: boolean;
  two_factor_enabled: boolean;
  setup_available: boolean;
  recovery_codes_remaining: number;
}

export interface TotpSetup extends AuthChallenge {
  secret: string;
  qr_data_url: string;
}
