import { TextHighlightChunk } from '../models/message-text.models';

export function buildSearchTerms(value: string): string[] {
  return value
    .trim()
    .toLocaleLowerCase('ru-RU')
    .split(/\s+/)
    .filter((part) => part.length > 0);
}

export function matchesSearchTerms(terms: string[], values: Array<string | null | undefined>): boolean {
  if (!terms.length) {
    return false;
  }

  const haystack = values
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase('ru-RU');

  return terms.every((term) => haystack.includes(term));
}

export function buildTextHighlightChunks(text: string, query: string): TextHighlightChunk[] {
  if (!text) {
    return [{ text: '', highlighted: false }];
  }

  const escapedTerms = [...new Set(buildSearchTerms(query))]
    .sort((left, right) => right.length - left.length)
    .map((term) => escapeRegExp(term));

  if (!escapedTerms.length) {
    return [{ text, highlighted: false }];
  }

  const chunks: TextHighlightChunk[] = [];
  const matcher = new RegExp(`(${escapedTerms.join('|')})`, 'giu');
  let lastIndex = 0;

  for (const match of text.matchAll(matcher)) {
    const matchIndex = match.index ?? 0;
    const matchedText = match[0] ?? '';
    if (!matchedText) {
      continue;
    }

    if (matchIndex > lastIndex) {
      chunks.push({
        text: text.slice(lastIndex, matchIndex),
        highlighted: false,
      });
    }

    chunks.push({
      text: matchedText,
      highlighted: true,
    });
    lastIndex = matchIndex + matchedText.length;
  }

  if (lastIndex < text.length) {
    chunks.push({
      text: text.slice(lastIndex),
      highlighted: false,
    });
  }

  return chunks.length ? chunks : [{ text, highlighted: false }];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

