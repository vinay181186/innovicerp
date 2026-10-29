import { describe, expect, it } from 'vitest';
import { wordDiff } from './word-diff';

const show = (a: string, b: string): string =>
  wordDiff(a, b)
    .map((p) => (p.kind === 'del' ? `[-${p.text}]` : p.kind === 'ins' ? `[+${p.text}]` : p.text))
    .join('');

describe('wordDiff', () => {
  it('returns one plain run when nothing changed', () => {
    expect(wordDiff('a b c', 'a b c')).toEqual([{ kind: 'same', text: 'a b c' }]);
  });

  it('marks added words', () => {
    expect(show('SAHACHAR CALL RAISE SO-555', 'SAHACHAR CALL RAISE SO-555 & 321')).toBe(
      'SAHACHAR CALL RAISE SO-555 [+&] [+321]',
    );
  });

  it('marks removed and replaced words', () => {
    expect(show('call to kartik today', 'call to dipesh today')).toBe(
      'call to [-kartik][+dipesh] today',
    );
    expect(show('one two three', 'one three')).toBe('one [-two] three');
  });

  it('keeps line breaks and spacing exactly, never marking whitespace', () => {
    const parts = wordDiff('> a\n> b', '> a\n\n> b\n> c');
    expect(parts.map((p) => p.text).join('')).toContain('> a');
    expect(parts.filter((p) => p.kind !== 'same').every((p) => /\S/.test(p.text))).toBe(true);
    // Every token of the NEW text is present, in order, once the removed runs are dropped.
    expect(
      parts
        .filter((p) => p.kind !== 'del')
        .map((p) => p.text)
        .join('')
        .replace(/\s+/g, ' '),
    ).toBe('> a > b > c');
  });

  it('handles empty texts', () => {
    expect(wordDiff('', '')).toEqual([]);
    expect(show('', 'new text')).toBe('[+new] [+text]');
    expect(show('old', '')).toBe('[-old]');
  });
});
