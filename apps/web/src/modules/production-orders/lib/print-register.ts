// Production Orders master — Print / Download PDF register (owner request
// 2026-10-26). Same shape as the Customer Dispatch register print: header,
// count tiles, one table. The columns and cell values are the Excel export's
// (lib/export-excel.ts) so the sheet, the print and the list agree.

import {
  PRODUCTION_ORDER_STATUSES,
  PRODUCTION_ORDER_STATUS_LABEL,
  type Company,
  type ProductionOrderListItem,
} from '@innovic/shared';
import { esc } from '@/lib/print/doc-print';
import { printWindow, printedMeta } from '@/lib/print/print-window';
import { isProCancelled } from '../components/po-list-columns';
import { PRO_REGISTER_COLUMNS, PRO_REGISTER_NUM_COLS, proRegisterRow } from './export-excel';

export function printProductionOrderRegister(args: {
  rows: ProductionOrderListItem[];
  company: Company | null | undefined;
  /** Names the downloaded PDF; the title when omitted. */
  fileName?: string;
}): boolean {
  const { rows, company } = args;
  const live = rows.filter((po) => !isProCancelled(po));
  const count = (s: ProductionOrderListItem['status']): number =>
    live.filter((po) => po.status === s).length;
  const tiles: [string, number][] = [
    ['Total', rows.length],
    ...PRODUCTION_ORDER_STATUSES.map((st): [string, number] => [
      PRODUCTION_ORDER_STATUS_LABEL[st],
      count(st),
    ]),
    ['Cancelled', rows.length - live.length],
  ];

  // Numbers right-aligned; every short value stays on one line, only Item
  // Name (index 4) may wrap so sixteen columns fit a landscape page.
  const align = (i: number): string =>
    ` style="${PRO_REGISTER_NUM_COLS.has(i) ? 'text-align:right;' : ''}${i === 4 ? '' : 'white-space:nowrap'}"`;
  const head = PRO_REGISTER_COLUMNS.map((h, i) => `<th${align(i)}>${esc(h)}</th>`).join('');
  const body = rows
    .map(
      (po, ri) =>
        `<tr>${proRegisterRow(po, ri + 1)
          .map((v, i) => `<td${align(i)}>${esc(String(v === '' ? '—' : v))}</td>`)
          .join('')}</tr>`,
    )
    .join('');

  const html = `
    <style>@media print{@page{size:A4 landscape}}</style>
    <div class="doc-title"><h1>PRODUCTION ORDERS</h1><span class="print-meta">${printedMeta()}</span></div>
    <div class="info-grid" style="grid-template-columns:repeat(${tiles.length},1fr)">
      ${tiles
        .map(
          ([lbl, n]) =>
            `<div class="info-box"><div class="info-lbl">${esc(lbl)}</div><div class="info-val">${n}</div></div>`,
        )
        .join('')}
    </div>
    <table><thead><tr>${head}</tr></thead>
    <tbody>${body || `<tr><td colspan="${PRO_REGISTER_COLUMNS.length}" style="text-align:center">No Production Orders</td></tr>`}</tbody></table>`;

  return printWindow({
    title: 'Production Orders',
    body: html,
    company,
    ...(args.fileName ? { fileName: args.fileName } : {}),
  });
}
