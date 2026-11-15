import { describe, expect, it } from 'vitest';
import {
  answerBlocks,
  inlinePieces,
  isDocNumber,
  isItemCodeHeading,
  isNumericColumn,
  splitRow,
} from './answer-blocks';

describe('answerBlocks', () => {
  it('keeps plain text as one text block', () => {
    expect(answerBlocks('Two POs are open.\nBoth are due this week.')).toEqual([
      { kind: 'text', text: 'Two POs are open.\nBoth are due this week.' },
    ]);
  });

  it('splits text, a pipe table and more text', () => {
    const answer = [
      'Open POs for Acme:',
      '',
      '| PO No. | Item Code | Qty |',
      '|---|:---:|---:|',
      '| IN-PO-00012 | `BRKT-101` | 40 |',
      '| IN-PO-00015 | SHFT-50 | 12 |',
      '',
      'Both are approved.',
    ].join('\n');
    expect(answerBlocks(answer)).toEqual([
      { kind: 'text', text: 'Open POs for Acme:' },
      {
        kind: 'table',
        headers: ['PO No.', 'Item Code', 'Qty'],
        rows: [
          ['IN-PO-00012', '`BRKT-101`', '40'],
          ['IN-PO-00015', 'SHFT-50', '12'],
        ],
      },
      { kind: 'text', text: 'Both are approved.' },
    ]);
  });

  it('pads a short row and drops extra cells to the header width', () => {
    expect(answerBlocks('| A | B |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 |')).toEqual([
      {
        kind: 'table',
        headers: ['A', 'B'],
        rows: [
          ['1', ''],
          ['1', '2'],
        ],
      },
    ]);
  });

  it('falls back to text when the separator line is missing or the wrong width', () => {
    const noSep = '| A | B |\n| 1 | 2 |';
    expect(answerBlocks(noSep)).toEqual([{ kind: 'text', text: noSep }]);
    const wrongWidth = '| A | B |\n|---|\n| 1 | 2 |';
    expect(answerBlocks(wrongWidth)).toEqual([{ kind: 'text', text: wrongWidth }]);
  });

  it('returns nothing for an empty answer', () => {
    expect(answerBlocks('  \n\n')).toEqual([]);
  });
});

describe('splitRow', () => {
  it('keeps an escaped pipe inside its cell', () => {
    expect(splitRow('| a \\| b | c |')).toEqual(['a | b', 'c']);
  });
});

describe('inlinePieces', () => {
  it('finds bold, item codes in backticks and document numbers', () => {
    expect(inlinePieces('**Late:** IN-JC-26-0085 for `SHFT-50` and SO-1234.')).toEqual([
      { kind: 'bold', text: 'Late:' },
      { kind: 'text', text: ' ' },
      { kind: 'doc', text: 'IN-JC-26-0085' },
      { kind: 'text', text: ' for ' },
      { kind: 'code', text: 'SHFT-50' },
      { kind: 'text', text: ' and ' },
      { kind: 'doc', text: 'SO-1234' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('leaves a line with nothing special alone', () => {
    expect(inlinePieces('No open job cards.')).toEqual([
      { kind: 'text', text: 'No open job cards.' },
    ]);
  });
});

describe('column helpers', () => {
  it('spots document numbers, numeric columns and item-code headings', () => {
    expect(isDocNumber('IN-SO-00417')).toBe(true);
    expect(isDocNumber('Shaft 50mm')).toBe(false);
    expect(isNumericColumn([['12'], ['1,250.50'], ['']], 0)).toBe(true);
    expect(isNumericColumn([['12'], ['NOS']], 0)).toBe(false);
    expect(isItemCodeHeading('Item Code')).toBe(true);
    expect(isItemCodeHeading('Item Name')).toBe(false);
  });
});
