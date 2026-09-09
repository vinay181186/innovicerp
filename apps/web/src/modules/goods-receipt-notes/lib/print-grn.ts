// Goods Receipt Note print.
//
// The GRN is one of the template-backed documents in Settings → Print
// Templates (PO / Service PO / OSP DC / JW DC / GRN), and it now renders on the
// SAME document layout the other four use — the shared `@/lib/print/doc-print`
// builder: a bordered sheet with the letterhead, a TITLE BAR, the party block
// on the left with the meta cells on the right, then the four editable blocks
// in print order around the line table:
//
//   special_notes  → below the line items
//   terms          → below Special Notes
//   footer         → bottom of the sheet
//   signature      → the signature area at the foot
//
// It used to print through `@/lib/print/print-window`, the INTERNAL layout the
// Job Card and the Route Card use, which renders the header facts as a grid of
// info-box tiles. That is not the layout the GRN print template describes, and
// the boxes were reported as a defect.
//
// A GRN's columns are received / accepted / rejected / QC status, which the
// builder's qty-and-money goods table cannot express, so this file supplies its
// own `tableHtml`. Everything else on the sheet — letterhead, title bar, party
// and meta row, the template blocks, the signature strip — comes from the
// shared builder, so the printed GRN matches the PO and the two delivery
// challans.
//
// Variable substitution is the same `substituteTemplateVars` from
// @innovic/shared that every other printed document uses (the builder applies
// it), over the variables the contract lists in PRINT_TEMPLATE_VARS.GRN.
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
import { buildDocCompany, companyAddressLines } from '@/lib/print/company';
import {
  type DocMetaCell,
  type DocPrintModel,
  esc,
  fmtDate,
  openDocPrintWindow,
  templatesToBlocks,
} from '@/lib/print/doc-print';

function qcLabel(status: GrnQcStatus): string {
  return status.replaceAll('_', ' ');
}

// A dash, never a blank cell: an empty cell on paper reads as something gone
// wrong, a dash reads as "there is no value here", which is what is true.
function dash(v: string | null | undefined): string {
  return v && v.trim() ? esc(v) : '&mdash;';
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

// The GRN line table, as an HTML string in the same
// `<div class="section"><table>…</table></div>` shape the shared builder emits
// for its own goods table, so it inherits the document stylesheet (the section
// rule, the th/td borders, the 11px type) instead of carrying a second one.
function grnTableHtml(lines: GrnPrintLine[]): string {
  // The per-line DC reference only earns a column when at least one line
  // carries one — otherwise the sheet prints a column of dashes.
  const showDcRef = lines.some((l) => Boolean(l.dcRefNo));
  const colCount = showDcRef ? 8 : 7;

  const head =
    '<th style="width:44px">Sr No.</th>' +
    '<th style="width:120px">Item Code</th>' +
    '<th>Item Name</th>' +
    '<th style="width:70px;text-align:center">Received Qty</th>' +
    '<th style="width:70px;text-align:center">QC Accepted</th>' +
    '<th style="width:70px;text-align:center">QC Rejected</th>' +
    '<th style="width:86px;text-align:center">QC Status</th>' +
    (showDcRef ? '<th style="width:100px">DC Ref</th>' : '');

  const rows = lines
    .map(
      (l, i) => `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${dash(l.itemCode)}</td>
      <td>${dash(l.itemName)}</td>
      <td style="text-align:center;font-weight:600">${l.receivedQty}</td>
      <td style="text-align:center;font-weight:600">${l.qcAcceptedQty}</td>
      <td style="text-align:center;font-weight:600">${l.qcRejectedQty}</td>
      <td style="text-align:center;text-transform:capitalize">${esc(qcLabel(l.qcStatus))}</td>
      ${showDcRef ? `<td>${dash(l.dcRefNo)}</td>` : ''}
    </tr>`,
    )
    .join('');

  const totalReceived = lines.reduce((s, l) => s + l.receivedQty, 0);
  const totalAccepted = lines.reduce((s, l) => s + l.qcAcceptedQty, 0);
  const totalRejected = lines.reduce((s, l) => s + l.qcRejectedQty, 0);

  // Same tone the shared builder's own TOTAL row carries, so the two documents
  // read alike on paper.
  const totalsRow = `<tr style="background:#f1f5f9">
      <td colspan="3" style="text-align:right;font-weight:800">TOTAL</td>
      <td style="text-align:center;font-weight:800">${totalReceived}</td>
      <td style="text-align:center;font-weight:800">${totalAccepted}</td>
      <td style="text-align:center;font-weight:800">${totalRejected}</td>
      <td${showDcRef ? ' colspan="2"' : ''}></td>
    </tr>`;

  const emptyRow = `<tr><td colspan="${colCount}" style="text-align:center;color:#94a3b8">No lines on this GRN</td></tr>`;

  return `<div class="section"><table><thead><tr>${head}</tr></thead><tbody>${
    rows ? rows + totalsRow : emptyRow
  }</tbody></table></div>`;
}

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

  // GRN No. and GRN Date always print; the three reference numbers only when
  // the document actually carries them — the same way the OSP DC pushes its
  // optional meta cells.
  const meta: DocMetaCell[] = [
    { label: 'GRN No.', value: model.code },
    { label: 'GRN Date', value: fmtDate(model.grnDate) },
  ];
  if (model.poNo) meta.push({ label: 'PO No.', value: model.poNo });
  if (model.dcNo) meta.push({ label: 'Vendor DC No.', value: model.dcNo });
  if (model.invoiceNo) meta.push({ label: 'Invoice No.', value: model.invoiceNo });

  // The GRN is INWARD, so the counterparty is the party that SUPPLIED the
  // goods — labelled "Supplier", not "Recipient". Address / GSTIN / contact
  // come from the same substitution bag the template blocks read, which is
  // where both entry points already resolve them.
  const vendorName = model.vendorName || (data.vendorName ?? '');
  const vendorLines = [
    data.vendorAddress ?? '',
    data.vendorGSTIN ? `GSTIN: ${data.vendorGSTIN}` : '',
    data.vendorContact ?? '',
  ].filter(Boolean);

  // Remarks are free text the store typed on THIS GRN, not template text, so
  // they print as the document's own computed section under the line table —
  // the same slot the OSP DC uses for its material return status.
  const remarks = model.remarks?.trim();

  const docModel: DocPrintModel = {
    doc: 'GRN',
    blocks: templatesToBlocks('GRN', templates),
    data,
    company: buildDocCompany(company),
    recipient: { label: 'Supplier', name: vendorName, lines: vendorLines },
    meta,
    // The GRN supplies its own table below, so the builder's goods table is
    // never rendered and this list is never read.
    lines: [],
    tableHtml: grnTableHtml(model.lines),
    // Spread, not an explicit key: exactOptionalPropertyTypes refuses an
    // explicit undefined on an optional property.
    ...(remarks ? { extraSection: { title: 'Remarks', body: remarks } } : {}),
    ...(args.testBanner ? { opts: { testBanner: true } } : {}),
  };

  return openDocPrintWindow(docModel);
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
