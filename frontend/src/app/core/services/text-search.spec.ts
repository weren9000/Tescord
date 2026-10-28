import { buildSearchTerms, buildTextHighlightChunks, matchesSearchTerms } from './text-search';

describe('text search', () => {
  it('matches all normalized terms across fields, ignoring absent fields', () => {
    const terms = buildSearchTerms('  КВА\n чат ');
    expect(terms).toEqual(['ква', 'чат']);
    expect(matchesSearchTerms(terms, ['КВА', null, 'Общий чат', undefined])).toBeTrue();
    expect(matchesSearchTerms(terms, ['КВА'])).toBeFalse();
    expect(matchesSearchTerms([], ['КВА'])).toBeFalse();
  });

  it('treats regex characters literally and highlights longer overlapping terms first', () => {
    const text = 'Квачат КВА a+b [x]';
    const chunks = buildTextHighlightChunks(text, 'ква квачат a+b [x] ква');
    expect(chunks.map(chunk => chunk.text).join('')).toBe(text);
    expect(chunks.filter(chunk => chunk.highlighted).map(chunk => chunk.text))
      .toEqual(['Квачат', 'КВА', 'a+b', '[x]']);
  });

  it('preserves empty and unmatched text', () => {
    expect(buildTextHighlightChunks('', 'ква')).toEqual([{text: '', highlighted: false}]);
    expect(buildTextHighlightChunks('Привет', ' ')).toEqual([{text: 'Привет', highlighted: false}]);
    expect(buildTextHighlightChunks('Привет', 'ква')).toEqual([{text: 'Привет', highlighted: false}]);
  });
});
