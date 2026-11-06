// Day Log History PDF (ADR-278, owner 2026-11-06): one person's month or date
// on the Innovic Sheet. Summary · Points to check · Date by date (more than one
// date) · Day detail. It draws what the server sent: every state and total is
// the server's, nothing is worked out here.
//
// ONE table, so the sheet's paginator (sheet-print.ts) splits it between rows;
// `table.dl` is skipped by the paginator and would come out as one sliced
// picture. One table means one column grid: GRID equal columns, and every part
// lines up through colspans (print-history-cells.ts); Day detail is in
// print-history-detail.ts. The page-splitting rules are the data-* attributes on
// the rows, each explained at PAGINATE_SCRIPT.

import type {
  Company,
  DayLogAdminReply,
  DayLogHistory,
  DayLogHistoryDay,
  DayLogHistoryEntry,
} from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { buildDocCompany } from '@/lib/print/company';
import { esc } from '@/lib/print/doc-print';
import {
  openSheetHtmlWindow,
  sheetLetterheadHtml,
  sheetLetterheadLines,
} from '@/lib/print/sheet-print';
import { fmtStamp, monthLabel, weekdayName } from './format';
import {
  cellsOn,
  dateAnchor,
  editsOf,
  entryAnchor,
  GRID,
  hasDetail,
  headRow,
  NO_DETAIL_STATES,
  pageRef,
  sectionRow,
  seenText,
  SPAN,
  statusText,
  td,
  timesText,
  tr,
} from './print-history-cells';
import { dayRows } from './print-history-detail';

const HISTORY_STYLE = `
  table.doc{table-layout:fixed;font-size:9pt}
  table.doc > tbody > tr > td{padding:1mm 1.2mm;overflow-wrap:anywhere}
  table.doc > tbody > tr.sect > td{border-left:0;border-right:0;border-top:0;padding:3mm 0 1mm;
    font-family:var(--f-head);font-weight:700;font-size:11pt;color:var(--brand)}
  .sect-note{font-family:var(--f-body);font-weight:400;font-size:8.5pt;color:var(--paper-ink);margin-left:3mm}
  tr.hd > td,td.k,tr.band > td,tr.tlh > td{font-weight:700;background:var(--paper-band)}
  td.r{text-align:right;font-variant-numeric:tabular-nums}
  td.b{font-weight:700}
  td.wo{white-space:pre-wrap}
  .facts{font-weight:400}
  tr.nw > td,tr.off > td{font-style:italic}
  tr.tl > td,tr.tlh > td{font-size:8.5pt}
  table.doc > tbody > tr.sign > td{height:16mm;vertical-align:bottom}
  del{text-decoration:line-through}
  ins{text-decoration:underline;font-weight:700}
`;

const LEGEND = 'Edits, oldest first: <del>removed words</del> · <ins>added words</ins>';

function periodText(h: DayLogHistory): string {
  return h.month ? monthLabel(h.month) : fmtDate(h.date);
}

// ── 1 · Summary ──

function kvRow(pairs: readonly (readonly [string, string])[]): string {
  const pairSpan = SPAN.kvKey + SPAN.kvValue;
  const cells = pairs.map(([k, v], i) => {
    const last = i === pairs.length - 1;
    const valueSpan = last ? GRID - pairSpan * (pairs.length - 1) - SPAN.kvKey : SPAN.kvValue;
    return td(SPAN.kvKey, esc(k), 'k') + td(valueSpan, esc(v), 'b');
  });
  return tr(cells.join(''));
}

function summaryRows(h: DayLogHistory, printed: string): string {
  const t = h.totals;
  return (
    sectionRow('1 · Summary') +
    kvRow([
      ['User', h.userName],
      ['Department', h.deptLabel ?? '—'],
      [h.month ? 'Month' : 'Date', periodText(h)],
      ['Printed', printed],
    ]) +
    kvRow([
      ['Working days', String(t.workingDays)],
      ['Filled days', String(t.filledDays)],
      ['Not entered', String(t.notEntered)],
      ['Entries', String(t.entries)],
    ]) +
    // Break and Others: only old rows have them, so only when above 0.
    kvRow([
      ['Working hours', fmtDuration(t.workMin)],
      ...(t.breakMin > 0 ? ([['Break', fmtDuration(t.breakMin)]] as const) : []),
      ...(t.leaveMin > 0 ? ([['Others', fmtDuration(t.leaveMin)]] as const) : []),
      ['Sunday / holiday', String(t.offDays)],
      ...(t.leaveDays > 0 ? ([['Leave', String(t.leaveDays)]] as const) : []),
    ]) +
    kvRow([
      ['Edited entries', String(t.editedEntries)],
      ['Edits', String(t.edits)],
      ['Replies', String(t.replies)],
      ['Saved later', String(t.savedLater)],
    ])
  );
}

// ── 2 · Points to check ──

interface Point {
  date: string;
  entry: string;
  text: string;
  anchor: string;
}

