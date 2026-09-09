// Real-data OSP Delivery Challan print (Print Templates P2, ADR-034).
// Assembles the challan print model from the loaded DC detail + vendor +
// company + the effective `ospdc_*` template blocks. Presentation only
// (DELTA #2). Mirrors legacy `printChallan` (L26133) — outsource gate pass for
// a Job-Work PO.
//
// Renders on the shared sheet layout in `@/lib/print/sheet-print` — the same
// one the Purchase Order now prints on, so both documents carry one letterhead,
// one type scale and one border.
//
// It does NOT print a "Material Return Status" block. It used to: a computed
// per-line sent / received / pending tally under the goods table. Removed on
// the user's instruction (2026-09-09) — a challan is the note that travels OUT
// with the material, and what has come back since is a fact about today, not
// about the consignment the vendor is being handed. It is still on the screen,
// in the receipts panel, which is where it is read.

import type {
  Company,
  DeliveryChallanWithLines,
  EffectivePrintTemplate,
  Vendor,
} from '@innovic/shared';
import {
  type SheetField,
  type SheetPrintModel,
  challanDate,
  challanEndDate,
  openSheetPrintWindow,
} from '@/lib/print/sheet-print';
import { buildDocCompany, companyAddressLines } from '@/lib/print/company';
import { fmtDate, templatesToBlocks } from '@/lib/print/doc-print';

export function printOspDc(args: {
  dc: DeliveryChallanWithLines;
  vendor: Vendor | null | undefined;
  company: Company | null | undefined;
  templates: EffectivePrintTemplate[];
  currentUser?: string | undefined;
}): boolean {
  const { dc, vendor, company, templates } = args;

  const totalQty = dc.lines.reduce((s, l) => s + Number(l.qty), 0);
  const linkedPo = dc.poCode ?? dc.poCodeText ?? '';
  const recipientName = vendor?.name ?? dc.vendorName ?? dc.vendorCodeText ?? '';
  const recipientAddress = vendor?.addressLine1 ?? '';
  // Transporter NAME and vehicle NUMBER are two different fields; the print
  // shows both, each under its own label.
  const transporter = dc.transport ?? '';
  const vehicleNo = dc.vehicleNo ?? '';

  const data: Record<string, string> = {
    companyName: company?.name ?? '',
    companyAddress: companyAddressLines(company).join(', '),
    companyGSTIN: company?.gstNumber ?? '',
    date: fmtDate(new Date().toISOString()),
    currentUser: args.currentUser ?? '',
    dcNo: dc.code,
    dcDate: fmtDate(dc.dcDate),
    purpose: '',
    recipientName,
    recipientAddress,
    vehicleNo,
    driverName: '',
    linkedPONo: linkedPo,
    totalQty: String(totalQty),
  };

  const blocks = templatesToBlocks('OSP DC', templates);
  // Vendor master first: `vendorCodeText` is the ISSUE-TIME snapshot and on
  // every production challan it holds the PO number, not the vendor's code.
  const vendorAddressLines = [
    vendor?.addressLine1 ?? '',
    [vendor?.city, vendor?.state, vendor?.pincode].filter(Boolean).join(', '),
  ].filter(Boolean);
  const recipientFields: SheetField[] = [
    { label: 'Vendor code', value: vendor?.code ?? dc.vendorCodeText ?? '', variant: 'mono' },
    { label: 'Name', value: recipientName, variant: 'name' },
    {
      label: 'Address',
      value: vendorAddressLines[0] ?? '',
      ...(vendorAddressLines.length > 1 ? { extra: vendorAddressLines.slice(1) } : {}),
    },
    { label: 'GSTIN', value: vendor?.gstNumber ?? '', variant: 'mono' },
  ];

  const documentFields: SheetField[] = [
    { label: 'Challan No.', value: dc.code, variant: 'mono' },
    { label: 'Challan date', value: challanDate(dc.dcDate), variant: 'mono' },
    // Live SO code first, snapshot text second. Both are null on every
    // production challan today, so this normally prints as a blank rule.
    { label: 'SO No.', value: dc.soCode ?? dc.soRefText ?? '', variant: 'mono' },
    { label: 'PO No.', value: linkedPo, variant: 'mono' },
    // Not a stored field — challan date + 3 months, which is the return window
    // the printed conditions promise.
    { label: 'Challan end date', value: challanEndDate(dc.dcDate), variant: 'mono', strong: true },
  ];
  if (transporter) documentFields.push({ label: 'Transport', value: transporter });
  if (vehicleNo) documentFields.push({ label: 'Vehicle No.', value: vehicleNo, variant: 'mono' });

  const uoms = [...new Set(dc.lines.map((l) => l.uom).filter(Boolean))];

  const model: SheetPrintModel = {
    title: 'Delivery Challan',
    windowTitle: 'OSP Delivery Challan',
    blocks,
    data,
    company: buildDocCompany(company),
    recipient: { label: 'Recipient — job worker', fields: recipientFields },
    document: { label: 'Document', fields: documentFields },
    lines: dc.lines.map((l) => ({
      // LIVE master code/name first, issue-time snapshot only as the fallback.
      // itemCodeText is filled with the item NAME when the source line had no
      // code, so printing it alone put a part name under the item code.
      itemCode: l.itemCode ?? l.itemCodeText,
      itemName: l.itemName ?? l.itemNameText,
      uom: l.uom,
      // HSN lives on the item master and the challan line does not carry it,
      // so the column prints blank. Only 3 of 46 items have one today anyway.
      hsn: null,
      qty: Number(l.qty).toFixed(2),
      remarks: l.dcRemarks,
    })),
    totalQty: totalQty.toFixed(2),
    totalUom: uoms.length === 1 ? (uoms[0] ?? '') : '',
  };

  return openSheetPrintWindow(model);
}
