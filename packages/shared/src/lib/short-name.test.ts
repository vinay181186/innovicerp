import { describe, expect, it } from 'vitest';
import { shortName } from './short-name';

describe('shortName', () => {
  // Every one of these is a REAL production user name, so the test says what
  // the QC panels will actually show rather than what a made-up name would.
  it('takes the first word and the initial of the last', () => {
    expect(shortName('Jinal Jayantibhai Rohit')).toBe('Jinal R.');
    expect(shortName('Chandrakant Ramanbhai Macwan')).toBe('Chandrakant M.');
    expect(shortName('Shivani Udaypalsinh Chavhan')).toBe('Shivani C.');
    expect(shortName('Vinay N Makwana')).toBe('Vinay M.');
  });

  it('handles the two-word names the same way', () => {
    expect(shortName('Daman Patel')).toBe('Daman P.');
    expect(shortName('Ekta Purani')).toBe('Ekta P.');
    expect(shortName('Tejas Amin')).toBe('Tejas A.');
    // The record corrected on 2026-09-11 — see the note in short-name.ts.
    expect(shortName('Aashvi Prajapati')).toBe('Aashvi P.');
  });

  it('leaves a one-word name alone — there is no surname to initial', () => {
    expect(shortName('dummy')).toBe('dummy');
    expect(shortName('jinal')).toBe('jinal');
  });

  it('never touches an e-mail, which is the fallback when there is no name', () => {
    expect(shortName('vinay.makwana24@gmail.com')).toBe('vinay.makwana24@gmail.com');
  });

  it('is blank-safe', () => {
    expect(shortName('')).toBe('');
    expect(shortName('   ')).toBe('');
    expect(shortName(null)).toBe('');
    expect(shortName(undefined)).toBe('');
  });

  it('tidies stray whitespace rather than producing an empty initial', () => {
    expect(shortName('  Jinal   Jayantibhai   Rohit  ')).toBe('Jinal R.');
  });

  it('upper-cases the initial even when the record is lower-case', () => {
    expect(shortName('jinal rohit')).toBe('jinal R.');
  });
});
