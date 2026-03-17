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
  is_online: boolean;
}

export interface WorkspaceVoicePresenceParticipant {
  participant_id: string;
  user_id: string;
  nick: string;
  full_name: string;
  muted: boolean;
}

export interface WorkspaceVoicePresenceChannel {
  channel_id: string;
  channel_name: string;
  participants: WorkspaceVoicePresenceParticipant[];
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

export interface WorkspaceMessageAuthor {
  id: string;
  login: string;
  nick: string;
  full_name: string;
  character_name: string | null;
}

export interface WorkspaceMessageAttachment {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface WorkspaceMessage {
  id: string;
  channel_id: string;
  type: 'text' | 'system';
  content: string;
  created_at: string;
  edited_at: string | null;
  author: WorkspaceMessageAuthor;
  attachments: WorkspaceMessageAttachment[];
}

export interface WorkspaceMessagePage {
  items: WorkspaceMessage[];
  has_more: boolean;
  next_before: string | null;
}
