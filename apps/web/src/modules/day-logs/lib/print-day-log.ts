// Day Log print — on the Innovic Sheet (sheet-print.ts: letterhead, Times,
// one table, no box-in-box): header rows User / Department / Date, the
// entry table (the screen's columns: Sr No · Start Time · Stop Time · Working
// Hours · SO / JWSO · Working On — full text), a totals row from the server's
// summary, and the "Logged by" / "Seen by (Department Admin)" line. The
// person page (its own columns, Entry Rev ones for a Super Admin only) and the
// Team Day Logs table print the same way.

import type { Company, DayLogDetail, DayLogPersonDay, TeamDayLogResponse } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { buildDocCompany } from '@/lib/print/company';
import { esc } from '@/lib/print/doc-print';
import { openSheetHtmlWindow, sheetLetterheadHtml } from '@/lib/print/sheet-print';
import { DAY_NUM_KEYS, dayTable, personDayTable, teamTable, type ExportTable } from './export';

const DL_STYLE = `
  table.dl{width:100%;border-collapse:collapse;font-size:10pt}
  table.dl th,table.dl td{border:1px solid var(--paper-rule);padding:1.3mm 2.2mm;vertical-align:top;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}
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

/** User / Department / Date header rows over a table `span` columns wide. */
function headerRows(rows: string[][], span: number): string {
  const half = Math.floor(span / 2);
  return rows
    .map(
      ([a, b, c, d]) =>
        `<tr><td class="k">${esc(a ?? '')}</td><td colspan="${half - 1}">${esc(b ?? '')}</td><td class="k">${esc(c ?? '')}</td><td colspan="${span - half - 1}">${esc(d ?? '')}</td></tr>`,
    )
    .join('');
}

function signRow(userName: string, span: number): string {
  const half = Math.floor(span / 2);
  return `<tr><td colspan="${half}" class="sign">Logged by: ${esc(userName)}</td>
    <td colspan="${span - half}" class="sign">Seen by (Department Admin):</td></tr>`;
}

export function printDayLog(day: DayLogDetail, company: Company | null | undefined): boolean {
  const s = day.summary;
  const t = dayTable(day);
  const span = t.columns.length;
  const header = headerRows(
    [
      ['User', day.userName, 'Date', fmtDate(day.date)],
      ['Department', day.deptLabel ?? '—', 'Entries', String(s.entryCount)],
    ],
    span,
  );
  const table = grid(t, DAY_NUM_KEYS, ['order_code']);
  // Working Hours is the 4th column: the label spans the three before it.
  const hoursAt = t.columns.findIndex((c) => c.key === 'work_hours');
  const totals = `<tr><td colspan="${hoursAt}" class="b">Working hours</td>
    <td class="r b">${esc(fmtDuration(s.workMin))}</td>
    <td colspan="${span - hoursAt - 1}">First start ${esc(fmt12(s.firstStart))} · Last stop ${esc(fmt12(s.lastStop))}</td></tr>`;
  const html = wrap(company, 'Day Log', header + table + totals + signRow(day.userName, span));
  const name = `Day Log ${day.userName} ${day.date}`;
  return openSheetHtmlWindow(name, html, DL_STYLE, undefined, name);
}

export function printPersonDay(p: DayLogPersonDay, company: Company | null | undefined): boolean {
  const t = personDayTable(p);
  const span = t.columns.length;
  // No day total here: person-day entries carry no kind, and only work rows
  // count as Working hours (summarizeDay) — a sum of every row would disagree
  // with My Day Log and Team Day Logs (code review, ADR-255).
  const header = headerRows(
    [
      ['User', p.userName, 'Date', fmtDate(p.date)],
      ['Department', p.deptLabel ?? '—', 'Entries', String(p.entries.length)],
    ],
    span,
  );
  const html = wrap(
    company,
    'Day Log',
    header + grid(t, DAY_NUM_KEYS, ['order_code']) + signRow(p.userName, span),
  );
  const name = `Day Log ${p.userName} ${p.date}`;
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
    head + grid(t, ['work_hours', 'entries', 'late'], ['user']),
  );
  const name = `Team Day Logs ${team.date}`;
  return openSheetHtmlWindow(name, html, DL_STYLE, undefined, name);
}
