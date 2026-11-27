// SO / JWSO status by day (ADR-325) — Excel and print. Both write exactly what
// the screen shows: the server's figures, "—" / an empty cell where no copy was
// saved (never 0). Print is the Innovic Sheet (sheet-print.ts), as Day Log.

import {
  type Company,
  type OrderStatusFigures,
  type OrderStatusRow,
  type OrderStatusSummary,
  type SoJwsoStatusDayDetail,
  ORDER_STATUS_FIGURE_KEYS,
  ORDER_STATUS_FIGURE_LABELS,
} from '@innovic/shared';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { type ExcelCell, postExportLog, writeWorkbook } from '@/lib/excel-export';
import { buildDocCompany } from '@/lib/print/company';
import { fmtQty } from '@/lib/qty-format';
import { esc } from '@/lib/print/doc-print';
import { openSheetHtmlWindow, sheetLetterheadHtml } from '@/lib/print/sheet-print';
import {
  type DayRow,
  type DaysRange,
  type WeekGroup,
  dayNote,
  figureText,
  figureValue,
  sourceNote,
  sumFigure,
  weekdayShort,
  weekHeading,
} from './days';

export const REPORT_TITLE = 'SO / JWSO Status';
const FIG_HEADS = ORDER_STATUS_FIGURE_KEYS.map((k) => ORDER_STATUS_FIGURE_LABELS[k]);

export function rangeText(r: DaysRange): string {
  return `${fmtDate(r.from)} to ${fmtDate(r.to)} · ${r.mode === 'weekEnd' ? 'Week end only' : 'Every day'}`;
}

export function dayTitle(date: string): string {
  return `SO / JWSO status on ${weekdayShort(date)} ${fmtDate(date)}`;
}

const figCells = (f: OrderStatusFigures | null): ExcelCell[] =>
  ORDER_STATUS_FIGURE_KEYS.map((k) => figureValue(f, k));

/* ---------- Excel ---------- */

/** The days list → one sheet "SO JWSO by day". False when the user cancelled. */
export async function exportDaysExcel(rows: readonly DayRow[], range: DaysRange): Promise<boolean> {
  const data: ExcelCell[][] = rows.map((r) => [
    fmtDate(r.date),
    r.kind,
    r.summary?.orders ?? null,
    ...figCells(r.summary),
  ]);
  const saved = await writeWorkbook(REPORT_TITLE, [
    {
      name: 'SO JWSO by day',
      title: [REPORT_TITLE, rangeText(range)],
      header: ['Date', 'Type', 'Orders', ...FIG_HEADS],
      rows: data,
    },
  ]);
  if (!saved) return false;
  void postExportLog({
    listTitle: REPORT_TITLE,
    rowCount: data.length,
    filterSummary: rangeText(range),
  });
  return true;
}

function orderSheet(
  name: string,
  noHead: string,
  rows: readonly OrderStatusRow[],
  total: OrderStatusSummary | null,
  title: string[],
) {
  const body: ExcelCell[][] = rows.map((r, i) => [i + 1, r.orderCode, ...figCells(r)]);
  if (rows.length > 0) {
    const sums = ORDER_STATUS_FIGURE_KEYS.map((k) =>
      total ? total[k] : sumFigure(rows, (x) => x, k),
    );
    body.push(['Total', null, ...sums]);
  }
  return { name, title, header: ['Sr No', noHead, ...FIG_HEADS], rows: body };
}

/** One day → sheets "SO wise summary" and "JWSO wise summary". */
export async function exportDayExcel(d: SoJwsoStatusDayDetail): Promise<boolean> {
  const title = [dayTitle(d.date), sourceLine(d)];
  const saved = await writeWorkbook(`${REPORT_TITLE} ${d.date}`, [
    orderSheet('SO wise summary', 'SO No.', d.soRows, d.soTotal, title),
    orderSheet('JWSO wise summary', 'JWSO No.', d.jwsoRows, d.jwsoTotal, title),
  ]);
  if (!saved) return false;
  void postExportLog({
    listTitle: REPORT_TITLE,
    rowCount: d.soRows.length,
    lineCount: d.jwsoRows.length,
    filterSummary: `${fmtDate(d.date)} · ${sourceNote(d)}`,
  });
  return true;
}

/** "Live" or "Saved at 11:50 PM". */
export function sourceLine(d: {
  source: SoJwsoStatusDayDetail['source'];
  takenAt: string | null;
}): string {
  const note = sourceNote(d);
  if (d.source === 'saved') return note.replace('saved', 'Saved at');
  return note.charAt(0).toUpperCase() + note.slice(1);
}

/* ---------- Print ---------- */

