// Dispatch Register print (Print Templates P3, ADR-034). Mirrors legacy
// `printDispatchRegister` (`legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`
// L10789): a fixed-layout document (NOT a template-editor doc) rendered via the
// shared `printWindow` util. The legacy info-grid (Total Dispatched / Dispatch
// Entries / Items Dispatched) + table of dispatch rows + 3-cell signature row
// are reproduced here.
//
// DATA-MODEL DELTA vs legacy: legacy iterated `db.dispatchLog` — one row per
// dispatched *item line* (date / soNo / clientPoLineNo / itemCode / qty /
// customer / dispatchedBy / remarks). The new model has DC *headers* with
// per-header aggregates (vendor, PO, SO, lineCount, totalQty). This print
// renders the DC-header rows the list page already loaded for the CURRENT
// filter/page (no new endpoint), and uses the page's dispatch `summary` for the
// KPI tiles. Per-line columns (clientPoLineNo / dispatchedBy / per-item code)
// are not available at the header grain, so the table shows the header-grain
// columns the list exposes (DC no / date / vendor / PO / SO / lines / qty /
// status). See `docs/...` if a per-line register is added later.

import type { Company, DeliveryChallanListItem, DispatchSummary } from '@innovic/shared';
import { esc, fmtDate } from '@/lib/print/doc-print';
import { printWindow, printedMeta } from '@/lib/print/print-window';

const STATUS_BADGE: Record<string, string> = {
  open: 'b-blue',
  partially_received: 'b-amber',
  received: 'b-green',
  cancelled: 'b-grey',
};

function statusBadge(status: string): string {
  const cls = STATUS_BADGE[status] ?? 'b-grey';
  return `<span class="badge ${cls}">${esc(status.replaceAll('_', ' '))}</span>`;
}

export function printDispatchRegister(args: {
  rows: DeliveryChallanListItem[];
  summary: DispatchSummary;
  // Optional filter context shown under the title (search / status / dates).
  filterLabel?: string;
  company: Company | null | undefined;
}): boolean {
  const { rows, summary, filterLabel, company } = args;

  const tableRows = rows
    .map(
      (d) => `<tr>
      <td style="font-family:monospace;color:#0369a1;font-weight:700">${esc(d.code)}</td>
      <td>${esc(fmtDate(d.dcDate))}</td>
      <td>${esc(d.vendorName ?? d.vendorCodeText ?? '—')}</td>
      <td style="font-family:monospace">${esc(d.poCode ?? d.poCodeText ?? '—')}</td>
      <td style="font-family:monospace;font-size:10px">${esc(d.soCode ?? d.soRefText ?? '—')}</td>
      <td style="text-align:center;font-weight:700">${d.lineCount}</td>
      <td style="text-align:right;font-weight:700;color:#dc2626">${Number(d.totalQty).toFixed(2)}</td>
      <td style="text-align:center">${statusBadge(d.status)}</td>
    </tr>`,
    )
    .join('');

  const totalQty = summary.totalDispatched.toLocaleString('en-IN', { maximumFractionDigits: 2 });

  const body = `
    <div class="doc-title"><h1>DISPATCH REGISTER</h1><span class="print-meta">${printedMeta()}</span></div>
    ${
      filterLabel
        ? `<div style="font-size:11px;color:#666;margin:-6px 0 12px">Filter: ${esc(filterLabel)}</div>`
        : ''
    }
    <div class="info-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="info-box"><div class="info-lbl">Total Dispatched</div><div class="info-val" style="color:#dc2626;font-size:20px">${totalQty} pcs</div></div>
      <div class="info-box"><div class="info-lbl">Dispatch Entries</div><div class="info-val">${summary.entryCount}</div></div>
      <div class="info-box"><div class="info-lbl">Items Dispatched</div><div class="info-val">${summary.itemCount}</div></div>
    </div>
    <table><thead><tr><th>DC No.</th><th>Date</th><th>Vendor</th><th>PO</th><th>SO</th><th>Lines</th><th>Qty</th><th>Status</th></tr></thead>
    <tbody>${tableRows || '<tr><td colspan="8" style="text-align:center;color:#aaa">No dispatch records</td></tr>'}</tbody></table>
    <div class="sign-row">
      <div class="sign-box">Store In-Charge</div>
      <div class="sign-box">Dispatch Manager</div>
      <div class="sign-box">Authorised By</div>
    </div>`;

  return printWindow({ title: 'Dispatch Register', body, company });
}
