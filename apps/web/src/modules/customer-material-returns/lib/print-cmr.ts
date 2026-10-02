// Customer Material Return print — the challan that goes back with the
// customer's OWN raw material (spare good material, or pieces Incoming QC
// rejected on a Party GRN). ADR-203, owner decision D3.
//
// Renders on `@/lib/print/sheet-print` — THE INNOVIC SHEET, the same paper as
// the DC / JW Return challans (one letterhead, one table, Times, no box in a
// box). Presentation only — every figure is the saved return.
//
// Each line prints the Customer RM code + name, its UOM (a Customer RM item is
// always NOS — ADR-203 D1/D2), the qty, and the return kind in the Remarks
// column (with the Party GRN No. for a rejected line). The sheet's own foot
// strip is the signature row.

import type { Client, Company, CustomerMaterialReturnDetail } from '@innovic/shared';
import { buildDocCompany } from '@/lib/print/company';
import { partyForPrint } from '@/lib/print/party-copy';
import {
  type SheetField,
  type SheetLine,
  challanDate,
  openSheetPrintWindow,
} from '@/lib/print/sheet-print';
import { CMR_KIND_LABEL } from '../components/cmr-columns';

/** A Customer RM item is created with UOM NOS (ADR-203). */
const CMR_UOM = 'NOS';

export function printCustomerMaterialReturn(
  r: CustomerMaterialReturnDetail,
  client: Client | null | undefined,
  company: Company | null | undefined,
): boolean {
  // No snapshot of the customer is kept on this paper, so the live master.
  const party = partyForPrint(null, client, r.clientName);
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
    { label: 'Return No.', value: r.code, variant: 'mono', strong: true },
    { label: 'Return Date', value: challanDate(r.returnDate), variant: 'mono' },
    { label: 'JWSO No.', value: r.jwCode ?? '', variant: 'mono' },
    { label: 'Vehicle No.', value: r.vehicleNo ?? '', variant: 'mono' },
  ];
  if (r.remarks) documentFields.push({ label: 'Remarks', value: r.remarks });

  const lines: SheetLine[] = r.lines.map((l) => {
    const why = [
      CMR_KIND_LABEL[l.kind],
      l.kind === 'rejected' && l.partyGrnCode ? `Party GRN ${l.partyGrnCode}` : '',
      l.jwLineNo != null ? `JWSO L${l.jwLineNo}${l.partCode ? ` (${l.partCode})` : ''}` : '',
    ].filter(Boolean);
    return {
      itemCode: l.rmItemCode ?? l.partyMaterialCode ?? '',
      itemName: l.rmItemName,
      uom: CMR_UOM,
      hsn: null,
      qty: String(l.qty),
      remarks: why.join(' · '),
    };
  });
  const total = r.lines.reduce((s, l) => s + l.qty, 0);

  return openSheetPrintWindow({
    title: 'Customer Material Return',
    windowTitle: `Customer Material Return ${r.code}`,
    columns: 'challan',
    blocks: {},
    data: {},
    company: buildDocCompany(company),
    recipient: { label: 'Customer', fields: recipientFields },
    document: { label: 'Return', fields: documentFields },
    lines,
    totalQty: String(total),
    totalUom: CMR_UOM,
    receiverCell: 'Received By (Customer)<br>Name, Sign &amp; Date',
  });
}
