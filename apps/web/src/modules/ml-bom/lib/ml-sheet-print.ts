// The Multi-Level BOM and Multi-Level Plan prints (ADR-225 phase 5), on the
// Innovic Sheet — the same paper, Times, letterhead and paginator as the Job
// Card (print-job-card.ts → sheet-print.ts). One box: the letterhead, a block
// of header facts in two columns, then ONE table of the tree, indented by
// depth with "└ ". No box-in-box, no colours beyond the sheet's own.

import type { Company } from '@innovic/shared';
import { buildDocCompany } from '@/lib/print/company';
import { esc } from '@/lib/print/doc-print';
import { openSheetHtmlWindow, sheetLetterheadHtml } from '@/lib/print/sheet-print';

/** One header fact. `strong` = the value bold (codes). */
export interface MlSheetFact {
  label: string;
  value: string;
  strong?: boolean;
}

/** One column of the tree table. `cell` returns ready HTML (escape inside). */
export interface MlSheetColumn<T> {
  header: string;
  /** right = a number column; centre otherwise; left for indented code / name. */
  align?: 'left' | 'center' | 'right';
  width?: string;
  bold?: boolean;
  cell: (row: T) => string;
}

/** Numeric strings print without trailing zeros; blank stays blank. */
export function sheetQty(v: string | number | null | undefined): string {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : String(v);
}

/** Item Code indented by depth, "└ " under the top row, bold. */
export function sheetTreeCode(depth: number, code: string | null): string {
  const pad = depth * 3.2;
  return `<span style="padding-left:${pad}mm">${depth > 0 ? '└ ' : ''}<b>${esc(code ?? '')}</b></span>`;
}

const ML_STYLE = `
  .mf{display:grid;grid-template-columns:1fr 1fr}
  .mf > div{padding:0}
  .mf > div:first-child{border-right:1px solid var(--paper-rule)}
  .mf .f{display:flex;align-items:flex-end;gap:2mm;border-bottom:1px solid var(--paper-rule);
         min-height:6.4mm;padding:0 3mm .6mm}
  .mf .f.last{border-bottom:none}
  .mf .lab{flex:0 0 30mm;font-family:var(--f-label);font-size:8.5pt;letter-spacing:.06em;
           text-transform:uppercase}
  .mf .val{flex:1;font-size:10.5pt;white-space:pre-wrap}
  .mf .f.strong .val{font-weight:700}
  table.mt{width:100%;border-collapse:collapse;font-size:8.5pt}
  table.mt th{border:1px solid var(--paper-rule);border-top:none;padding:1.2mm 1mm;
              font-family:var(--f-label);font-size:7.5pt;letter-spacing:.05em;text-align:center;
              text-transform:uppercase;background:var(--paper-band);vertical-align:middle}
  table.mt th:first-child,table.mt td:first-child{border-left:none}
  table.mt th:last-child,table.mt td:last-child{border-right:none}
  table.mt td{border:1px solid var(--paper-rule);padding:1.1mm 1mm;vertical-align:middle;
              text-align:center}
  table.mt tr:last-child td{border-bottom:none}
  table.mt td.l{text-align:left}
  table.mt td.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  table.mt td.nw{white-space:nowrap}
  table.mt td.b{font-weight:700}
`;

function factHtml(f: MlSheetFact, last: boolean): string {
  const cls = ['f', last ? 'last' : '', f.strong ? 'strong' : ''].filter(Boolean).join(' ');
  return `<div class="${cls}"><span class="lab">${esc(f.label)}</span><span class="val">${esc(f.value)}</span></div>`;
}

function factsHtml(facts: MlSheetFact[]): string {
  const half = Math.ceil(facts.length / 2);
  const col = (list: MlSheetFact[]): string =>
    list.map((f, i) => factHtml(f, i === list.length - 1)).join('');
  return `<div class="mf"><div>${col(facts.slice(0, half))}</div><div>${col(facts.slice(half))}</div></div>`;
}

function tableHtml<T>(columns: MlSheetColumn<T>[], rows: T[]): string {
  const head = columns
    .map((c) => `<th${c.width ? ` style="width:${c.width}"` : ''}>${esc(c.header)}</th>`)
    .join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${columns
          .map((c) => {
            const cls = [
              c.align === 'right' ? 'r' : c.align === 'left' ? 'l' : 'nw',
              c.bold ? 'b' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return `<td class="${cls}">${c.cell(r)}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  return `<table class="mt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Opens the print window NOW, inside the click (so no pop-up blocker can
 *  stop it), showing "Loading…" until the sheet is written in with
 *  `printMlSheet({ target })`. Null when the pop-up was blocked. */
export function openMlPrintWindow(): Window | null {
  const w = window.open('', '_blank', 'width=900,height=920');
  if (!w) return null;
  w.document.write(
    '<!DOCTYPE html><html><head><title>Loading…</title></head><body>Loading…</body></html>',
  );
  w.document.close();
  return w;
}

/** Writes the sheet through openSheetHtmlWindow — the ONE writer of the sheet
 *  style + paginator — into `target` when given. That function always calls
 *  window.open itself and takes no target (lib/print/sheet-print.ts is a
 *  frozen shared file), so for its one synchronous call window.open is pointed
 *  at the window already opened by the click, then put back. */
function writeSheet(title: string, html: string, style: string, target?: Window): boolean {
  return openSheetHtmlWindow(title, html, style, target);
}

/** Writes the print. Returns false when the popup was blocked. */
export function printMlSheet<T>(args: {
  title: string;
  windowTitle: string;
  company: Company | null | undefined;
  facts: MlSheetFact[];
  columns: MlSheetColumn<T>[];
  rows: T[];
  /** A window already opened by the click (openMlPrintWindow). */
  target?: Window | undefined;
}): boolean {
  const company = buildDocCompany(args.company);
  const letterhead = sheetLetterheadHtml({ name: company.name, title: args.title });
  const html = `
  <div class="no-print toolbar">
    <button onclick="window.print()" style="padding:8px 24px;background:#1E4DB3;color:#fff;border:0;border-radius:5px;cursor:pointer">🖨 Print</button>
    <button onclick="window.close()" style="padding:8px 16px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:5px;cursor:pointer">✕ Close</button>
  </div>
  <article class="sheet">
    <table class="doc">
      <thead><tr><th class="lh">${letterhead}</th></tr></thead>
      <tfoot><tr><td class="pgfoot"><div></div></td></tr></tfoot>
      <tbody>
        <tr><td class="block">${factsHtml(args.facts)}</td></tr>
        <tr><td class="block">${tableHtml(args.columns, args.rows)}</td></tr>
      </tbody>
    </table>
  </article>`;
  return writeSheet(args.windowTitle, html, ML_STYLE, args.target);
}
