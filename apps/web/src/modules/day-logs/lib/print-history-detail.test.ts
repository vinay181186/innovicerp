// Day Log History PDF (ADR-278): a text too tall for the narrow column.

import { describe, expect, it } from 'vitest';
import { blank, build, day, entry, history } from './print-history-fixture';

const rev = (entryRevNo: number, description: string, savedAt: string) => ({
  entryRevNo,
  description,
  fromTime: '09:00',
  toTime: '11:00',
  order: null,
  savedAt,
});

const edited = (before: string, after: string): string =>
  build(
    history([
      day({
        date: '2026-10-22',
        state: 'filled',
        entryCount: 1,
        entries: [
          entry({
            description: after,
            entryRevNo: 1,
            revisions: [
              rev(1, after, '2026-10-23T07:47:00Z'),
              rev(0, before, '2026-10-22T07:47:00Z'),
            ],
          }),
        ],
      }),
    ]),
  );

describe('Day Log History PDF: a date header', () => {
  it('shows the date Break and Others only above 0', () => {
    const none = build(history([day()]));
    expect(none).not.toContain('>Break<');
    expect(none).not.toContain('>Others<');
    const old = build(history([day({ breakMin: 45, leaveMin: 60 })]));
    expect(old).toContain('Break</span><span class="jv">0h 45m<');
    expect(old).toContain('Others</span><span class="jv">1h 00m<');
  });

  it('gives a blank today no page, and a today with an entry one', () => {
    const blankToday = { ...blank, date: '2026-10-23', state: 'today' as const };
    const html = build(history([day(), day(blankToday)], { from: '2026-10-22', to: '2026-10-23' }));
    expect(html).toContain('data-page-anchor="date-2026-10-22"');
    expect(html).not.toContain('data-page-anchor="date-2026-10-23"');
    const worked = build(
      history([day(), day({ date: '2026-10-23', state: 'today' })], {
        from: '2026-10-22',
        to: '2026-10-23',
      }),
    );
    expect(worked).toContain('data-page-anchor="date-2026-10-23"');
  });
});

describe('Day Log History PDF: a long edit', () => {
  it('a full rewrite of a long text takes the full width on its own row', () => {
    const html = edited('alpha '.repeat(330).trim(), 'bravo '.repeat(330).trim());
    expect(html).toContain('>Below<');
    expect(html).toMatch(/<td colspan="46" class="wo"><del>alpha/);
    // The facts row moves with its text.
    expect(html).toMatch(/<tr class="tl" data-keep-next[^>]*>(?:(?!<\/tr>).)*>Below</s);
  });

  it('a short edit stays in the Working On column', () => {
    const html = edited('Fixture check', 'Fixture check done');
    expect(html).not.toContain('>Below<');
    expect(html).not.toContain('colspan="46"');
  });
});
