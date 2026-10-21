// Party GRN print — the receipt of the CUSTOMER's own raw material against a
// JWSO (ADR-194 / ADR-203). Renders on `@/lib/print/sheet-print`, the shared
// Innovic sheet, with the `grn` column set (Received · Accepted · Deviated ·
// QC Status) — the same columns the purchase GRN prints, because a Party GRN
// line carries the same three quantities after Incoming QC.
//
// Presentation only: every figure is the saved receipt (GET /party-grn/:id).
// No money — party stock is zero-value. A Customer RM item is always NOS
// (ADR-203 D1/D2), the same constant the Customer Material Return prints.

import type { Client, Company, PartyGrnDetail } from '@innovic/shared';
import { itemCodeWithRev } from '@/lib/item-code';
import { COMPANY_CARD_ADDRESS_LINES, buildDocCompany } from '@/lib/print/company';
import { partyForPrint } from '@/lib/print/party-copy';
import {
  type SheetField,
  type SheetLine,
  challanDate,
  openSheetPrintWindow,
} from '@/lib/print/sheet-print';

/** A Customer RM item is created with UOM NOS (ADR-203). */
const PARTY_GRN_UOM = 'NOS';

export function printPartyGrn(args: {
  grn: PartyGrnDetail;
  client: Client | null | undefined;
  company: Company | null | undefined;
}): boolean {
  const { grn, client, company } = args;

  // No snapshot of the customer is kept on this paper, so the live master,
  // falling back to the name / code text the receipt itself carries.
  const party = partyForPrint(null, client, grn.clientName ?? grn.clientCodeText);
  const addressLines = party.addressLines;
  const recipientFields: SheetField[] = [
    { label: 'Customer Code', value: party.code || (grn.clientCodeText ?? ''), variant: 'mono' },
    { label: 'Name', value: party.name, variant: 'name' },
    {
      label: 'Address',
      value: addressLines[0] ?? '',
      ...(addressLines.length > 1 ? { extra: addressLines.slice(1) } : {}),
    },
    { label: 'GSTIN', value: party.gstNumber, variant: 'mono' },
  ];

  // GRN No. first — the PDF is named from it.
  const qcDone = grn.qcPendingLines <= 0;
  const documentFields: SheetField[] = [
    { label: 'GRN No.', value: grn.code, variant: 'mono', strong: true },
    { label: 'GRN Date', value: challanDate(grn.grnDate), variant: 'mono' },
    { label: 'JWSO No.', value: grn.jwCodeText ?? '', variant: 'mono' },
  ];
  if (grn.clientPoNo)
    documentFields.push({ label: 'Client PO No.', value: grn.clientPoNo, variant: 'mono' });
  if (grn.dcNo)
    documentFields.push({ label: 'Customer Challan No.', value: grn.dcNo, variant: 'mono' });
  documentFields.push({ label: 'QC Status', value: qcDone ? 'QC done' : 'Waiting QC' });
  if (grn.receivedByText) documentFields.push({ label: 'Received By', value: grn.receivedByText });
  if (grn.remarks) documentFields.push({ label: 'Remarks', value: grn.remarks });

  const sorted = [...grn.lines].filter((l) => !l.deletedAt).sort((a, b) => a.lineNo - b.lineNo);
  const lines: SheetLine[] = sorted.map((l) => {
    const waiting = l.qcAt == null;
    return {
      // Customer RM code; Party GRN lines carry no revision of their own.
      itemCode: itemCodeWithRev(l.partyMaterialCodeText, null, ''),
      // The customer's PO line number on the JWSO line (ADR-236).
      pol: l.clientPoLineNo,
      itemName: l.partyMaterialName,
      uom: PARTY_GRN_UOM,
      qty: String(l.receivedQty),
      // ADR-203: 0 until Incoming QC — print a dash, not a false zero.
      acceptedQty: waiting ? '—' : String(l.acceptedQty),
      rejectedQty: waiting ? '—' : String(l.rejectedQty),
      qcStatus: waiting ? 'Waiting QC' : 'QC done',
      ...(l.rejectReason ? { description: l.rejectReason, descLabel: 'Deviation Reason' } : {}),
    };
  });
  const totalReceived = sorted.reduce((s, l) => s + l.receivedQty, 0);
  const totalAccepted = sorted.reduce((s, l) => s + (l.qcAt == null ? 0 : l.acceptedQty), 0);
  const totalRejected = sorted.reduce((s, l) => s + (l.qcAt == null ? 0 : l.rejectedQty), 0);

  return openSheetPrintWindow({
    title: 'Party GRN',
    windowTitle: `Party GRN ${grn.code}`,
    columns: 'grn',
    blocks: {},
    data: {},
    company: { ...buildDocCompany(company), addressLines: [...COMPANY_CARD_ADDRESS_LINES] },
    recipient: { label: 'Customer', fields: recipientFields },
    document: { label: 'Receipt', fields: documentFields },
    lines,
    totalQty: String(totalReceived),
    totalAccepted: String(totalAccepted),
    totalRejected: String(totalRejected),
    totalUom: PARTY_GRN_UOM,
    receiverCell: 'Received By — Store<br>Name, Sign &amp; Date',
  });
}
