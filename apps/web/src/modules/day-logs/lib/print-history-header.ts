// Day Log History PDF (ADR-278): the two header rows, a name bar over titled
// columns of label and value. The look is the Job Card header's; that print is its
// own file and stays apart, so History keeps its own copy of the style. Each header
// is one row of the sheet's table, holding CSS grid blocks, as the Job Card does.
//
// Neither header ever carries data-contd: the paginator appends "· contd." to the
// deepest last element, which would print "Saved Later 0 · contd.".

import type { DayLogHistory, DayLogHistoryDay } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { esc } from '@/lib/print/doc-print';
import { weekdayName } from './format';
import { dateAnchor, FIRST_KEY, GRID, pageRef, statusText, td, tr } from './print-history-cells';

export const HEADER_STYLE = `
  table.doc > tbody > tr > td.block{padding:0}
  .jnb{display:flex;justify-content:space-between;align-items:baseline;gap:4mm;padding:1.6mm;
       border-bottom:1px solid var(--paper-rule)}
  .jnb-name{font-weight:700;font-size:16.5pt;line-height:1.1;min-width:0;overflow-wrap:anywhere}
  .jnb-sub{font-size:9.5pt;white-space:nowrap}
  .jcols{display:grid;grid-template-columns:1fr 1.15fr .85fr}
  .jg{display:flex;flex-direction:column;border-left:1px solid var(--paper-rule);min-width:0}
  .jg:first-child{border-left:none}
  .jt{background:var(--paper-band);border-bottom:1px solid var(--paper-rule);padding:.9mm 1.6mm;
      font-family:var(--f-label);font-weight:700;font-size:8.5pt;letter-spacing:.1em;
      text-transform:uppercase;color:var(--paper-ink);line-height:1.1}
  .jr{flex:1 1 auto;display:grid;grid-template-columns:var(--jlw) minmax(0,1fr);column-gap:1mm;
      align-items:center;padding:.35mm 1.6mm;border-bottom:1px solid #D2D2D2;min-height:4.3mm;line-height:1.1}
  .jr:last-child{border-bottom:none}
  .jl{font-family:var(--f-label);font-weight:700;font-size:8pt;color:#3A3A3A;white-space:nowrap}
  .jv{font-size:9pt;color:var(--paper-ink);overflow-wrap:anywhere}
  .jv.k{font-weight:700}
  .jnote{border-top:1px solid var(--paper-rule);padding:.7mm 1.6mm;text-align:center;font-size:8.5pt;
         color:#3A3A3A;line-height:1.15}
`;

const LEGEND = 'Edits, oldest first: <del>removed words</del> · <ins>added words</ins>';

/** The same on every header: who, and when printed. */
export interface HistoryPrintContext {
  person: string;
  dept: string | null;
  printed: string;
}

const rawField = (label: string, html: string, key = false): string =>
  `<div class="jr"><span class="jl">${esc(label)}</span><span class="jv${key ? ' k' : ''}">${html}</span></div>`;

export const field = (label: string, value: string | number, key = false): string =>
  rawField(label, esc(String(value)), key);

export const column = (title: string, labelWidth: string, rows: readonly string[]): string =>
  `<div class="jg" style="--jlw:${labelWidth}"><div class="jt">${esc(title)}</div>${rows.join('')}</div>`;

/** The name bar over the titled columns; the My Day Log print uses it too. */
export function nameAndColumns(ctx: HistoryPrintContext, columns: readonly string[]): string {
  const sub = `${ctx.dept ? `${ctx.dept} · ` : ''}Printed ${ctx.printed}`;
  return `<div class="jnb"><span class="jnb-name">${esc(ctx.person)}</span><span class="jnb-sub">${esc(sub)}</span></div><div class="jcols">${columns.join('')}</div>`;
}

function headerCell(ctx: HistoryPrintContext, columns: readonly string[], note = ''): string {
  return td(GRID, `${nameAndColumns(ctx, columns)}${note}`, 'block');
}

/** The first page of a range. Later pages of this part repeat it (FIRST_KEY). */
export function rangeHeaderRow(h: DayLogHistory, ctx: HistoryPrintContext): string {
  const t = h.totals;
  const period = column('Period', '24mm', [
    field('From Date', fmtDate(h.from), true),
    field('To Date', fmtDate(h.to), true),
    field('Working Days', t.workingDays),
    field('Sunday / Holiday', t.offDays),
    ...(t.leaveDays > 0 ? [field('Leave', t.leaveDays)] : []),
  ]);
  const work = column('Work', '33mm', [
    field('Total Entry Days', t.filledDays, true),
    field('Not Entered', t.notEntered, t.notEntered > 0),
    field('Entries', t.entries),
    field('Total Working Hours', fmtDuration(t.workMin), true),
    field('Avg Daily Working Hours', fmtDuration(t.avgDailyWorkMin), true),
    // Break and Others: only old rows have them, so only when above 0.
    ...(t.breakMin > 0 ? [field('Break', fmtDuration(t.breakMin))] : []),
    ...(t.leaveMin > 0 ? [field('Others', fmtDuration(t.leaveMin))] : []),
  ]);
  const changes = column('Changes', '20mm', [
    field('Edited Entries', t.editedEntries, true),
    field('Edits', t.edits),
    field('Replies', t.replies),
    field('Saved Later', t.savedLater),
  ]);
  return tr(headerCell(ctx, [period, work, changes]), { headFor: FIRST_KEY });
}

/** The top of one date's part. A sign row always follows it, hence keepNext. */
export function dateHeaderRow(
  d: DayLogHistoryDay,
  dayKey: string,
  ctx: HistoryPrintContext,
): string {
  const has = d.entries.length > 0;
  const date = column('Date', '18mm', [
    field('Date', fmtDate(d.date), true),
    field('Day', weekdayName(d.date)),
    field('Status', statusText(d)),
    rawField('Page', pageRef(dateAnchor(d.date))),
  ]);
  const work = column('Work', '22mm', [
    field('First Start', has ? fmt12(d.firstStart) : ''),
    field('Last Stop', has ? fmt12(d.lastStop) : ''),
    field('Entries', d.entryCount),
    field('Working Hours', fmtDuration(d.workMin), true),
    ...(d.breakMin > 0 ? [field('Break', fmtDuration(d.breakMin))] : []),
    ...(d.leaveMin > 0 ? [field('Others', fmtDuration(d.leaveMin))] : []),
  ]);
  const changes = column('Changes', '20mm', [
    field('Edited Entries', d.editedEntries),
    field('Edits', d.edits),
    field('Replies', d.replies),
    field('Saved Later', d.savedLater),
  ]);
  const note = has ? `<div class="jnote">${LEGEND}</div>` : '';
  return tr(headerCell(ctx, [date, work, changes], note), {
    pageBreak: true,
    keepNext: true,
    headFor: dayKey,
    anchor: dateAnchor(d.date),
  });
}
