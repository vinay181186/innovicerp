// Goods Receipt Note print. GRN is NOT one of the four template-backed
// document types wired into Settings → Print Templates (PO / Service PO /
// OSP DC / JW DC), so this is a fixed-layout document built on the shared
// `printWindow` util — exactly the route `print-job-card.ts` takes.
//
// Letterhead: GRN is an INTERNAL receipt document (goods arriving at OUR
// store), so per the rule documented in `lib/print/letterhead.ts` it gets the
// LOGO-only company header that `printWindow` already renders, not the full
// outward letterhead with the address/e-mail footer strip. Adding
// `letterheadHeaderHtml` on top of that would print the company block twice.
//
// Everything on the sheet is already on the GRN detail screen — no new field,
// no new API call, no calculation the screen does not also do.

import type { Company, GoodsReceiptNoteDetail, GrnQcStatus } from '@innovic/shared';
import { esc, fmtDate } from '@/lib/print/doc-print';
import { printWindow, printedMeta } from '@/lib/print/print-window';

// Same three tones the on-screen QcStatusBadge uses, mapped to the badge
// classes the shared print stylesheet defines.
const QC_BADGE: Record<GrnQcStatus, string> = {
  pending: 'b-amber',
  in_progress: 'b-blue',
  completed: 'b-green',
};

function qcLabel(status: GrnQcStatus): string {
  return status.replaceAll('_', ' ');
}

// A dash, never a blank cell: an empty cell on paper reads as something gone
// wrong, a dash reads as "there is no value here", which is what is true.
function dash(v: string | null | undefined): string {
  return v && v.trim() ? esc(v) : '&mdash;';
}

export function printGrn(args: {
  grn: GoodsReceiptNoteDetail;
  company: Company | null | undefined;
}): boolean {
  const { grn, company } = args;
  const lines = [...grn.lines].sort((a, b) => a.lineNo - b.lineNo);

  const totalReceived = lines.reduce((s, l) => s + l.receivedQty, 0);
  const totalAccepted = lines.reduce((s, l) => s + l.qcAcceptedQty, 0);
  const totalRejected = lines.reduce((s, l) => s + l.qcRejectedQty, 0);

  // The per-line DC reference only earns a column when at least one line
  // carries one — otherwise the sheet prints a column of dashes.
  const showDcRef = lines.some((l) => Boolean(l.dcRefNo));

  const head =
    '<th style="width:44px">Sr No.</th>' +
    '<th style="width:130px">Item Code</th>' +
    '<th>Item Name</th>' +
    '<th style="width:80px;text-align:center">Received Qty</th>' +
    '<th style="width:80px;text-align:center">QC Accepted</th>' +
    '<th style="width:80px;text-align:center">QC Rejected</th>' +
    '<th style="width:90px">QC Status</th>' +
    (showDcRef ? '<th style="width:110px">DC Ref</th>' : '');

  const colCount = showDcRef ? 8 : 7;

  const rows = lines
    .map(
      (l, i) => `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td style="font-family:monospace">${dash(l.itemCode ?? l.itemCodeText)}</td>
      <td>${dash(l.itemName)}</td>
      <td style="text-align:center;font-weight:700">${l.receivedQty}</td>
      <td style="text-align:center;color:#16a34a;font-weight:700">${l.qcAcceptedQty}</td>
      <td style="text-align:center;color:#d97706;font-weight:700">${l.qcRejectedQty}</td>
      <td><span class="badge ${QC_BADGE[l.qcStatus]}">${esc(qcLabel(l.qcStatus))}</span></td>
      ${showDcRef ? `<td style="font-family:monospace">${dash(l.dcRefNo)}</td>` : ''}
    </tr>`,
    )
    .join('');

  const totalsRow = `<tr style="background:#f1f5f9">
      <td colspan="3" style="text-align:right;font-weight:800">TOTAL</td>
      <td style="text-align:center;font-weight:800">${totalReceived}</td>
      <td style="text-align:center;font-weight:800;color:#16a34a">${totalAccepted}</td>
      <td style="text-align:center;font-weight:800;color:#d97706">${totalRejected}</td>
      <td${showDcRef ? ' colspan="2"' : ''}></td>
    </tr>`;

  const emptyRow = `<tr><td colspan="${colCount}" style="text-align:center;color:#aaa">No lines on this GRN</td></tr>`;

  const vendor = grn.vendorName ?? grn.vendorCodeText ?? '';
  const poCode = grn.poCode ?? grn.poCodeText ?? '';

  const body = `
    <div class="doc-title"><h1>GOODS RECEIPT NOTE — ${esc(grn.code)}</h1><span class="print-meta">${printedMeta()}</span></div>
    <div class="info-grid">
      <div class="info-box"><div class="info-lbl">GRN No.</div><div class="info-val" style="font-family:monospace;font-size:13px">${esc(grn.code)}</div></div>
      <div class="info-box"><div class="info-lbl">GRN Date</div><div class="info-val">${fmtDate(grn.grnDate) || '&mdash;'}</div></div>
      <div class="info-box"><div class="info-lbl">Vendor</div><div class="info-val">${dash(vendor)}</div></div>
      <div class="info-box"><div class="info-lbl">PO No.</div><div class="info-val" style="font-family:monospace;font-size:13px">${dash(poCode)}</div></div>
      <div class="info-box"><div class="info-lbl">Vendor DC No.</div><div class="info-val" style="font-family:monospace;font-size:13px">${dash(grn.dcNo)}</div></div>
      <div class="info-box"><div class="info-lbl">Invoice No.</div><div class="info-val" style="font-family:monospace;font-size:13px">${dash(grn.invoiceNo)}</div></div>
      <div class="info-box"><div class="info-lbl">Total Received</div><div class="info-val">${totalReceived}</div></div>
      <div class="info-box"><div class="info-lbl">Accepted / Rejected</div><div class="info-val"><span style="color:#16a34a">${totalAccepted}</span> / <span style="color:#d97706">${totalRejected}</span></div></div>
    </div>
    <h2>Remarks</h2>
    <div style="font-size:11px;white-space:pre-wrap;padding:2px 8px 4px">${dash(grn.remarks)}</div>
    <h2>Received Items</h2>
    <table><thead><tr>${head}</tr></thead>
    <tbody>${rows ? rows + totalsRow : emptyRow}</tbody></table>
    <div class="sign-row">
      <div class="sign-box">Received By</div>
      <div class="sign-box">Checked By</div>
      <div class="sign-box">Authorised Signatory</div>
    </div>`;

  return printWindow({ title: `GRN ${grn.code}`, body, company });
}
