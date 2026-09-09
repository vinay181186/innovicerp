// Goods Receipt Note print.
//
// The GRN is one of the template-backed documents in Settings → Print
// Templates (PO / Service PO / OSP DC / JW DC / GRN). It renders on the SHARED
// SHEET, `@/lib/print/sheet-print` — the same one the Purchase Order and both
// challans print on, so every document in the set carries one letterhead, one
// type scale, one border and one page-numbering scheme.
//
// It uses the sheet's `grn` column set: Sr | Item detail | UOM | Received |
// Accepted | Rejected | QC status. A GRN is the only document here whose line
// carries THREE quantities, which is why it needed its own column set rather
// than being squeezed into the challan's.
// The doc-print layout is a bordered sheet with the letterhead, a TITLE BAR,
// the party block on the left with the meta cells on the right, then the four
// editable blocks in print order around the line table:
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
import { fmtDate, templatesToBlocks } from '@/lib/print/doc-print';
import {
  type SheetField,
  type SheetPrintModel,
  challanDate,
  openSheetPrintWindow,
} from '@/lib/print/sheet-print';

function qcLabel(status: GrnQcStatus): string {
  return status.replaceAll('_', ' ');
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
  // the document actually carries them -- the same way the challan pushes its
  // optional document cells.
  const documentFields: SheetField[] = [
    { label: 'GRN No.', value: model.code, variant: 'mono', strong: true },
    { label: 'GRN date', value: challanDate(model.grnDate), variant: 'mono' },
  ];
  if (model.poNo) documentFields.push({ label: 'PO No.', value: model.poNo, variant: 'mono' });
  if (model.dcNo)
    documentFields.push({ label: 'Vendor DC No.', value: model.dcNo, variant: 'mono' });
  if (model.invoiceNo)
    documentFields.push({ label: 'Invoice No.', value: model.invoiceNo, variant: 'mono' });

  // The GRN is INWARD, so the counterparty SUPPLIED the goods -- "Supplier",
  // not "Recipient". Address / GSTIN / contact come from the same substitution
  // bag the template blocks read, which is where both entry points resolve them.
  const vendorName = model.vendorName || (data.vendorName ?? '');
  const supplierFields: SheetField[] = [
    { label: 'Name', value: vendorName, variant: 'name' },
    { label: 'Address', value: data.vendorAddress ?? '' },
    { label: 'GSTIN', value: data.vendorGSTIN ?? '', variant: 'mono' },
  ];
  if (data.vendorContact)
    supplierFields.push({ label: 'Contact', value: data.vendorContact });

  const totalReceived = model.lines.reduce((t, l) => t + l.receivedQty, 0);
  const totalAccepted = model.lines.reduce((t, l) => t + l.qcAcceptedQty, 0);
  const totalRejected = model.lines.reduce((t, l) => t + l.qcRejectedQty, 0);

  // Remarks are free text the store typed on THIS GRN, not template text, so
  // they print in the sheet's own notes slot rather than as a template block.
  const remarks = model.remarks?.trim();
  const blocks = templatesToBlocks('GRN', templates);
  if (remarks) {
    blocks.special_notes = [blocks.special_notes, `Remarks: ${remarks}`]
      .filter(Boolean)
      .join('\n\n');
  }

  const sheet: SheetPrintModel = {
    title: 'Goods Receipt Note',
    windowTitle: 'Goods Receipt Note',
    columns: 'grn',
    blocks,
    data,
    company: buildDocCompany(company),
    recipient: { label: 'Supplier', fields: supplierFields },
    document: { label: 'Document', fields: documentFields },
    lines: model.lines.map((l) => ({
      itemCode: l.itemCode ?? '',
      itemName: l.itemName,
      uom: null,
      qty: String(l.receivedQty),
      acceptedQty: String(l.qcAcceptedQty),
      rejectedQty: String(l.qcRejectedQty),
      qcStatus: qcLabel(l.qcStatus),
      // The per-line DC reference has no column of its own -- it would be a
      // column of dashes on most GRNs -- so it rides under the item, labelled,
      // and only on the lines that carry one.
      ...(l.dcRefNo ? { description: l.dcRefNo, descLabel: 'DC Ref' } : {}),
    })),
    totalQty: String(totalReceived),
    totalAccepted: String(totalAccepted),
    totalRejected: String(totalRejected),
    totalUom: '',
    // A GRN is signed by the people who counted and checked it, not by us.
    receiverCell: 'Received by<br>Name, sign &amp; date',
    ...(args.testBanner ? { opts: { testBanner: true } } : {}),
  };

  return openSheetPrintWindow(sheet);
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
