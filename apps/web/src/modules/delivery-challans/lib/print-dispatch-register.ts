// Dispatch Register print (Print Templates P3, ADR-034). Mirrors legacy
// `printDispatchRegister` (`legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`
// L10789): a fixed-layout document (NOT a template-editor doc) rendered via the
// shared `printWindow` util. The legacy info-grid (Total Dispatched / Dispatch
// Entries / Items Dispatched) + table of dispatch rows + 3-cell signature row
// are reproduced here.
//
// DATA-MODEL (ADR-261, 2026-10-31): the list is now ONE ROW PER DC LINE, so
// the register prints the line rows the list page loaded for the CURRENT
// filter/page (no extra fetch) — DC no / date / vendor / PO / SO (+ Internal SO
// No. + POL) / item code (CODE/REV) / sent qty / status — and the page's
// `summary` for the KPI tiles.

import type { Company, DcStatus, DeliveryChallanListLine, DispatchSummary } from '@innovic/shared';
import { itemCodeWithRev } from '@/lib/item-code';
import { esc, fmtDate } from '@/lib/print/doc-print';
import { printWindow, printedMeta } from '@/lib/print/print-window';
import { DC_STATUS_LABEL } from './dc-status-label';

// The real DC statuses (DC_STATUSES) — same colours as DcStatusBadge on screen.
// The old map carried open / partially_received, which no challan ever has.
const STATUS_BADGE: Record<DcStatus, string> = {
  issued: 'b-amber',
  received: 'b-green',
  cancelled: 'b-grey',
};

function statusBadge(status: string): string {
  const cls = STATUS_BADGE[status as DcStatus] ?? 'b-grey';
  const label = DC_STATUS_LABEL[status as DcStatus] ?? status.replaceAll('_', ' ');
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

export function printDispatchRegister(args: {
  rows: DeliveryChallanListLine[];
  summary: DispatchSummary;
  // Optional filter context shown under the title (search / status / dates).
  filterLabel?: string;
  company: Company | null | undefined;
}): boolean {
  const { rows, summary, filterLabel, company } = args;

  // The SO No. column prints only when at least one row has an SO / JWSO —
  // an OSP DC often has none, and a column of "—" on every row is noise.
  // ADR-207: the Internal SO No. (and the POL) ride under the order number.
  const soOf = (d: DeliveryChallanListLine): string | null => d.soCode ?? d.jwCode;
  const showSo = rows.some((d) => Boolean(soOf(d)));
  const tableRows = rows
    .map(
      (d) => `<tr>
      <td style="font-family:monospace;color:#0369a1;font-weight:700">${esc(d.docCode)}</td>
      <td>${esc(fmtDate(d.docDate))}</td>
      <td>${esc(d.vendorName ?? d.vendorCodeText ?? '—')}</td>
      <td style="font-family:monospace">${esc(d.poCode ?? d.poCodeText ?? '—')}</td>
      ${showSo ? `<td style="font-family:monospace;font-size:10px">${esc(soOf(d) ?? '—')}${d.soInternalNo ? `<div style="font-family:inherit;color:#64748b">Internal SO No. ${esc(d.soInternalNo)}</div>` : ''}${d.clientPoLineNo ? `<div style="font-family:inherit;color:#64748b">POL ${esc(d.clientPoLineNo)}</div>` : ''}</td>` : ''}
      <td style="font-family:monospace;font-weight:700">${esc(itemCodeWithRev(d.itemCode, d.itemRevision))}</td>
      <td style="text-align:right;font-weight:700">${Number(d.qty).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
      <td style="text-align:center">${statusBadge(d.docStatus)}</td>
    </tr>`,
    )
    .join('');

  const totalQty = summary.totalDispatched.toLocaleString('en-IN', { maximumFractionDigits: 2 });

  const body = `
    <div class="doc-title"><h1>DC REGISTER</h1><span class="print-meta">${printedMeta()}</span></div>
    ${
      filterLabel
        ? `<div style="font-size:11px;color:#666;margin:-6px 0 12px">Filter: ${esc(filterLabel)}</div>`
        : ''
    }
    <div class="info-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="info-box"><div class="info-lbl">Total Sent to Vendor</div><div class="info-val" style="font-size:20px">${totalQty} pcs</div></div>
      <div class="info-box"><div class="info-lbl">DC Entries</div><div class="info-val">${summary.entryCount}</div></div>
      <div class="info-box"><div class="info-lbl">Items Sent</div><div class="info-val">${summary.itemCount}</div></div>
    </div>
    <table><thead><tr><th>DC No.</th><th>DC Date</th><th>Vendor</th><th>PO No.</th>${showSo ? '<th>SO No.</th>' : ''}<th>Item Code</th><th>Sent Qty</th><th>DC Status</th></tr></thead>
    <tbody>${tableRows || `<tr><td colspan="${showSo ? 8 : 7}" style="text-align:center;color:#aaa">No DC lines</td></tr>`}</tbody></table>
    <div class="sign-row">
      <div class="sign-box">Store In-Charge</div>
      <div class="sign-box">Purchase</div>
      <div class="sign-box">Authorised By</div>
    </div>`;

  return printWindow({ title: 'DC Register', body, company });
}
