// Item Issue slip print — the paper that goes with material issued from the
// store (Issue Register, ADR-193 phase 3b). Same "Innovic Sheet" layout as the
// challans (sheet-print.ts, challan columns, no money).
//
// Left box "Issued To": the person, then what the slip was issued against
// (Job Card / Assembly SO / General department). Right box "Issue": the issue
// number FIRST (it names the PDF), date, Issue Against, references, purpose,
// issued by. Issue lines carry no drawing revision, POL, HSN or batch/heat
// number, so the code prints bare and those cells stay blank.

import type { Company, StoreIssueDetail } from '@innovic/shared';
import { ISSUE_AGAINST_LABELS, roundQty } from '@innovic/shared';
import { itemCodeWithRev } from '@/lib/item-code';
import { COMPANY_CARD_ADDRESS_LINES, buildDocCompany } from '@/lib/print/company';
import { esc } from '@/lib/print/doc-print';
import {
  type SheetField,
  type SheetPrintModel,
  challanDate,
  openSheetPrintWindow,
} from '@/lib/print/sheet-print';

export function printStoreIssue(args: {
  issue: StoreIssueDetail;
  company: Company | null | undefined;
}): boolean {
  const { issue, company } = args;

  const issuedFor: SheetField[] = [];
  if (issue.issueAgainst === 'job_card') {
    issuedFor.push({ label: 'JC No.', value: issue.jobCardCode ?? '', variant: 'mono' });
  } else if (issue.issueAgainst === 'assembly_so') {
    issuedFor.push({ label: 'SO No.', value: issue.salesOrderCode ?? '', variant: 'mono' });
    if (issue.salesOrderInternalNo)
      issuedFor.push({
        label: 'Internal SO No.',
        value: issue.salesOrderInternalNo,
        variant: 'mono',
      });
  }
  if (issue.department) issuedFor.push({ label: 'Department', value: issue.department });
  // Pre-0157 slips: the typed "Reference Type + No." is all they carry.
  if (!issue.jobCardCode && !issue.salesOrderCode && issue.legacyReference)
    issuedFor.push({ label: 'Reference', value: issue.legacyReference, variant: 'mono' });

  const recipientFields: SheetField[] = [
    { label: 'Issued To', value: issue.issuedTo ?? '', variant: 'name' },
    ...issuedFor,
  ];

  const documentFields: SheetField[] = [
    { label: 'Issue No.', value: issue.code, variant: 'mono' },
    { label: 'Issue Date', value: challanDate(issue.issueDate), variant: 'mono' },
    { label: 'Issue Against', value: ISSUE_AGAINST_LABELS[issue.issueAgainst] ?? '' },
    ...issuedFor.filter((f) => f.label !== 'Department'),
    { label: 'Purpose', value: issue.purpose ?? '' },
    { label: 'Issued By', value: issue.issuedByName ?? '' },
  ];
  if (issue.remarks) documentFields.push({ label: 'Remarks', value: issue.remarks });
  if (issue.reversedAt)
    documentFields.push({
      label: 'Reversed',
      value: [challanDate(issue.reversedAt.slice(0, 10)), issue.reversalReason]
        .filter(Boolean)
        .join(' — '),
      strong: true,
    });

  const totalQty = issue.lines.reduce((s, l) => s + Number(l.qty), 0);
  const uoms = [...new Set(issue.lines.map((l) => l.uom).filter(Boolean))];

  const model: SheetPrintModel = {
    title: 'Item Issue Slip',
    windowTitle: 'Item Issue Slip',
    columns: 'challan',
    blocks: {},
    data: {},
    company: { ...buildDocCompany(company), addressLines: [...COMPANY_CARD_ADDRESS_LINES] },
    recipient: { label: 'Issued To', fields: recipientFields },
    document: { label: 'Issue', fields: documentFields },
    lines: issue.lines.map((l) => ({
      itemCode: itemCodeWithRev(l.itemCode, null, ''),
      itemName: l.itemName,
      uom: l.uom,
      hsn: null,
      qty: String(roundQty(Number(l.qty))),
      remarks: l.returnedQty > 0 ? `Returned ${roundQty(Number(l.returnedQty))}` : null,
    })),
    totalQty: String(roundQty(totalQty)),
    totalUom: uoms.length === 1 ? (uoms[0] ?? '') : '',
    receiverCell: `Issued To — ${esc(issue.issuedTo || '')}<br>Name, Sign &amp; Date`,
  };

  return openSheetPrintWindow(model);
}
