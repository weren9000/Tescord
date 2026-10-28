export interface MessageContentSegment {
  text: string;
  mentionUserId: string | null;
}

export interface TextHighlightChunk {
  text: string;
  highlighted: boolean;
}

export interface MessageLink {
  text: string;
  url: string | null;
}

export interface RenderedMessageSegment extends MessageContentSegment {
  chunks: (TextHighlightChunk & {links: MessageLink[]})[];
}

/** Only the identity fields needed to resolve mentions in the current chat. */
export interface MessageMentionMember {
  user_id: string;
  public_id: number;
  nick: string;
}

export interface MessageMentionContext {
  members: readonly MessageMentionMember[];
  conversation?: readonly MessageMentionMember[];
}
