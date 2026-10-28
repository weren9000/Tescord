import { WorkspaceMessage } from '../models/workspace.models';
import {
  MessageContentSegment,
  MessageLink,
  MessageMentionContext,
  RenderedMessageSegment,
  TextHighlightChunk,
} from '../models/message-text.models';
import { BoundedCache } from '../../shared/bounded-cache';
import { formatPublicUserId } from '../../shared/user-identity';
import { buildSearchTerms, buildTextHighlightChunks } from './text-search';

type MessageText = Pick<WorkspaceMessage, 'content' | 'mentioned_user_ids'>;

/** Per-workspace presentation cache. It owns no Angular state or network requests. */
export class MessageTextPresenter {
  private readonly viewCache = new WeakMap<
    MessageText,
    {
      query: string;
      source: MessageContentSegment[];
      value: RenderedMessageSegment[];
    }
  >();
  private readonly segmentCache = new WeakMap<
    MessageText,
    {
      content: string;
      mentions: string;
      context: MessageMentionContext;
      value: MessageContentSegment[];
    }
  >();
  private readonly linkCache = new BoundedCache<MessageLink[]>();
  private readonly highlightCache = new BoundedCache<TextHighlightChunk[]>();
  private readonly previewCache = new BoundedCache<string>();

  render(
    message: MessageText,
    query: string,
    context: MessageMentionContext,
  ): RenderedMessageSegment[] {
    const source = this.contentSegments(message, context);
    const cached = this.viewCache.get(message);
    if (cached && cached.query === query && cached.source === source) {
      return cached.value;
    }
    const value = source.map((segment) => ({
      ...segment,
      chunks: this.highlight(segment.text, query).map((chunk) => ({
        ...chunk,
        links: !segment.mentionUserId && !chunk.highlighted ? this.links(chunk.text) : [],
      })),
    }));
    this.viewCache.set(message, { query, source, value });
    return value;
  }

  highlight(text: string, query: string): TextHighlightChunk[] {
    return this.highlightCache.get(JSON.stringify([query, text]), () =>
      buildTextHighlightChunks(text, query),
    );
  }

  preview(content: string, query: string): string {
    return this.previewCache.get(JSON.stringify([content, query]), () =>
      this.buildSearchPreview(content, query),
    );
  }

  private links(text: string): MessageLink[] {
    return this.linkCache.get(text, () =>
      text
        .split(/(https?:\/\/[^\s<>]+)/g)
        .filter(Boolean)
        .flatMap((part) => {
          if (!/^https?:\/\//i.test(part)) {
            return [{ text: part, url: null }];
          }
          const clean = part.replace(/[.,!?]+$/, '');
          try {
            const url = new URL(clean);
            if (!['http:', 'https:'].includes(url.protocol)) {
              return [{ text: part, url: null }];
            }
            return [
              { text: clean, url: clean },
              ...(clean.length < part.length
                ? [{ text: part.slice(clean.length), url: null }]
                : []),
            ];
          } catch {
            return [{ text: part, url: null }];
          }
        }),
    );
  }

  private contentSegments(
    message: MessageText,
    context: MessageMentionContext,
  ): MessageContentSegment[] {
    const content = message.content ?? '';
    const mentions = message.mentioned_user_ids.join(',');
    const cached = this.segmentCache.get(message);
    if (
      cached &&
      cached.content === content &&
      cached.mentions === mentions &&
      cached.context === context
    ) {
      return cached.value;
    }
    const value = this.buildMessageContentSegments(message, context);
    this.segmentCache.set(message, { content, mentions, context, value });
    return value;
  }

