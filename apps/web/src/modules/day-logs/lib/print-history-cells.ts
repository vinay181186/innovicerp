// Day Log History PDF (ADR-278): the column grid and the row / cell pieces both
// parts of the sheet are drawn with. One table, one grid: every part lines up
// through colspans. The data-* attributes are explained at PAGINATE_SCRIPT
// (lib/print/sheet-print.ts).

import type { DayLogHistoryDay, DayLogHistoryDayState, DayLogHistoryEntry } from '@innovic/shared';
import { esc } from '@/lib/print/doc-print';
import { firstName, fmtStamp } from './format';

export const GRID = 48;

/** Colspans, each list adding up to GRID. */
export const SPAN = {
  kvKey: 7,
  kvValue: 5,
  points: [6, 6, 4, 29, 3],
  list: [6, 6, 5, 5, 5, 4, 3, 4, 7, 3],
  day: [2, 4, 4, 4, 7, 5, 4, 18],
  /** Blank · Action · Date and time · What changed · Working On at that time;
   *  the same edges as `day`. */
  timeline: [2, 8, 11, 9, 18],
} as const;

export const NO_DETAIL_STATES: readonly DayLogHistoryDayState[] = [
  'not_counted',
  'sunday',
  'holiday',
];

interface RowOpts {
  cls?: string | undefined;
  keepNext?: boolean | undefined;
  pageBreak?: boolean | undefined;
  headFor?: string | undefined;
  carry?: string | undefined;
  contd?: boolean | undefined;
  anchor?: string | undefined;
}

export function tr(cells: string, o: RowOpts = {}): string {
  const attrs = [
    o.cls ? `class="${o.cls}"` : '',
    o.keepNext ? 'data-keep-next' : '',
    o.pageBreak ? 'data-page-break' : '',
    o.headFor ? `data-head-for="${esc(o.headFor)}"` : '',
    o.carry ? `data-carry-head="${esc(o.carry)}"` : '',
    o.contd ? 'data-contd' : '',
    o.anchor ? `data-page-anchor="${esc(o.anchor)}"` : '',
  ].filter(Boolean);
  return `<tr${attrs.length ? ` ${attrs.join(' ')}` : ''}>${cells}</tr>`;
}

export function td(span: number, html: string, cls?: string): string {
  return `<td colspan="${span}"${cls ? ` class="${cls}"` : ''}>${html}</td>`;
}

/** One cell per value, on a colspan list. Cells are ready HTML. */
export function cellsOn(
  spans: readonly number[],
  cells: readonly (string | [string, string])[],
): string {
  return cells
    .map((c, i) => (Array.isArray(c) ? td(spans[i] ?? 1, c[0], c[1]) : td(spans[i] ?? 1, c)))
    .join('');
}

export function headRow(
  spans: readonly number[],
  names: readonly string[],
  right: readonly string[],
): string {
  return cellsOn(
    spans,
    names.map((n): string | [string, string] => (right.includes(n) ? [esc(n), 'r'] : esc(n))),
  );
}

export const sectionRow = (title: string, pageBreak = false, note = ''): string =>
  tr(td(GRID, `${esc(title)}${note ? ` <span class="sect-note">${note}</span>` : ''}`), {
    cls: 'sect',
    keepNext: true,
    pageBreak,
  });

export const pageRef = (key: string): string => `<span data-page-ref="${esc(key)}">—</span>`;

/** The words the person page uses for a reply (NAMING: Seen by / Not seen yet). */
export const seenText = (r: { seenAt: string | null }, person: string): string =>
  r.seenAt ? `Seen by ${firstName(person)} · ${fmtStamp(r.seenAt)}` : 'Not seen yet';

export const timesText = (n: number): string => `${n} time${n === 1 ? '' : 's'}`;

export const dateAnchor = (date: string): string => `date-${date}`;
export const entryAnchor = (id: string): string => `entry-${id}`;

export const editsOf = (e: DayLogHistoryEntry): number => e.entryRevNo ?? 0;

/** The dates that get a Day detail part. */
export function hasDetail(d: DayLogHistoryDay): boolean {
  return !NO_DETAIL_STATES.includes(d.state) || d.entries.length > 0 || d.dayReplies.length > 0;
}

export function statusText(d: DayLogHistoryDay): string {
  switch (d.state) {
    case 'filled':
      return 'Filled';
    case 'today':
      return 'Today';
    case 'not_entered':
      return 'Not entered';
    case 'not_counted':
      return 'Not counted';
    case 'leave':
      return 'Leave';
    case 'sunday':
      return 'Sunday';
    case 'holiday':
      return d.holidayName ? `Holiday · ${d.holidayName}` : 'Holiday';
  }
}
