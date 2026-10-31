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
import { sheetLineNotes } from '@/lib/print/sheet-line-notes';
import {
  type SheetField,
  type SheetLine,
  challanDate,
  openSheetPrintWindow,
} from '@/lib/print/sheet-print';
import { pgrnQcState, pgrnQcStateOfGrn, qcPendingQtyOf } from './qc-state';

/** A Customer RM item is created with UOM NOS (ADR-203). */
const PARTY_GRN_UOM = 'NOS';

export function printPartyGrn(args: {
  grn: PartyGrnDetail;
  client: Client | null | undefined;
  company: Company | null | undefined;
  /** ADR-235 — stamp the sheet CANCELLED (the list row knows; the detail's
   *  cancelledAt / deletedAt say so too). */
  cancelled?: boolean | undefined;
}): boolean {
  const { grn, client, company } = args;
  const cancelled = Boolean(args.cancelled || grn.cancelledAt || grn.deletedAt);

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
  // Partial QC (0233): Waiting QC · Partial · QC done (lib/qc-state.ts).
  const grnState = pgrnQcStateOfGrn(grn);
  const documentFields: SheetField[] = [
    { label: 'GRN No.', value: grn.code, variant: 'mono', strong: true },
    { label: 'GRN Date', value: challanDate(grn.grnDate), variant: 'mono' },
    { label: 'JWSO No.', value: grn.jwCodeText ?? '', variant: 'mono' },
  ];
  if (grn.clientPoNo)
    documentFields.push({ label: 'Client PO No.', value: grn.clientPoNo, variant: 'mono' });
  if (grn.dcNo)
    documentFields.push({ label: 'Customer Challan No.', value: grn.dcNo, variant: 'mono' });
  documentFields.push({
    label: 'QC Status',
    value: grnState === 'waiting' ? 'Waiting QC' : grnState === 'partial' ? 'Partial' : 'QC done',
  });
  if (grn.receivedByText) documentFields.push({ label: 'Received By', value: grn.receivedByText });
  if (grn.remarks) documentFields.push({ label: 'Remarks', value: grn.remarks });

  // A Cancelled GRN's lines were stamped deleted WITH the header; the server
  // already returns exactly those (a line removed earlier is left out), so a
  // cancelled GRN prints every line it was sent with.
  const sorted = [...grn.lines]
    .filter((l) => cancelled || !l.deletedAt)
    .sort((a, b) => a.lineNo - b.lineNo);
  const lines: SheetLine[] = sorted.map((l) => {
    const st = pgrnQcState(l);
    const waiting = st === 'waiting';
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
      qcStatus: waiting
        ? 'Waiting QC'
        : st === 'partial'
          ? `Partial (${qcPendingQtyOf(l)} pending)`
          : 'QC done',
      ...sheetLineNotes([
        { label: 'Deviation Reason', text: l.rejectReason },
        { label: 'QC Remarks', text: l.qcRemarks },
      ]),
    };
  });
  const totalReceived = sorted.reduce((s, l) => s + l.receivedQty, 0);
  // An untouched line carries 0 / 0, so a plain sum is right.
  const totalAccepted = sorted.reduce((s, l) => s + l.acceptedQty, 0);
  const totalRejected = sorted.reduce((s, l) => s + l.rejectedQty, 0);

  return openSheetPrintWindow({
    title: 'Party GRN',
    windowTitle: `Party GRN ${grn.code}`,
    columns: 'grn',
    cancelled,
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