const PRINT_STYLE = `
  table.sjs{width:100%;border-collapse:collapse;font-size:8.5pt}
  table.sjs th,table.sjs td{border:1px solid var(--paper-rule);padding:1mm 1.4mm;vertical-align:top;text-align:left}
  table.sjs th{font-family:var(--f-label);font-weight:700;background:var(--paper-band)}
  table.sjs .ctr{text-align:center;font-variant-numeric:tabular-nums}
  table.sjs tr.wk td{font-weight:700;background:var(--paper-band)}
  table.sjs tr.tot td{font-weight:700}
  h3.sjs-h{font-size:10.5pt;margin:4mm 0 1.5mm}
  p.sjs-foot{margin:2mm 0 0;font-size:8.5pt}
`;

const numTds = (f: OrderStatusFigures | null): string =>
  ORDER_STATUS_FIGURE_KEYS.map((k) => `<td class="ctr">${esc(figureText(f, k))}</td>`).join('');

const headRow = (lead: string[]): string =>
  `<tr>${lead.map((h, i) => `<th${i === 0 ? ' class="ctr"' : ''}>${esc(h)}</th>`).join('')}${FIG_HEADS.map((h) => `<th class="ctr">${esc(h)}</th>`).join('')}</tr>`;

function sheet(
  company: Company | null | undefined,
  title: string,
  sub: string,
  body: string,
): string {
  const letterhead = sheetLetterheadHtml({ name: buildDocCompany(company).name, title });
  return `<article class="sheet">${letterhead}
    <p class="sjs-foot">${esc(sub)}</p>
    ${body}
    <p class="sjs-foot">Printed ${esc(fmtDateTime(new Date().toISOString()))} · Innovic ERP</p>
  </article>`;
}

/** The days list, week headings included. False when the pop-up was blocked. */
export function printDays(
  rows: readonly DayRow[],
  weeks: ReadonlyMap<string, WeekGroup>,
  range: DaysRange,
  company: Company | null | undefined,
): boolean {
  const cols = 3 + FIG_HEADS.length;
  let lastWeek = '';
  const body = rows
    .map((r) => {
      const w = weeks.get(r.weekKey);
      const head =
        r.weekKey !== lastWeek && w
          ? `<tr class="wk"><td colspan="${cols}">${esc(weekHeading(w))}</td></tr>`
          : '';
      lastWeek = r.weekKey;
      const dateCell = r.kind === 'SO' ? fmtDate(r.date) : dayNote(r.day);
      const orders = r.summary ? String(r.summary.orders) : '—';
      return `${head}<tr><td class="ctr">${esc(dateCell)}</td><td>${esc(r.kind)}</td><td class="ctr">${esc(orders)}</td>${numTds(r.summary)}</tr>`;
    })
    .join('');
  const html = sheet(
    company,
    REPORT_TITLE,
    rangeText(range),
    `<table class="sjs"><tbody>${headRow(['Date', 'Type', 'Orders'])}${body}</tbody></table>`,
  );
  const name = `${REPORT_TITLE} ${range.from} to ${range.to}`;
  return openSheetHtmlWindow(name, html, PRINT_STYLE, undefined, name);
}

function orderTable(
  heading: string,
  noHead: string,
  rows: readonly OrderStatusRow[],
  total: OrderStatusSummary | null,
): string {
  const body = rows
    .map((r, i) => `<tr><td class="ctr">${i + 1}</td><td>${esc(r.orderCode)}</td>${numTds(r)}</tr>`)
    .join('');
  // The server's total; summed from the rows only if it did not send one.
  const tot =
    rows.length > 0
      ? `<tr class="tot"><td colspan="2">Total</td>${ORDER_STATUS_FIGURE_KEYS.map(
          (k) =>
            `<td class="ctr">${esc(total ? figureText(total, k) : fmtQty(sumFigure(rows, (x) => x, k)))}</td>`,
        ).join('')}</tr>`
      : '';
  return `<h3 class="sjs-h">${esc(`${heading} (${rows.length})`)}</h3>
    <table class="sjs"><tbody>${headRow(['Sr No', noHead])}${body}${tot}</tbody></table>`;
}

/** One day: the SO table, then the JWSO table. */
export function printDay(d: SoJwsoStatusDayDetail, company: Company | null | undefined): boolean {
  const html = sheet(
    company,
    dayTitle(d.date),
    sourceLine(d),
    orderTable('1. SO wise summary', 'SO No.', d.soRows, d.soTotal) +
      orderTable('2. JWSO wise summary', 'JWSO No.', d.jwsoRows, d.jwsoTotal),
  );
  const name = `${REPORT_TITLE} ${d.date}`;
  return openSheetHtmlWindow(name, html, PRINT_STYLE, undefined, name);
}
