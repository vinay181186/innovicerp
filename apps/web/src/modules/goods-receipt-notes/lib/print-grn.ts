// Goods Receipt Note print.
//
// The GRN is one of the template-backed documents in Settings → Print
// Templates (PO / Service PO / OSP DC / JW DC / GRN), but it does NOT render
// through the shared `@/lib/print/doc-print` builder: that builder prints an
// OUTWARD, priced document (Rate / Amount / amount-in-words / one supplier
// address block). A GRN records what ARRIVED and what survived inspection —
// received / accepted / rejected quantities, no money anywhere — so it keeps
// its own fixed layout on the shared `printWindow` util and renders the five
// editable blocks itself, in print order:
//
//   header_note    → above the line items
//   special_notes  → below the line items
//   terms          → below Special Notes
//   footer         → bottom of the sheet
//   signature      → the signature strip (default: Received By / Checked By /
//                    Authorised Signatory)
//
// Variable substitution uses the same `substituteTemplateVars` from
// @innovic/shared that every other printed document uses, over the variables
// the contract lists in PRINT_TEMPLATE_VARS.GRN.
//
// Letterhead: GRN is an INTERNAL receipt document (goods arriving at OUR
// store), so per the rule documented in `lib/print/letterhead.ts` it gets the
// LOGO-only company header that `printWindow` already renders, not the full
// outward letterhead with the address/e-mail footer strip. Adding
// `letterheadHeaderHtml` on top of that would print the company block twice.
//
// Everything on the sheet is already on the GRN detail screen — no new field,
// no new API call, no calculation the screen does not also do.

import type {
  Company,
  EffectivePrintTemplate,
  GoodsReceiptNoteDetail,
  GrnQcStatus,
  Vendor,
} from '@innovic/shared';
import { substituteTemplateVars } from '@innovic/shared';
import { companyAddressLines } from '@/lib/print/company';
import { esc, fmtDate, templatesToBlocks } from '@/lib/print/doc-print';
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

// Template text is plain text the user typed, so newlines have to become
// breaks and the text has to be escaped before it goes into the document.
function nl2br(s: string): string {
  return esc(s).replace(/\r?\n/g, '<br>');
}

// ── The shape this builder prints ────────────────────────────────────────────
// A real GRN (GoodsReceiptNoteDetail + its vendor) maps onto this, and so does
// the sample GRN the Print Templates editor sends through Test Print. Keeping
// the builder on this small shape is what lets the test print use the SAME
// code path the real print uses.
export interface GrnPrintLine {
  itemCode: string | null;
  itemName: string | null;
  receivedQty: number;
  qcAcceptedQty: number;
  qcRejectedQty: number;
  qcStatus: GrnQcStatus;
  dcRefNo: string | null;
}

export interface GrnPrintModel {
  code: string;
  grnDate: string;
  vendorName: string;
  poNo: string;
  dcNo: string | null;
  invoiceNo: string | null;
  remarks: string | null;
  lines: GrnPrintLine[];
}

// The five editable blocks, substituted and ready to drop into the sheet.
function renderBlocks(
  templates: EffectivePrintTemplate[],
  data: Record<string, string>,
): { headerNote: string; specialNotes: string; terms: string; footer: string; signature: string } {
  const blocks = templatesToBlocks('GRN', templates);
  const sub = (key: string): string => nl2br(substituteTemplateVars(blocks[key] ?? '', data));
  return {
    headerNote: sub('header_note'),
    specialNotes: sub('special_notes'),
    terms: sub('terms'),
    footer: sub('footer'),
    signature: sub('signature'),
  };
}

