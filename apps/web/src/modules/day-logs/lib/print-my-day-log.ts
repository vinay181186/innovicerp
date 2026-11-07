// One person's day without its edit history (ADR-288, owner 2026-11-07), laid out as
// the Job Card print: My Day Log's Print, and Team Day Logs › a person › Print for
// anyone but a Super Admin (who gets the History PDF of that date). The letterhead,
// the name bar and the Day Log and Work columns sit in the <thead>, which the
// paginator repeats on every page. The entry columns and rows are `dayTable`'s, so
// the print and the CSV / Excel agree.

import type { Company, DayLogDetail } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { buildDocCompany } from '@/lib/print/company';
import { esc } from '@/lib/print/doc-print';
import { openSheetHtmlWindow, sheetLetterheadHtml } from '@/lib/print/sheet-print';
import { DAY_CENTRE_KEYS, dayTable } from './export';
import { fmtStamp } from './format';
import { cellsOn, GRID, kindPrefix, td, tr } from './print-history-cells';
import { column, field, HEADER_STYLE, nameAndColumns } from './print-history-header';
import { sortEntries } from './sheet';

/** Colspans of the entry columns, in DAY_COLUMNS order, adding up to GRID. */
const SPANS = [2, 5, 4, 4, 4, 4, 7, 18] as const;

const ENTRIES_KEY = 'entries';

const STYLE = `
  table.doc{table-layout:fixed;font-size:9.5pt}
  table.doc > tbody > tr > td{padding:1.1mm 1.4mm;overflow-wrap:anywhere}
  .jh{border:1px solid var(--paper-rule);margin:0 -.5px -.5px;text-align:left;font-weight:400}
  .jh .jcols{grid-template-columns:1fr 1fr}
  tr.hd > td{background:var(--paper-band);font-family:var(--f-label);font-weight:700;font-size:7.5pt;
             line-height:1.15;text-transform:uppercase;vertical-align:middle}
  tr.nw > td{font-style:italic}
  td.c{text-align:center;font-size:9pt;font-variant-numeric:tabular-nums}
  table.doc > tbody > tr > td.c{padding-left:.5mm;padding-right:.5mm}
  td.b{font-weight:700}
  td.wo{white-space:pre-wrap}
  .signs{grid-template-columns:1fr 1fr}
  .signs > div{padding:1.6mm 1.6mm 11mm}
  .signs .jsn{display:block;text-transform:none;letter-spacing:0;font-size:9pt;font-weight:400}
  ${HEADER_STYLE}
`;

const timeOf = (t: string | null): string => (t ? fmt12(t) : '');

const isCentred = (key: string): boolean => (DAY_CENTRE_KEYS as readonly string[]).includes(key);

/** The whole sheet as HTML. `now` is the Printed stamp. */
export function myDayLogHtml(
  day: DayLogDetail,
  company: Company | null | undefined,
  now: Date = new Date(),
): string {
  const s = day.summary;
  const t = dayTable(day);
  const printed = fmtStamp(now.toISOString());
  const header = nameAndColumns({ person: day.userName, dept: day.deptLabel, printed }, [
    column('Day Log', '20mm', [
      field('Date', fmtDate(day.date), true),
      field('Entries', s.entryCount),
    ]),
    column('Work', '26mm', [
      field('First Start', timeOf(s.firstStart)),
      // With an entry still Open the summary's last stop is only "now", never a Stop.
      field('Last Stop', s.open ? '' : timeOf(s.lastStop)),
      field('Working Hours', fmtDuration(s.workMin), true),
    ]),
  ]);
  const letterhead = sheetLetterheadHtml({ name: buildDocCompany(company).name, title: 'Day Log' });

  const head = tr(
    cellsOn(
      SPANS,
      t.columns.map((c): [string, string] => [esc(c.label), isCentred(c.key) ? 'c' : '']),
    ),
    { cls: 'hd', keepNext: true, headFor: ENTRIES_KEY },
  );
  // dayTable sorts the same way, so a row and its entry share an index.
  const entries = sortEntries(day.entries);
  const rows = t.rows.map((r, i) => {
    const kind = entries[i]?.kind ?? 'work';
    const cells = t.columns.map((c): [string, string] => {
      const value = esc(r[c.key] ?? '');
      if (c.key === 'work') return [`${kindPrefix(kind)}${value}`, 'wo'];
      if (c.key === 'order_code') return [value, 'b'];
      return [value, isCentred(c.key) ? 'c' : ''];
    });
    return tr(cellsOn(SPANS, cells), {
      cls: kind === 'work' ? undefined : 'nw',
      // The sign block never lands alone on a new page.
      keepNext: i === t.rows.length - 1,
      carry: ENTRIES_KEY,
    });
  });
  const signs = tr(
    td(
      GRID,
      `<div class="signs"><div>Logged by<span class="jsn">${esc(day.userName)}</span></div><div>Seen by (Department Admin)</div></div>`,
      'block',
    ),
  );

  const foot = `${day.userName} · ${fmtDate(day.date)} · Printed ${printed}`;
  return `<article class="sheet" data-page-foot="${esc(foot)}">
    <table class="doc">
      <colgroup>${'<col>'.repeat(GRID)}</colgroup>
      <thead><tr><th class="lh" colspan="${GRID}">${letterhead}<div class="jh">${header}</div></th></tr></thead>
      <tfoot><tr><td class="pgfoot" colspan="${GRID}"><div></div></td></tr></tfoot>
      <tbody>${head}${rows.join('')}${signs}</tbody>
    </table>
  </article>`;
}

/** The PDF's file name; the Preview box and the sheet share it. */
export const dayLogFileName = (userName: string, date: string): string =>
  `Day Log ${userName} ${date}`;

export function printDayLog(day: DayLogDetail, company: Company | null | undefined): boolean {
  const name = dayLogFileName(day.userName, day.date);
  return openSheetHtmlWindow(name, myDayLogHtml(day, company), STYLE, undefined, name);
}
