export interface FriendRequestUser {
  user_id: string;
  public_id: number;
  login: string;
  nick: string;
  avatar_updated_at: string | null;
  is_online: boolean;
}

export interface FriendRequestSummary {
  id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'blocked' | 'cancelled';
  direction: 'incoming' | 'outgoing';
  created_at: string;
  responded_at: string | null;
  user: FriendRequestUser;
}

export interface FriendRequestsOverview {
  incoming: FriendRequestSummary[];
  outgoing: FriendRequestSummary[];
}

export interface CreateFriendRequestRequest {
  user_id?: string | null;
  user_public_id?: number | null;
}