// The signature strip. The GRN's factory default is three names separated by
// blank lines ("Received By / Checked By / Authorised Signatory"), so each
// blank-line-separated chunk becomes one signing box — which reproduces the
// three-box strip this sheet has always printed, while letting an admin change
// the names (or reduce them to one) in Settings → Print Templates.
function signatureHtml(signature: string): string {
  const parts = signature
    .split(/(?:<br>\s*){2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const boxes = parts.length > 0 ? parts : ['Received By', 'Checked By', 'Authorised Signatory'];
  // One name only → a single box in the bottom-RIGHT corner. Two or more →
  // an even strip across the foot of the sheet, as today.
  const style =
    boxes.length > 1
      ? `grid-template-columns:repeat(${boxes.length},1fr)`
      : 'grid-template-columns:1fr;width:38%;margin-left:auto';
  return `<div class="sign-row" style="${style}">${boxes
    .map((b) => `<div class="sign-box">${b}</div>`)
    .join('')}</div>`;
}

const TEST_BANNER =
  '<div class="no-print" style="background:#fef3c7;border:2px dashed #d97706;padding:10px;text-align:center;border-radius:6px;color:#92400e;font-weight:700">' +
  'ⓘ TEST PRINT — Sample data shown. Real data is substituted on actual prints.</div>';

// Builds and opens the sheet. `data` is the {var} substitution bag — the
// caller assembles it, exactly as print-po / print-ospdc do for the shared
// builder. Returns false if the popup was blocked.
export function printGrnDoc(args: {
  model: GrnPrintModel;
  data: Record<string, string>;
  company: Company | null | undefined;
  templates: EffectivePrintTemplate[];
  testBanner?: boolean;
}): boolean {
  const { model, data, company, templates } = args;
  const lines = model.lines;

  const totalReceived = lines.reduce((s, l) => s + l.receivedQty, 0);
  const totalAccepted = lines.reduce((s, l) => s + l.qcAcceptedQty, 0);
  const totalRejected = lines.reduce((s, l) => s + l.qcRejectedQty, 0);

  const { headerNote, specialNotes, terms, footer, signature } = renderBlocks(templates, data);

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
      <td style="font-family:monospace">${dash(l.itemCode)}</td>
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

  const noteBox = (html: string): string =>
    `<div style="font-size:11px;line-height:1.6;border:1px solid #e5e7eb;border-radius:6px;padding:10px;margin-bottom:12px;background:#f8fafc">${html}</div>`;

  const body = `
    ${args.testBanner ? TEST_BANNER : ''}
    <div class="doc-title"><h1>GOODS RECEIPT NOTE — ${esc(model.code)}</h1><span class="print-meta">${printedMeta()}</span></div>
    <div class="info-grid">
      <div class="info-box"><div class="info-lbl">GRN No.</div><div class="info-val" style="font-family:monospace;font-size:13px">${esc(model.code)}</div></div>
      <div class="info-box"><div class="info-lbl">GRN Date</div><div class="info-val">${fmtDate(model.grnDate) || '&mdash;'}</div></div>
      <div class="info-box"><div class="info-lbl">Vendor</div><div class="info-val">${dash(model.vendorName)}</div></div>
      <div class="info-box"><div class="info-lbl">PO No.</div><div class="info-val" style="font-family:monospace;font-size:13px">${dash(model.poNo)}</div></div>
      <div class="info-box"><div class="info-lbl">Vendor DC No.</div><div class="info-val" style="font-family:monospace;font-size:13px">${dash(model.dcNo)}</div></div>
      <div class="info-box"><div class="info-lbl">Invoice No.</div><div class="info-val" style="font-family:monospace;font-size:13px">${dash(model.invoiceNo)}</div></div>
      <div class="info-box"><div class="info-lbl">Total Received</div><div class="info-val">${totalReceived}</div></div>
      <div class="info-box"><div class="info-lbl">Accepted / Rejected</div><div class="info-val"><span style="color:#16a34a">${totalAccepted}</span> / <span style="color:#d97706">${totalRejected}</span></div></div>
    </div>
    ${headerNote ? noteBox(headerNote) : ''}
    <h2>Remarks</h2>
    <div style="font-size:11px;white-space:pre-wrap;padding:2px 8px 4px">${dash(model.remarks)}</div>
    <h2>Received Items</h2>
    <table><thead><tr>${head}</tr></thead>
    <tbody>${rows ? rows + totalsRow : emptyRow}</tbody></table>
    ${specialNotes ? `<h2>Special Notes</h2><div style="font-size:11px;line-height:1.6;padding:2px 8px 4px">${specialNotes}</div>` : ''}
    ${terms ? `<h2>Terms &amp; Conditions</h2><div style="font-size:11px;line-height:1.6;padding:2px 8px 4px">${terms}</div>` : ''}
    ${footer ? `<div style="margin-top:14px;text-align:center;font-size:10px;color:#666">${footer}</div>` : ''}
    ${signatureHtml(signature)}`;

  // `company` feeds the logo/letterhead block printWindow renders; the
  // {company*} variables come from `data`, which the caller built from the
  // same company row.
  const title = args.testBanner ? 'Test Print — GOODS RECEIPT NOTE' : `GRN ${model.code}`;
  return printWindow({ title, body, company });
}

// Real-data entry point, called from the GRN detail page.
export function printGrn(args: {
  grn: GoodsReceiptNoteDetail;
  vendor: Vendor | null | undefined;
  company: Company | null | undefined;
  templates: EffectivePrintTemplate[];
  currentUser?: string | undefined;
}): boolean {
  const { grn, vendor, company, templates } = args;
  const lines = [...grn.lines].sort((a, b) => a.lineNo - b.lineNo);

  const vendorName = vendor?.name ?? grn.vendorName ?? grn.vendorCodeText ?? '';
  const poNo = grn.poCode ?? grn.poCodeText ?? '';

  const model: GrnPrintModel = {
    code: grn.code,
    grnDate: grn.grnDate,
    vendorName,
    poNo,
    dcNo: grn.dcNo,
    invoiceNo: grn.invoiceNo,
    remarks: grn.remarks,
    lines: lines.map((l) => ({
      // LIVE master code first, the snapshot text only as the fallback —
      // same order the detail screen resolves it in.
      itemCode: l.itemCode ?? l.itemCodeText,
      itemName: l.itemName,
      receivedQty: l.receivedQty,
      qcAcceptedQty: l.qcAcceptedQty,
      qcRejectedQty: l.qcRejectedQty,
      qcStatus: l.qcStatus,
      dcRefNo: l.dcRefNo,
    })),
  };

  // Every variable the contract lists for the GRN, filled from the real
  // document. A variable left out of this bag prints as blank.
  const data: Record<string, string> = {
    companyName: company?.name ?? '',
    companyAddress: companyAddressLines(company).join(', '),
    companyGSTIN: company?.gstNumber ?? '',
    companyPhone: company?.phone ?? '',
    companyEmail: company?.email ?? '',
    date: fmtDate(new Date().toISOString().slice(0, 10)),
    currentUser: args.currentUser ?? '',
    grnNo: grn.code,
    grnDate: fmtDate(grn.grnDate),
    vendorName,
    vendorAddress: vendor?.addressLine1 ?? '',
    vendorGSTIN: vendor?.gstNumber ?? '',
    vendorContact: [vendor?.contactPerson, vendor?.phone].filter(Boolean).join(', '),
    poNo,
    dcNo: grn.dcNo ?? '',
    invoiceNo: grn.invoiceNo ?? '',
    totalReceived: String(model.lines.reduce((s, l) => s + l.receivedQty, 0)),
    totalAccepted: String(model.lines.reduce((s, l) => s + l.qcAcceptedQty, 0)),
    totalRejected: String(model.lines.reduce((s, l) => s + l.qcRejectedQty, 0)),
  };

  return printGrnDoc({ model, data, company, templates });
}
