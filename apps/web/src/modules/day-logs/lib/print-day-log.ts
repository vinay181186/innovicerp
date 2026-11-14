// Day Log list prints on the Innovic Sheet (sheet-print.ts: letterhead, Times, one
// table, no box-in-box): the Team Day Logs table and Pending Entries. One person's
// day prints in print-my-day-log.ts or print-day-log-history.ts (ADR-288).

import type { Company, DayLogPendingResponse, TeamDayLogResponse } from '@innovic/shared';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { buildDocCompany } from '@/lib/print/company';
import { esc } from '@/lib/print/doc-print';
import { openSheetHtmlWindow, sheetLetterheadHtml } from '@/lib/print/sheet-print';
import { pendingTable, teamTable, type ExportTable } from './export';

const DL_STYLE = `
  table.dl{width:100%;border-collapse:collapse;font-size:10pt}
  table.dl th,table.dl td{border:1px solid var(--paper-rule);padding:1.3mm 2.2mm;vertical-align:top;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}
  table.dl th{font-family:var(--f-label);font-weight:700;background:var(--paper-band)}
  table.dl td.k{font-weight:700;width:18%}
  table.dl .ctr{text-align:center;font-variant-numeric:tabular-nums}
  table.dl .b{font-weight:700}
  p.dl-foot{margin:2mm 0 0;font-size:8.5pt}
`;

function grid(t: ExportTable, centreKeys: readonly string[], boldKeys: readonly string[]): string {
  const head = t.columns
    .map((c) => `<th${centreKeys.includes(c.key) ? ' class="ctr"' : ''}>${esc(c.label)}</th>`)
    .join('');
  const body = t.rows
    .map((r) => {
      const cells = t.columns.map((c) => {
        const cls = [centreKeys.includes(c.key) ? 'ctr' : '', boldKeys.includes(c.key) ? 'b' : '']
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

export function printPendingEntries(
  data: DayLogPendingResponse,
  company: Company | null | undefined,
): boolean {
  const t = pendingTable(data.rows);
  const head = `<tr><td class="k">As on</td><td colspan="${t.columns.length - 1}">${esc(fmtDate(data.today))}</td></tr>`;
  const html = wrap(
    company,
    'Pending Entries',
    head + grid(t, ['sr_no', 'pending_date', 'week_day', 'days_pending', 'reply_state'], ['user']),
  );
  const name = `Pending Entries ${data.today}`;
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
    head + grid(t, ['first_start', 'last_stop', 'work_hours', 'entries'], ['user']),
  );
  const name = `Team Day Logs ${team.date}`;
  return openSheetHtmlWindow(name, html, DL_STYLE, undefined, name);
}
