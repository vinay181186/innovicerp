// Day Log print — on the Innovic Sheet (sheet-print.ts: letterhead, Times,
// one table, no box-in-box): header rows User / Department / Date / Day
// Status, the entry table (the screen's columns + Remark), a totals row from
// the server's summary, and the "Logged by" / "Seen by (Department Admin)"
// line. The Team Day Logs table prints the same way.

import type { Company, DayLogDetail, TeamDayLogResponse } from '@innovic/shared';
import { fmtDuration } from '@innovic/shared';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { buildDocCompany } from '@/lib/print/company';
import { esc } from '@/lib/print/doc-print';
import { openSheetHtmlWindow, sheetLetterheadHtml } from '@/lib/print/sheet-print';
import { dayTable, teamTable, type ExportTable } from './export';
import { dayStatusLabel } from './format';

const DL_STYLE = `
  table.dl{width:100%;border-collapse:collapse;font-size:10pt}
  table.dl th,table.dl td{border:1px solid var(--paper-rule);padding:1.3mm 2.2mm;vertical-align:top;text-align:left}
  table.dl th{font-family:var(--f-label);font-weight:700;background:var(--paper-band)}
  table.dl td.k{font-weight:700;width:18%}
  table.dl .r{text-align:right;font-variant-numeric:tabular-nums}
  table.dl .b{font-weight:700}
  table.dl td.sign{height:18mm;vertical-align:bottom}
  p.dl-foot{margin:2mm 0 0;font-size:8.5pt}
`;

function grid(t: ExportTable, numKeys: readonly string[], boldKeys: readonly string[]): string {
  const head = t.columns
    .map((c) => `<th${numKeys.includes(c.key) ? ' class="r"' : ''}>${esc(c.label)}</th>`)
    .join('');
  const body = t.rows
    .map((r) => {
      const cells = t.columns.map((c) => {
        const cls = [numKeys.includes(c.key) ? 'r' : '', boldKeys.includes(c.key) ? 'b' : '']
          .filter(Boolean)
          .join(' ');
        return `<td${cls ? ` class="${cls}"` : ''}>${esc(r[c.key] ?? '')}</td>`;
      });
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
  return `<tr>${head}</tr>${body}`;
}

function wrap(company: Company | null | undefined, title: string, rows: string): string {
  const letterhead = sheetLetterheadHtml({ name: buildDocCompany(company).name, title });
  return `<article class="sheet">${letterhead}
    <table class="dl"><tbody>${rows}</tbody></table>
    <p class="dl-foot">Printed ${esc(fmtDateTime(new Date().toISOString()))} · Innovic ERP</p>
  </article>`;
}

function dayStatusText(day: DayLogDetail): string {
  const base = dayStatusLabel(day.status);
  if (day.status === 'submitted' && day.submittedAt)
    return `${base} ${fmtDateTime(day.submittedAt)}`;
  return base;
}

export function printDayLog(day: DayLogDetail, company: Company | null | undefined): boolean {
  const s = day.summary;
  const t = dayTable(day);
  const span = t.columns.length;
  const half = Math.floor(span / 2);
  const header = [
    ['User', day.userName, 'Date', fmtDate(day.date)],
    ['Department', day.deptLabel ?? '—', 'Day Status', dayStatusText(day)],
  ]
    .map(
      ([a, b, c, d]) =>
        `<tr><td class="k">${esc(a ?? '')}</td><td colspan="${half - 1}">${esc(b ?? '')}</td><td class="k">${esc(c ?? '')}</td><td colspan="${span - half - 1}">${esc(d ?? '')}</td></tr>`,
    )
    .join('');
  const table = grid(t, ['time'], []);
  const totals = `<tr><td colspan="2" class="b">Working hours</td>
    <td class="r b">${esc(fmtDuration(s.workMin))}</td>
    <td colspan="${span - 3}">Break ${esc(String(s.breakMin))} min · First start ${esc(s.firstStart ?? '—')} · Last stop ${esc(s.lastStop ?? '—')} · Late entries ${esc(String(s.lateCount))}</td></tr>`;
  const sign = `<tr><td colspan="${half}" class="sign">Logged by: ${esc(day.userName)}</td>
    <td colspan="${span - half}" class="sign">Seen by (Department Admin):</td></tr>`;
  const html = wrap(company, 'Day Log', header + table + totals + sign);
  const name = `Day Log ${day.userName} ${day.date}`;
  return openSheetHtmlWindow(name, html, DL_STYLE, undefined, name);
}

export function printTeamDayLogs(
  team: TeamDayLogResponse,
  company: Company | null | undefined,
): boolean {
  const t = teamTable(team);
  const head = `<tr><td class="k">Date</td><td colspan="${t.columns.length - 1}">${esc(fmtDate(team.date))}</td></tr>`;
  const html = wrap(
    company,
    'Team Day Logs',
    head + grid(t, ['work_hours', 'break_min', 'entries'], ['user']),
  );
  const name = `Team Day Logs ${team.date}`;
  return openSheetHtmlWindow(name, html, DL_STYLE, undefined, name);
}
