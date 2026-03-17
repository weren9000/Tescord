export interface CurrentUserResponse {
  id: string;
  login: string;
  full_name: string;
  nick: string;
  character_name: string | null;
  is_admin: boolean;
  created_at: string;
}

export interface WorkspaceServer {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  member_role: string;
}

export interface WorkspaceChannel {
  id: string;
  server_id: string;
  name: string;
  topic: string | null;
  type: 'text' | 'voice' | 'announcement';
  position: number;
}

export interface WorkspaceMember {
  id: string;
  user_id: string;
  login: string;
  nick: string;
  full_name: string;
  character_name: string | null;
  role: string;
}

export interface CreateWorkspaceServerRequest {
  name: string;
  description: string | null;
}

export interface CreateWorkspaceChannelRequest {
  name: string;
  topic: string | null;
  type: 'text' | 'voice';
}
