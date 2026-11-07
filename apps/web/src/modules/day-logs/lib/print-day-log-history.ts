// Day Log History PDF (ADR-278, owner 2026-11-07): one person's dates on the
// Innovic Sheet. A range: a first part (header, calendar, list of dates), then one
// page per date. One date: just that date's page. It draws what the server sent:
// every state and total is the server's, nothing is worked out here.
//
// ONE table, so the sheet's paginator (sheet-print.ts) splits it between rows;
// `table.dl` is skipped by the paginator and would come out as one sliced
// picture. One table means one column grid: GRID equal columns, and every part
// lines up through colspans (print-history-cells.ts); a block with a layout of its
// own is one full-width row holding CSS grids (print-history-header.ts,
// print-history-calendar.ts); a date's part is in print-history-detail.ts. The
// page-splitting rules are the data-* attributes on the rows, each explained at
// PAGINATE_SCRIPT.

import type { Company, DayLogHistory } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { buildDocCompany } from '@/lib/print/company';
import { esc } from '@/lib/print/doc-print';
import {
  openSheetHtmlWindow,
  sheetLetterheadHtml,
  sheetLetterheadLines,
} from '@/lib/print/sheet-print';
import { fmtStamp, weekdayName } from './format';
import { CALENDAR_STYLE, calendarRows } from './print-history-calendar';
import {
  cellsOn,
  dateAnchor,
  FIRST_KEY,
  GRID,
  hasDetail,
  headRow,
  NO_DETAIL_STATES,
  pageRef,
  sectionRow,
  SPAN,
  statusText,
  td,
  tr,
} from './print-history-cells';
import { dayRows } from './print-history-detail';
import { HEADER_STYLE, type HistoryPrintContext, rangeHeaderRow } from './print-history-header';

const HISTORY_STYLE = `
  table.doc{table-layout:fixed;font-size:9pt}
  table.doc > tbody > tr > td{padding:1mm 1.2mm;overflow-wrap:anywhere}
  table.doc > tbody > tr.sect > td{border-left:0;border-right:0;border-top:0;padding:3mm 0 1mm;
    font-family:var(--f-head);font-weight:700;font-size:11pt;color:var(--brand)}
  .sect-note{font-family:var(--f-body);font-weight:400;font-size:8.5pt;color:var(--paper-ink);margin-left:3mm}
  tr.hd > td,tr.tlh > td{font-weight:700;background:var(--paper-band)}
  td.r{text-align:center;font-variant-numeric:tabular-nums}
  td.b{font-weight:700}
  td.wo{white-space:pre-wrap}
  tr.nw > td,tr.off > td{font-style:italic}
  tr.tl > td,tr.tlh > td{font-size:8.5pt}
  table.doc > tbody > tr.dl > td{padding:.5mm 1.2mm}
  table.doc > tbody > tr.sign > td{height:16mm;vertical-align:bottom}
  del{text-decoration:line-through}
  ins{text-decoration:underline;font-weight:700}
  ${HEADER_STYLE}
  ${CALENDAR_STYLE}
`;

const CALENDAR_NOTE =
  'Hours worked on each date. N/E, grey box = Not entered. Grey number = outside From Date to To Date.';

const LIST_KEY = 'list';

/** The file name of the PDF; the pop-up and the sheet share it. */
export function historyFileName(userName: string, from: string, to: string): string {
  return `Day Log History ${userName} ${from === to ? from : `${from} to ${to}`}`;
}

function periodText(h: DayLogHistory): string {
  return h.from === h.to ? fmtDate(h.from) : `${fmtDate(h.from)} to ${fmtDate(h.to)}`;
}

function dateByDateRows(h: DayLogHistory): string {
  const spans = SPAN.list;
  const carry = `${FIRST_KEY} ${LIST_KEY}`;
  const numbers = ['Working Hours', 'Entries', 'Edits', 'Replies', 'Page'];
  const head = tr(
    headRow(
      spans,
      ['Date', 'Day', 'First Start', 'Last Stop', ...numbers.slice(0, 4), 'Status', 'Page'],
      numbers,
    ),
    { cls: 'hd dl', keepNext: true, headFor: LIST_KEY, carry: FIRST_KEY },
  );
  const rows = h.days.map((d) => {
    const off = NO_DETAIL_STATES.includes(d.state);
    const blank = d.state === 'not_entered';
    const has = d.entries.length > 0;
    const count = (n: number): [string, string] => [off && n === 0 ? '' : String(n), 'r'];
    return tr(
      cellsOn(spans, [
        [esc(fmtDate(d.date)), off ? '' : 'b'],
        esc(weekdayName(d.date)),
        has ? esc(fmt12(d.firstStart)) : '',
        has ? esc(fmt12(d.lastStop)) : '',
        [has ? esc(fmtDuration(d.workMin)) : '', 'r'],
        count(d.entryCount),
        count(d.edits),
        count(d.replies),
        [esc(statusText(d)), blank ? 'b' : ''],
        [hasDetail(d) ? pageRef(dateAnchor(d.date)) : '', 'r'],
      ]),
      { carry, cls: off ? 'dl off' : blank ? 'dl hd' : 'dl' },
    );
  });
  const t = h.totals;
  const before = spans[0] + spans[1] + spans[2] + spans[3];
  const total = tr(
    td(before, 'Total') +
      td(spans[4], esc(fmtDuration(t.workMin)), 'r') +
      td(spans[5], String(t.entries), 'r') +
      td(spans[6], String(t.edits), 'r') +
      td(spans[7], String(t.replies), 'r') +
      td(spans[8] + spans[9], ''),
    { cls: 'hd dl', carry },
  );
  return sectionRow('Dates in this PDF') + head + rows.join('') + total;
}

/** The whole sheet as HTML. `now` is the Printed stamp. */
export function dayLogHistoryHtml(
  h: DayLogHistory,
  company: Company | null | undefined,
  now: Date = new Date(),
): string {
  const doc = buildDocCompany(company);
  const letterhead = sheetLetterheadHtml({
    name: doc.name,
    title: 'Day Log History',
    lines: sheetLetterheadLines(doc),
  });
  const printed = fmtStamp(now.toISOString());
  const ctx: HistoryPrintContext = { person: h.userName, dept: h.deptLabel, printed };
  const first =
    h.from === h.to
      ? ''
      : rangeHeaderRow(h, ctx) +
        sectionRow('Calendar', CALENDAR_NOTE, 'sect-cal') +
        calendarRows(h) +
        dateByDateRows(h);
  const dates = h.days
    .filter(hasDetail)
    .map((d) => dayRows(d, ctx))
    .join('');
  const foot = `${h.userName} · ${periodText(h)} · Printed ${printed}`;
  return `<article class="sheet" data-page-foot="${esc(foot)}">
    <table class="doc">
      <colgroup>${'<col>'.repeat(GRID)}</colgroup>
      <thead><tr><th class="lh" colspan="${GRID}">${letterhead}</th></tr></thead>
      <tfoot><tr><td class="pgfoot" colspan="${GRID}"><div></div></td></tr></tfoot>
      <tbody>${first}${dates}</tbody>
    </table>
  </article>`;
}

/** Shows the sheet in the Preview box (Print, Download). */
export function printDayLogHistory(h: DayLogHistory, company: Company | null | undefined): boolean {
  return openSheetHtmlWindow(
    'History',
    dayLogHistoryHtml(h, company),
    HISTORY_STYLE,
    undefined,
    historyFileName(h.userName, h.from, h.to),
  );
}
