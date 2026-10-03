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
import { partyForPrint } from '@/lib/print/party-copy';
import {
  type SheetField,
  type SheetPrintModel,
  buildSheetHtml,
  challanDate,
  openSheetPrintWindow,
} from '@/lib/print/sheet-print';

function dispatchSheetModel(
  d: CustomerDispatchDetail,
  client: Client | null | undefined,
  company: Company | null | undefined,
): SheetPrintModel {
  // The paper's own copy of the customer (0186, plan D7); the live master
  // only for a paper made before 0186.
  const party = partyForPrint(d.clientCopy, client, d.customer);
  const addressLines = party.addressLines;

  const recipientFields: SheetField[] = [
    { label: 'Customer Code', value: party.code, variant: 'mono' },
    { label: 'Name', value: party.name, variant: 'name' },
    {
      label: 'Address',
      value: addressLines[0] ?? '',
      ...(addressLines.length > 1 ? { extra: addressLines.slice(1) } : {}),
    },
    { label: 'GSTIN', value: party.gstNumber, variant: 'mono' },
  ];

  const documentFields: SheetField[] = [
    { label: 'DC No.', value: d.code, variant: 'mono', strong: true },
    { label: 'DC Date', value: challanDate(d.dispatchDate), variant: 'mono' },
    { label: 'SO No.', value: d.soCode ?? '', variant: 'mono' },
    // ADR-207 — the SO's Internal SO No. on its own labelled line, when set.
    ...(d.soInternalNo
      ? [{ label: 'Internal SO No.', value: d.soInternalNo, variant: 'mono' as const }]
      : []),
    { label: 'Client PO No.', value: d.clientPoNo ?? '', variant: 'mono' },
  ];
  if (d.transport) documentFields.push({ label: 'Transporter', value: d.transport });
  if (d.vehicleNo)
    documentFields.push({ label: 'Vehicle No.', value: d.vehicleNo, variant: 'mono' });

  // Blank when the line has no unit — never an invented 'NOS' (A29).
  const uomOf = (u: string | null | undefined): string => u?.trim() ?? '';
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
      // HSN off the item master (A4); the column prints only when a line has one.
      hsn: l.hsnCode?.trim() || null,
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