  private buildMessageContentSegments(
    message: MessageText,
    context: MessageMentionContext,
  ): MessageContentSegment[] {
    const content = message.content ?? '';
    if (!content || !message.mentioned_user_ids.length) {
      return [{ text: content, mentionUserId: null }];
    }

    const mentionCandidates = this.messageMentionCandidatesByUserId(message, context);
    if (!mentionCandidates.size) {
      return [{ text: content, mentionUserId: null }];
    }

    const orderedCandidates = [...mentionCandidates.entries()]
      .flatMap(([userId, tokens]) => [...tokens].map((token) => ({ userId, token })))
      .sort((left, right) => right.token.length - left.token.length);

    const normalizedContent = content;
    const contentFolded = normalizedContent.toLocaleLowerCase('ru-RU');
    const segments: MessageContentSegment[] = [];

    let segmentStart = 0;
    let searchFrom = 0;
    while (searchFrom < normalizedContent.length) {
      const mentionStart = contentFolded.indexOf('@', searchFrom);
      if (mentionStart < 0) {
        break;
      }

      if (!this.hasMentionBoundaryAt(normalizedContent, mentionStart)) {
        searchFrom = mentionStart + 1;
        continue;
      }

      const matchedCandidate = orderedCandidates.find((candidate) => {
        const mentionEnd = mentionStart + candidate.token.length;
        return (
          contentFolded.startsWith(candidate.token, mentionStart) &&
          this.hasMentionBoundaryAfter(normalizedContent, mentionEnd)
        );
      });

      if (!matchedCandidate) {
        searchFrom = mentionStart + 1;
        continue;
      }

      if (mentionStart > segmentStart) {
        segments.push({
          text: normalizedContent.slice(segmentStart, mentionStart),
          mentionUserId: null,
        });
      }

      const mentionEnd = mentionStart + matchedCandidate.token.length;
      segments.push({
        text: normalizedContent.slice(mentionStart, mentionEnd),
        mentionUserId: matchedCandidate.userId,
      });
      segmentStart = mentionEnd;
      searchFrom = mentionEnd;
    }

    if (segmentStart < normalizedContent.length) {
      segments.push({
        text: normalizedContent.slice(segmentStart),
        mentionUserId: null,
      });
    }

    return segments.length ? segments : [{ text: normalizedContent, mentionUserId: null }];
  }

  private messageMentionCandidatesByUserId(
    message: MessageText,
    context: MessageMentionContext,
  ): Map<string, Set<string>> {
    const candidatesByUserId = new Map<string, Set<string>>();
    const activeConversationMembers = (context.conversation ?? []).map((member) => ({
      userId: member.user_id,
      publicId: member.public_id,
      nick: member.nick,
    }));
    const serverMembers = context.members.map((member) => ({
      userId: member.user_id,
      publicId: member.public_id,
      nick: member.nick,
    }));
    const users = [...activeConversationMembers, ...serverMembers];

    for (const user of users) {
      if (
        !message.mentioned_user_ids.includes(user.userId) ||
        candidatesByUserId.has(user.userId)
      ) {
        continue;
      }

      const tokens = new Set<string>();
      const normalizedNick = (user.nick ?? '').trim();
      if (normalizedNick) {
        tokens.add(`@${normalizedNick.toLocaleLowerCase('ru-RU')}`);
      }
      tokens.add(`@${formatPublicUserId(user.publicId)}`);
      candidatesByUserId.set(user.userId, tokens);
    }

    return candidatesByUserId;
  }

  private hasMentionBoundaryAt(content: string, index: number): boolean {
    if (index <= 0) {
      return true;
    }

    return this.isMentionBoundaryChar(content[index - 1] ?? '');
  }

  private hasMentionBoundaryAfter(content: string, index: number): boolean {
    if (index >= content.length) {
      return true;
    }

    return this.isMentionBoundaryChar(content[index] ?? '');
  }

  private isMentionBoundaryChar(character: string): boolean {
    return !/[\p{L}\p{N}_]/u.test(character);
  }

  private buildSearchPreview(rawContent: string, query: string): string {
    const content = (rawContent ?? '').trim();
    if (!content) {
      return 'Сообщение без текста';
    }

    const terms = buildSearchTerms(query);
    if (!terms.length) {
      return content.length > 180 ? `${content.slice(0, 177).trimEnd()}...` : content;
    }

    const foldedContent = content.toLocaleLowerCase('ru-RU');
    const matchIndex =
      terms
        .map((term) => foldedContent.indexOf(term))
        .filter((index) => index >= 0)
        .sort((left, right) => left - right)[0] ?? 0;

    const previewRadius = 72;
    const start = Math.max(0, matchIndex - previewRadius);
    const end = Math.min(content.length, matchIndex + previewRadius + 48);
    const prefix = start > 0 ? '... ' : '';
    const suffix = end < content.length ? ' ...' : '';
    return `${prefix}${content.slice(start, end).trim()}${suffix}`;
  }
}
