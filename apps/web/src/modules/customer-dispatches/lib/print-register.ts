// Customer Dispatch Register print — mirror of legacy `printDispatchRegister`
// (`legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L10789): info-grid
// (Total Dispatched / Dispatch Entries / Items Dispatched) + per-line table
// (Date / SO No. / CPO Ln / Item Code / Item Name / Qty / UOM / Customer /
// Dispatched By / Remarks) + 3-cell signature row. Unlike the header-grain
// OSP/JW DC register print, this one IS line-grain — same as legacy.

import type { Company, CustomerDispatchRegisterRow } from '@innovic/shared';
import { esc, fmtDate } from '@/lib/print/doc-print';
import { printWindow, printedMeta } from '@/lib/print/print-window';

export function printCustomerDispatchRegister(args: {
  rows: CustomerDispatchRegisterRow[]; // active (non-cancelled) rows
  company: Company | null | undefined;
}): boolean {
  const { rows, company } = args;
  const totalPcs = rows.reduce((s, r) => s + r.qty, 0);
  const itemCount = new Set(rows.map((r) => r.itemCode ?? r.itemName)).size;

  const tableRows = rows
    .map(
      (r) => `<tr>
      <td>${esc(fmtDate(r.date))}</td>
      <td style="font-family:monospace;font-size:10px">${esc(r.soNo ?? '—')}</td>
      <td style="color:#7c3aed;font-weight:700">${esc(r.clientPoLineNo ?? '—')}</td>
      <td style="color:#7c3aed;font-family:monospace">${esc(r.itemCode ?? '—')}</td>
      <td>${esc(r.itemName)}</td>
      <td style="text-align:center;font-weight:700;color:#dc2626">${r.qty}</td>
      <td style="text-align:center">${esc(r.uom ?? 'NOS')}</td>
      <td>${esc(r.customer ?? '—')}</td>
      <td>${esc(r.dispatchedBy ?? '—')}</td>
      <td style="font-size:10px">${esc(r.remarks ?? '—')}</td>
    </tr>`,
    )
    .join('');

  const body = `
    <div class="doc-title"><h1>DISPATCH REGISTER</h1><span class="print-meta">${printedMeta()}</span></div>
    <div class="info-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="info-box"><div class="info-lbl">Total Dispatched</div><div class="info-val" style="color:#dc2626;font-size:20px">${totalPcs} pcs</div></div>
      <div class="info-box"><div class="info-lbl">Dispatch Entries</div><div class="info-val">${rows.length}</div></div>
      <div class="info-box"><div class="info-lbl">Items Dispatched</div><div class="info-val">${itemCount}</div></div>
    </div>
    <table><thead><tr><th>Date</th><th>SO No.</th><th>CPO Ln</th><th>Item Code</th><th>Item Name</th><th>Qty</th><th>UOM</th><th>Customer</th><th>Dispatched By</th><th>Remarks</th></tr></thead>
    <tbody>${tableRows || '<tr><td colspan="10" style="text-align:center;color:#aaa">No dispatch records</td></tr>'}</tbody></table>
    <div class="sign-row">
      <div class="sign-box">Store In-Charge</div>
      <div class="sign-box">Dispatch Manager</div>
      <div class="sign-box">Authorised By</div>
    </div>`;

  return printWindow({ title: 'Dispatch Register', body, company });
}
