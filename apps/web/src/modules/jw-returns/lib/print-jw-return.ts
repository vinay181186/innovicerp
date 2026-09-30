// JW Return Challan print — the paper that goes back with the customer's
// machined goods (GST job-work return needs a challan).
//
// Renders on `@/lib/print/sheet-print` — THE INNOVIC SHEET, the same paper as
// every other challan (one letterhead, one table, Times). One goods row: a
// return challan returns exactly one JWSO line. Presentation only — every
// figure is the saved return.
//
// No print-template doc type exists for a JW return yet, so no special notes /
// terms blocks print; the sheet's own signature strip does.

import type { Client, Company, JwReturnChallanListItem } from '@innovic/shared';
import { itemCodeWithRev } from '@/lib/item-code';
import { buildDocCompany } from '@/lib/print/company';
import { type SheetField, challanDate, openSheetPrintWindow } from '@/lib/print/sheet-print';

export function printJwReturnChallan(
  r: JwReturnChallanListItem,
  client: Client | null | undefined,
  company: Company | null | undefined,
): boolean {
  const addressLines = [
    client?.addressLine1 ?? '',
    [client?.city, client?.state, client?.pincode].filter(Boolean).join(', '),
  ].filter(Boolean);

  const recipientFields: SheetField[] = [
    { label: 'Customer Code', value: client?.code ?? '', variant: 'mono' },
    { label: 'Name', value: client?.name ?? r.clientName ?? '', variant: 'name' },
    {
      label: 'Address',
      value: addressLines[0] ?? '',
      ...(addressLines.length > 1 ? { extra: addressLines.slice(1) } : {}),
    },
    { label: 'GSTIN', value: client?.gstNumber ?? '', variant: 'mono' },
  ];

  const documentFields: SheetField[] = [
    { label: 'Return No.', value: r.code, variant: 'mono', strong: true },
    { label: 'Return Date', value: challanDate(r.returnDate), variant: 'mono' },
    { label: 'JWSO No.', value: r.jwCodeText ?? '', variant: 'mono' },
    { label: 'Client PO No.', value: r.clientPoNo ?? '', variant: 'mono' },
  ];
  if (r.transport) documentFields.push({ label: 'Transporter', value: r.transport });
  if (r.vehicleNo)
    documentFields.push({ label: 'Vehicle No.', value: r.vehicleNo, variant: 'mono' });

  // Blank when the JWSO line has no unit — never an invented 'NOS' (A29).
  const uom = r.uom?.trim() ?? '';

  return openSheetPrintWindow({
    title: 'Job Work Return Challan',
    windowTitle: `JW Return Challan ${r.code}`,
    columns: 'challan',
    blocks: {},
    data: {},
    company: buildDocCompany(company),
    recipient: { label: 'Customer', fields: recipientFields },
    document: { label: 'Challan', fields: documentFields },
    lines: [
      {
        itemCode: itemCodeWithRev(r.itemCode, r.itemRevision, ''),
        itemName: r.partName,
        uom,
        hsn: r.hsnCode?.trim() || null,
        qty: r.qty.toFixed(2),
        remarks: r.remarks,
      },
    ],
    totalQty: r.qty.toFixed(2),
    totalUom: uom,
  });
}
