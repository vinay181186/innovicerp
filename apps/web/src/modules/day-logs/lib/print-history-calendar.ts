// Day Log History PDF (ADR-278): the calendar on the first page of a range. One
// grid per month touched by From Date to To Date, Sunday first, full weeks. Every
// figure and state is the server's day; this only places them. Each pair of months
// is one row of the sheet's table, so the paginator moves it whole.

import type { DayLogHistory, DayLogHistoryDay } from '@innovic/shared';
import { fmtDuration } from '@innovic/shared';
import { esc } from '@/lib/print/doc-print';
import { monthLabel, shiftDate, WEEKDAYS } from './format';
import { FIRST_KEY, GRID, td, tr } from './print-history-cells';

export const CALENDAR_STYLE = `
  table.doc > tbody > tr.sect-cal > td{border-bottom:0}
  table.doc > tbody > tr.calr > td{border:0;padding:0 0 2mm}
  .cals{display:grid;grid-template-columns:1fr 1fr;column-gap:4mm}
  .cals.one{grid-template-columns:1fr}
  .calm{min-width:0}
  .mon{font-weight:700;font-size:9pt;padding-bottom:.5mm}
  .cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));
       border-top:1px solid var(--paper-rule);border-left:1px solid var(--paper-rule)}
  .cal > div{border-right:1px solid var(--paper-rule);border-bottom:1px solid var(--paper-rule);min-width:0}
  .dow{font-weight:700;font-size:8.5pt;background:var(--paper-band);text-align:center;padding:.3mm}
  .cd{min-height:8.5mm;padding:.3mm .8mm;line-height:1.12}
  .cd-n{display:block;font-weight:700;font-size:9pt}
  .cd-h{display:block;font-weight:700;font-size:8pt;white-space:nowrap}
  .cd-e{display:block;font-size:8pt}
  .cd.ne{background:#D9D9D9;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .cd.off{font-style:italic}
  .cd.out{color:#8A8A8A}
  .cd.out .cd-n{font-weight:400}
`;

const WEEK_LENGTH = 7;

/** The months touched, as YYYY-MM. The 28th + 4 days is always in the next month. */
function monthsOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = shiftDate(`${m}-28`, 4).slice(0, 7)) {
    out.push(m);
  }
  return out;
}

/** The line under the date number: [cell class, line class, words]. */
function dayLine(d: DayLogHistoryDay): [string, string, string] {
  const hours: [string, string, string] = ['', 'cd-h', fmtDuration(d.workMin)];
  switch (d.state) {
    case 'filled':
      return hours;
    case 'today':
      return d.entries.length > 0 ? hours : ['', 'cd-e', 'Today'];
    case 'not_entered':
      return [' ne', 'cd-h', 'N/E'];
    case 'sunday':
      return [' off', 'cd-e', 'Sunday'];
    case 'holiday':
      return [' off', 'cd-e', 'Holiday'];
    case 'leave':
      return ['', 'cd-e', 'Leave'];
    case 'not_counted':
      return ['', 'cd-e', 'Not counted'];
  }
}

function dateCell(date: string, h: DayLogHistory, byDate: Map<string, DayLogHistoryDay>): string {
  const num = `<span class="cd-n">${Number(date.slice(8))}</span>`;
  const d = byDate.get(date);
  if (!d || date < h.from || date > h.to) return `<div class="cd out">${num}</div>`;
  const [cellClass, lineClass, words] = dayLine(d);
  return `<div class="cd${cellClass}">${num}<span class="${lineClass}">${esc(words)}</span></div>`;
}

function monthHtml(month: string, h: DayLogHistory, byDate: Map<string, DayLogHistoryDay>): string {
  const first = `${month}-01`;
  const leading = new Date(`${first}T00:00:00Z`).getUTCDay();
  const cells: string[] = [];
  for (let date = first; date.startsWith(month); date = shiftDate(date, 1)) {
    cells.push(dateCell(date, h, byDate));
  }
  const trailing = (WEEK_LENGTH - ((leading + cells.length) % WEEK_LENGTH)) % WEEK_LENGTH;
  const empty = '<div class="cd"></div>';
  const head = WEEKDAYS.map((w) => `<div class="dow">${w}</div>`).join('');
  return `<div class="calm"><div class="mon">${esc(monthLabel(month))}</div><div class="cal">${head}${empty.repeat(leading)}${cells.join('')}${empty.repeat(trailing)}</div></div>`;
}

/** One month: full width. Several: two side by side per row; a lone last month
 *  stays half width. */
export function calendarRows(h: DayLogHistory): string {
  const byDate = new Map(h.days.map((d) => [d.date, d]));
  const months = monthsOf(h.from, h.to);
  const cls = months.length === 1 ? 'cals one' : 'cals';
  const rows: string[] = [];
  for (let i = 0; i < months.length; i += 2) {
    const pair = months.slice(i, i + 2).map((m) => monthHtml(m, h, byDate));
    rows.push(
      tr(td(GRID, `<div class="${cls}">${pair.join('')}</div>`), {
        cls: 'calr',
        carry: FIRST_KEY,
      }),
    );
  }
  return rows.join('');
}
