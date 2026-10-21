// NC Report print — the Non-Conformance record on the shared sheet
// (`@/lib/print/sheet-print`), for the quality file. Same paper as the PO /
// challan / SO prints. Presentation only: every value is read off the loaded NC
// (NcRegister) — nothing is computed here.
//
//   Left box  "Raised Against" — where the deviation came from: JC No., the
//             operation, machine / operator, the source vendor + its PO / GRN /
//             outward challan (OSP and incoming NCs), SO No. / Internal SO No.
//   Right box "NC" — NC No. FIRST (it names the PDF), then the NC facts and the
//             disposition outcome (rework JC, return DC, replacement PO, CAPA).
//   Line      the deviated item: code/rev, name, Qty = rejectedQty, the defect
//             text under the name, disposition remarks in Remarks.
//
// The NC read shape carries no UOM, root cause or corrective action (those live
// on the CAPA), so none are printed; the CAPA No. is, when one links this NC.

import {
  NC_DISPOSITION_LABELS,
  NC_REASON_CATEGORY_LABELS,
  NC_STATUS_LABELS,
  type Company,
  type NcRegister,
  opSrNo,
  roundQty,
} from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { COMPANY_CARD_ADDRESS_LINES, buildDocCompany } from '@/lib/print/company';
import { type SheetField, openSheetPrintWindow } from '@/lib/print/sheet-print';

/** Pushes a field only when it has a value — a blank row would print a dotted
 *  rule, which on an NC reads as "not filled in" rather than "not applicable". */
function opt(fields: SheetField[], label: string, value: string | null | undefined, mono = false) {
  const v = (value ?? '').trim();
  if (v) fields.push({ label, value: v, ...(mono ? { variant: 'mono' as const } : {}) });
}

export function printNcReport(args: {
  nc: NcRegister;
  company: Company | null | undefined;
  /** The job card's number. The NC read shape carries only `jobCardId`, so the
   *  caller supplies it (list row `jcCode`; detail page's joined JC ops). */
  jcCode?: string | null | undefined;
  /** ADR-202 — the NC has a pending edit; the sheet prints "Draft — awaiting approval". */
  draft?: boolean | undefined;
}): boolean {
  const { nc, company } = args;
  const operation = nc.operationText ?? nc.qcOperationText;
  const opText = [nc.opSeq != null ? `Op ${opSrNo(nc.opSeq)}` : '', operation ?? '']
    .filter(Boolean)
    .join(' — ');

  const raisedAgainst: SheetField[] = [];
  opt(raisedAgainst, 'JC No.', args.jcCode, true);
  opt(raisedAgainst, 'Operation', opText);
  opt(raisedAgainst, 'Machine', nc.machineCodeText, true);
  opt(raisedAgainst, 'Operator', nc.operatorText);
  if (nc.sourceVendorId) {
    opt(
      raisedAgainst,
      'Source Vendor',
      [nc.sourceVendorCode, nc.sourceVendorName].filter(Boolean).join(' — '),
    );
    opt(raisedAgainst, 'Source PO No.', nc.sourcePoCode, true);
    opt(raisedAgainst, 'Source GRN No.', nc.sourceGrnCode, true);
    opt(raisedAgainst, 'Sent on DC No.', nc.sourceDeliveryChallanCode, true);
  }
  opt(raisedAgainst, 'SO No.', nc.soCodeText, true);
  opt(raisedAgainst, 'Internal SO No.', nc.soInternalNo, true);
  if (raisedAgainst.length === 0) raisedAgainst.push({ label: 'JC No.', value: '' });

  const ncFields: SheetField[] = [
    { label: 'NC No.', value: nc.code, variant: 'mono' },
    { label: 'NC Date', value: fmtDate(nc.ncDate, ''), variant: 'mono' },
    { label: 'Reason Category', value: NC_REASON_CATEGORY_LABELS[nc.reasonCategory] },
    { label: 'NC Status', value: NC_STATUS_LABELS[nc.status] },
    {
      label: 'Disposition',
      value: nc.disposition ? NC_DISPOSITION_LABELS[nc.disposition] : '',
      strong: true,
    },
  ];
  opt(ncFields, 'Disposition Date', fmtDate(nc.dispositionDate, ''), true);
  opt(ncFields, 'Disposition By', nc.dispositionByText);
  opt(ncFields, 'Reported By', nc.reportedByText);
  opt(ncFields, nc.disposition === 'repair' ? 'Repair JC' : 'Rework JC', nc.childJobCardCode, true);
  // A Make Fresh job card is a NEW card, not rework — the detail screen's "New JC".
  if (!nc.childJobCardCode && nc.disposition === 'make_fresh') {
    opt(ncFields, 'New JC', nc.reworkJcCodeText, true);
  }
  opt(ncFields, 'DC No.', nc.deliveryChallanCode, true);
  opt(ncFields, 'Replacement PO No.', nc.replacementPoCode, true);
  opt(ncFields, 'CAPA No.', nc.linkedCapaCode, true);
  opt(ncFields, 'Closed Date', fmtDate(nc.closedAt, ''), true);

  const qty = String(roundQty(Number(nc.rejectedQty)));

  return openSheetPrintWindow({
    title: 'NC Report',
    windowTitle: 'NC Report',
    draft: args.draft,
    blocks: {},
    data: {},
    company: { ...buildDocCompany(company), addressLines: [...COMPANY_CARD_ADDRESS_LINES] },
    recipient: { label: 'Raised Against', fields: raisedAgainst },
    document: { label: 'NC', fields: ncFields },
    lines: [
      {
        // Live code + the SO line's drawing revision; the typed snapshot bare.
        itemCode: nc.itemCode ? itemCodeWithRev(nc.itemCode, nc.itemRevision) : nc.itemCodeText,
        pol: nc.clientPoLineNo,
        itemName: nc.itemName ?? nc.itemNameText,
        uom: null,
        hsn: null,
        qty,
        description: nc.reason ?? NC_REASON_CATEGORY_LABELS[nc.reasonCategory],
        descLabel: 'Defect',
        remarks: nc.dispositionRemarks,
      },
    ],
    totalQty: qty,
    totalUom: '',
    receiverCell: 'Checked by — QC<br>Name, Sign &amp; Date',
  });
}