/** Entries first saved after their date, by the date they were saved. */
function savedLaterPoints(d: DayLogHistoryDay): Point[] {
  const byLogDate = new Map<string, DayLogHistoryEntry[]>();
  for (const e of d.entries) {
    if (!e.savedLaterOn) continue;
    const logDate = fmtDate(e.savedLaterOn);
    byLogDate.set(logDate, [...(byLogDate.get(logDate) ?? []), e]);
  }
  return [...byLogDate].map(([logDate, es]) => ({
    date: d.date,
    entry: es.length === d.entries.length ? 'All' : es.map((e) => `Sr ${e.srNo}`).join(', '),
    text: `Saved on a later date: ${logDate}`,
    anchor: entryAnchor(es[0]?.id ?? ''),
  }));
}

function pointsOf(h: DayLogHistory): Point[] {
  const out: Point[] = [];
  const seen = (r: DayLogAdminReply): string => seenText(r, h.userName);
  for (const d of h.days) {
    const onDate = { date: d.date, entry: '—', anchor: dateAnchor(d.date) };
    if (d.state === 'not_entered') {
      // The first reply still unseen, else the last one.
      const shown = d.dayReplies.find((r) => !r.seenAt) ?? d.dayReplies.at(-1);
      const reply = shown ? ` · Reply sent · ${seen(shown)}` : '';
      out.push({ ...onDate, text: `Not entered${reply}` });
    } else {
      // A blank date's reply stays when the person fills the date later.
      for (const r of d.dayReplies) out.push({ ...onDate, text: `Reply · ${seen(r)}` });
    }
    for (const e of d.entries) {
      const onEntry = { date: d.date, entry: `Sr ${e.srNo}`, anchor: entryAnchor(e.id) };
      if (editsOf(e) > 0) {
        const last = fmtStamp(e.entryRevisedAt ?? e.revisions[0]?.savedAt);
        out.push({ ...onEntry, text: `Edited ${timesText(editsOf(e))} · last on ${last}` });
      }
      for (const r of e.replies) out.push({ ...onEntry, text: `Reply · ${seen(r)}` });
      if (e.pending) out.push({ ...onEntry, text: 'Edit waiting approval' });
    }
    out.push(...savedLaterPoints(d));
  }
  return out;
}

function pointsRows(h: DayLogHistory): string {
  const spans = SPAN.points;
  const head = tr(headRow(spans, ['Date', 'Day', 'Entry', 'Point to check', 'Page'], ['Page']), {
    cls: 'hd',
    keepNext: true,
    headFor: 'points',
  });
  const points = pointsOf(h);
  const rows = points.map((p) =>
    tr(
      cellsOn(spans, [
        [esc(fmtDate(p.date)), 'b'],
        esc(weekdayName(p.date)),
        esc(p.entry),
        esc(p.text),
        [pageRef(p.anchor), 'r'],
      ]),
      { carry: 'points' },
    ),
  );
  const none = tr(td(GRID, 'Nothing to check.'));
  return sectionRow('2 · Points to check') + head + (rows.length ? rows.join('') : none);
}

// ── 3 · Date by date ──

function dateByDateRows(h: DayLogHistory): string {
  const spans = SPAN.list;
  const numbers = ['Working hours', 'Entries', 'Edits', 'Replies', 'Page'];
  const head = tr(
    headRow(
      spans,
      ['Date', 'Day', 'First start', 'Last stop', ...numbers.slice(0, 4), 'Status', 'Page'],
      numbers,
    ),
    { cls: 'hd', keepNext: true, headFor: 'list' },
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
      { carry: 'list', cls: off ? 'off' : blank ? 'hd' : undefined },
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
    { cls: 'hd', carry: 'list' },
  );
  return sectionRow('3 · Date by date') + head + rows.join('') + total;
}

// ── The document ──

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
  const manyDates = h.days.length > 1;
  const sign = tr(
    td(GRID / 2, `Logged by: ${esc(h.userName)}`) + td(GRID / 2, 'Seen by (Department Admin):'),
    { cls: 'sign' },
  );
  const foot = `${h.userName} · ${periodText(h)} · Printed ${printed}`;
  return `<article class="sheet" data-page-foot="${esc(foot)}">
    <table class="doc">
      <colgroup>${'<col>'.repeat(GRID)}</colgroup>
      <thead><tr><th class="lh" colspan="${GRID}">${letterhead}</th></tr></thead>
      <tfoot><tr><td class="pgfoot" colspan="${GRID}"><div></div></td></tr></tfoot>
      <tbody>${summaryRows(h, printed)}${pointsRows(h)}${manyDates ? dateByDateRows(h) : ''}${sectionRow(
        `${manyDates ? '4' : '3'} · Day detail`,
        manyDates,
        LEGEND,
      )}${h.days
        .filter(hasDetail)
        .map((d) => dayRows(d, h.userName))
        .join('')}${sign}</tbody>
    </table>
  </article>`;
}

/** Shows the sheet in the Preview box (Print, Download). */
export function printDayLogHistory(h: DayLogHistory, company: Company | null | undefined): boolean {
  const fileName = `Day Log History ${h.userName} ${h.month ?? h.date ?? ''}`;
  return openSheetHtmlWindow(
    'History',
    dayLogHistoryHtml(h, company),
    HISTORY_STYLE,
    undefined,
    fileName,
  );
}
