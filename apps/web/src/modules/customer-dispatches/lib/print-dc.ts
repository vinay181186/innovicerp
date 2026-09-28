// Customer Dispatch — the Delivery Challan that travels with the truck.
//
// Renders on `@/lib/print/sheet-print` — THE INNOVIC SHEET, the same paper as
// the OSP / JW Delivery Challan, Purchase Order, GRN and invoices (one
// letterhead, one table, Times). Challan column set: POL · CODE/REV + item
// name · UOM · Qty. Presentation only — every figure is the saved dispatch.
//
// There is no print-template doc type for a customer dispatch yet, so no
// special notes / terms / footer blocks print; the sheet's own signature strip
// does.

import type { Client, Company, CustomerDispatchDetail } from '@innovic/shared';
import { itemCodeWithRev } from '@/lib/item-code';
import { buildDocCompany } from '@/lib/print/company';
import {
  type SheetField,
  type SheetPrintModel,
  buildSheetHtml,
  challanDate,
  openSheetPrintWindow,
} from '@/lib/print/sheet-print';

const FALLBACK_UOM = 'NOS';

function dispatchSheetModel(
  d: CustomerDispatchDetail,
  client: Client | null | undefined,
  company: Company | null | undefined,
): SheetPrintModel {
  const addressLines = [
    client?.addressLine1 ?? '',
    [client?.city, client?.state, client?.pincode].filter(Boolean).join(', '),
  ].filter(Boolean);

  const recipientFields: SheetField[] = [
    { label: 'Customer Code', value: client?.code ?? '', variant: 'mono' },
    { label: 'Name', value: client?.name ?? d.customer ?? '', variant: 'name' },
    {
      label: 'Address',
      value: addressLines[0] ?? '',
      ...(addressLines.length > 1 ? { extra: addressLines.slice(1) } : {}),
    },
    { label: 'GSTIN', value: client?.gstNumber ?? '', variant: 'mono' },
  ];

  const documentFields: SheetField[] = [
    { label: 'DC No.', value: d.code, variant: 'mono', strong: true },
    { label: 'DC Date', value: challanDate(d.dispatchDate), variant: 'mono' },
    { label: 'SO No.', value: d.soCode ?? '', variant: 'mono' },
    { label: 'Client PO No.', value: d.clientPoNo ?? '', variant: 'mono' },
  ];
  if (d.transport) documentFields.push({ label: 'Transporter', value: d.transport });
  if (d.vehicleNo)
    documentFields.push({ label: 'Vehicle No.', value: d.vehicleNo, variant: 'mono' });

  const uomOf = (u: string | null | undefined): string => u?.trim() || FALLBACK_UOM;
  const uoms = new Set(d.lines.map((l) => uomOf(l.uom)));
  const totalQty = d.lines.reduce((s, l) => s + l.qty, 0);

  return {
    title: 'Delivery Challan',
    windowTitle: `Delivery Challan ${d.code}`,
    columns: 'challan',
    blocks: {},
    data: {},
    company: buildDocCompany(company),
    recipient: { label: 'Customer', fields: recipientFields },
    document: { label: 'Challan', fields: documentFields },
    lines: d.lines.map((l) => ({
      // CODE/REV — the customer's drawing revision rides on the code.
      itemCode: itemCodeWithRev(l.itemCode ?? l.itemCodeText, l.itemRevision, ''),
      pol: l.clientPoLineNo,
      itemName: l.itemName,
      uom: uomOf(l.uom),
      hsn: null,
      qty: l.qty.toFixed(2),
      remarks: null,
    })),
    totalQty: totalQty.toFixed(2),
    totalUom: uoms.size === 1 ? ([...uoms][0] ?? '') : '',
  };
}

/** The sheet markup (no <style>) — the dispatch page previews exactly this. */
export function dispatchSheetHtml(
  d: CustomerDispatchDetail,
  client: Client | null | undefined,
  company: Company | null | undefined,
): string {
  return buildSheetHtml(dispatchSheetModel(d, client, company));
}

/** Opens the print window. False when the popup was blocked. */
export function printDispatchChallan(
  d: CustomerDispatchDetail,
  client: Client | null | undefined,
  company: Company | null | undefined,
): boolean {
  return openSheetPrintWindow(dispatchSheetModel(d, client, company));
}
