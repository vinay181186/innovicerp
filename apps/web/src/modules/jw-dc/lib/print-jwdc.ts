// Real-data Job Work Delivery Challan print (Print Templates P2, ADR-034).
// Assembles the challan print model from the loaded JW DC outward detail +
// vendor + company + the effective `jwdc_*` template blocks. Presentation only
// (DELTA #2). Mirrors legacy `_jwdcPrint` (L24611) — returnable gate pass under
// the GST job-work provisions.
//
// Renders on the shared sheet layout in `@/lib/print/sheet-print` — the same
// one the OSP DC and the Purchase Order print on, so all three carry one
// letterhead, one type scale and one border.

import type { Company, EffectivePrintTemplate, JwDcOutwardDetail, Vendor } from '@innovic/shared';
import {
  type SheetField,
  type SheetPrintModel,
  challanDate,
  challanEndDate,
  openSheetPrintWindow,
} from '@/lib/print/sheet-print';
import { buildDocCompany, companyAddressLines } from '@/lib/print/company';
import { fmtDate, templatesToBlocks } from '@/lib/print/doc-print';

export function printJwDc(args: {
  dc: JwDcOutwardDetail;
  vendor: Vendor | null | undefined;
  company: Company | null | undefined;
  templates: EffectivePrintTemplate[];
  currentUser?: string | undefined;
}): boolean {
  const { dc, vendor, company, templates } = args;

  const totalQty = dc.lines.reduce((s, l) => s + l.sentQty, 0);
  const linkedPo = dc.jwpoCodeText ?? '';
  const recipientName = vendor?.name ?? dc.vendorNameText ?? dc.vendorCodeText ?? '';
  const recipientAddress = vendor?.addressLine1 ?? '';
  const vehicleNo = dc.vehicleNo ?? '';
  const purpose = [...new Set(dc.lines.map((l) => l.processText).filter(Boolean))].join(', ');

  const data: Record<string, string> = {
    companyName: company?.name ?? '',
    companyAddress: companyAddressLines(company).join(', '),
    companyGSTIN: company?.gstNumber ?? '',
    date: fmtDate(new Date().toISOString()),
    currentUser: args.currentUser ?? '',
    dcNo: dc.code,
    dcDate: fmtDate(dc.dcDate),
    purpose,
    recipientName,
    recipientAddress,
    vehicleNo,
    driverName: '',
    linkedPONo: linkedPo,
    totalQty: String(totalQty),
  };

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
    // Resolved through the JWPO's lines back to the sales order; null when the
    // source job card came from a JWSO, and then this prints as a blank rule.
    { label: 'SO No.', value: dc.soCode ?? '', variant: 'mono' },
    { label: 'PO No.', value: linkedPo, variant: 'mono' },
    // Not a stored field — challan date + 3 months, which is the return window
    // the printed conditions promise.
    { label: 'Challan end date', value: challanEndDate(dc.dcDate), variant: 'mono', strong: true },
  ];
  if (vehicleNo) documentFields.push({ label: 'Vehicle No.', value: vehicleNo, variant: 'mono' });

  const model: SheetPrintModel = {
    title: 'Delivery Challan',
    windowTitle: 'Job Work Delivery Challan',
    blocks: templatesToBlocks('JW DC', templates),
    data,
    company: buildDocCompany(company),
    recipient: { label: 'Recipient — job worker', fields: recipientFields },
    document: { label: 'Document', fields: documentFields },
    lines: dc.lines.map((l) => ({
      // Live join first, snapshot second — exactly what the detail table above
      // shows. The snapshot `itemCodeText` falls back to the item NAME when the
      // source PO line had no code text, so printing it alone put a name under
      // the item code.
      itemCode: l.itemCode ?? l.itemCodeText,
      itemName: l.itemName ?? l.itemNameText,
      // Legacy's printed line column is "Description / Process" (L24614). This
      // layout has a Remarks column, so the process it names prints there —
      // still on the vendor's copy, and no longer glued to the part name.
      remarks: l.processText,
      // Legacy hardcodes NOS on the printed DC line too (L24614) and the JW DC
      // line carries no uom, so this is faithful — not the ISSUE-158 pattern.
      uom: 'NOS',
      // HSN lives on the item master and the JW DC line does not carry it, so
      // the column prints blank.
      hsn: null,
      qty: l.sentQty.toFixed(2),
    })),
    totalQty: totalQty.toFixed(2),
    totalUom: 'NOS',
  };

  return openSheetPrintWindow(model);
}
