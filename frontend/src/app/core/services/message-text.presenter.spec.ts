import { MessageMentionContext } from '../models/message-text.models';
import { MessageTextPresenter } from './message-text.presenter';

describe('MessageTextPresenter', () => {
  let presenter: MessageTextPresenter;
  const alice = {user_id: 'alice', public_id: 42, nick: 'Алиса'};
  const context: MessageMentionContext = {members: [alice]};

  beforeEach(() => { presenter = new MessageTextPresenter(); });

  it('resolves only confirmed mentions and preserves the original text', () => {
    const content = '@АЛИСА, @00042! mail@Алиса @Алиса_2 @Боб';
    const result = presenter.render({content, mentioned_user_ids: ['alice']}, '', context);
    expect(result.map(segment => segment.text).join('')).toBe(content);
    expect(result.filter(segment => segment.mentionUserId).map(segment => segment.text))
      .toEqual(['@АЛИСА', '@00042']);
    expect(presenter.render({content, mentioned_user_ids: []}, '', context)
      .every(segment => segment.mentionUserId === null)).toBeTrue();
  });

  it('prefers the longest matching nickname and conversation member identities', () => {
    const members = [alice, {user_id: 'alice-long', public_id: 43, nick: 'Алиса Ква'}];
    const message = {content: '@Алиса Ква @Новое', mentioned_user_ids: ['alice', 'alice-long']};
    const result = presenter.render(message, '', {
      members,
      conversation: [{...alice, nick: 'Новое'}],
    });
    expect(result.filter(segment => segment.mentionUserId).map(segment => segment.mentionUserId))
      .toEqual(['alice-long', 'alice']);
  });

  it('extracts HTTP links without consuming trailing punctuation or enabling other schemes', () => {
    const content = 'Сайт https://example.com/test?! javascript:alert(1) https://';
    const result = presenter.render({content, mentioned_user_ids: []}, '', context);
    const links = result.flatMap(segment => segment.chunks.flatMap(chunk => chunk.links));
    expect(links.map(link => link.text).join('')).toBe(content);
    expect(links.filter(link => link.url)).toEqual([
      {text: 'https://example.com/test', url: 'https://example.com/test'},
    ]);
  });

  it('keeps mention clicks and search highlighting separate from link rendering', () => {
    const result = presenter.render({content: '@Алиса https://example.com', mentioned_user_ids: ['alice']}, 'алиса', context);
    expect(result[0].mentionUserId).toBe('alice');
    expect(result[0].chunks.find(chunk => chunk.highlighted)?.text).toBe('Алиса');
    expect(result[0].chunks.every(chunk => chunk.links.length === 0)).toBeTrue();
    expect(result[1].chunks.flatMap(chunk => chunk.links).some(link => link.url === 'https://example.com')).toBeTrue();
  });

  it('invalidates cached models after text, confirmed mentions, query or chat context changes', () => {
    const message = {content: '@Алиса', mentioned_user_ids: ['alice']};
    const initial = presenter.render(message, '', context);
    expect(presenter.render(message, '', context)).toBe(initial);
    message.content = '@Алиса привет';
    const edited = presenter.render(message, '', context);
    expect(edited).not.toBe(initial);
    message.mentioned_user_ids = [];
    const withoutMention = presenter.render(message, '', context);
    expect(withoutMention.some(segment => segment.mentionUserId)).toBeFalse();
    expect(withoutMention).not.toBe(edited);
    expect(presenter.render(message, 'привет', context)).not.toBe(withoutMention);
    message.mentioned_user_ids = ['alice'];
    const switched = presenter.render(message, '', {members: []});
    expect(switched.some(segment => segment.mentionUserId)).toBeFalse();
    expect(presenter.render(message, '', context).some(segment => segment.mentionUserId === 'alice')).toBeTrue();
  });

  it('retains model identity across a history larger than the bounded string caches', () => {
    const messages = Array.from({length: 1000}, (_, index) => ({content: `Message ${index}`, mentioned_user_ids: []}));
    const models = messages.map(message => presenter.render(message, '', context));
    messages.forEach((message, index) => expect(presenter.render(message, '', context)).toBe(models[index]));
  });

  it('centres search previews on the earliest match and handles empty text', () => {
    const content = 'а'.repeat(200) + ' НАХОДКА ' + 'б'.repeat(200);
    const preview = presenter.preview(content, 'находка');
    expect(preview).toContain('НАХОДКА');
    expect(preview.startsWith('... ')).toBeTrue();
    expect(preview.endsWith(' ...')).toBeTrue();
    expect(presenter.preview(content, '')).toBe('а'.repeat(177) + '...');
    expect(presenter.preview('   ', '')).toBe('Сообщение без текста');
    expect(presenter.preview(' короткий текст ', '')).toBe('короткий текст');
  });
});
