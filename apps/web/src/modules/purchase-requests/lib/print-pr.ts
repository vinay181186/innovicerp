// Purchase Request print — on the shared "Innovic Sheet" (sheet-print.ts), the
// same layout every other document prints on. Presentation only.
//
// A PR is one table row (ADR-015 #2: no lines table), so the goods table has
// exactly one line. No money: a request is not a price commitment, and the
// 'challan' column set carries none.
//
// The left box is "Requested By". The PR detail carries `createdBy` as a uuid
// only — no raiser name and no department — so "Raised By" prints as a blank
// rule to sign on, and the sheet keeps its "Prepared By" foot panel. Nothing
// here is invented: every value is a field of PurchaseRequestDetail.

import type { Company, PurchaseRequestDetail } from '@innovic/shared';
import { opSrNo, roundQty } from '@innovic/shared';
import {
  type SheetField,
  type SheetPrintModel,
  challanDate,
  openSheetPrintWindow,
} from '@/lib/print/sheet-print';
import { itemCodeWithRev } from '@/lib/item-code';
import { COMPANY_CARD_ADDRESS_LINES, buildDocCompany } from '@/lib/print/company';
import { soNoWithInternal } from '@/lib/so-number';
import { PR_STATUS_LABELS } from './pr-labels';

export function printPurchaseRequest(args: {
  pr: PurchaseRequestDetail;
  company: Company | null | undefined;
}): boolean {
  const { pr, company } = args;
  const qty = String(roundQty(Number(pr.qty)));

  // FIRST field = PR No. — the downloaded PDF is named from it.
  const documentFields: SheetField[] = [
    { label: 'PR No.', value: pr.code, variant: 'mono' },
    { label: 'PR Date', value: challanDate(pr.prDate), variant: 'mono' },
  ];
  if (pr.requiredDate)
    documentFields.push({
      label: 'Due Date',
      value: challanDate(pr.requiredDate),
      variant: 'mono',
      strong: true,
    });
  documentFields.push({ label: 'PR Status', value: PR_STATUS_LABELS[pr.status] ?? pr.status });
  if (pr.soCode)
    documentFields.push({
      label: 'SO No.',
      value: soNoWithInternal(pr.soCode, pr.soInternalNo),
      variant: 'mono',
    });
  if (pr.sourceJcCode)
    documentFields.push({
      label: 'JC No.',
      value: pr.sourceJcOpSeq
        ? `${pr.sourceJcCode} · Op ${opSrNo(pr.sourceJcOpSeq)}`
        : pr.sourceJcCode,
      variant: 'mono',
    });
  if (pr.operation) documentFields.push({ label: 'Operation', value: pr.operation });

  const requesterFields: SheetField[] = [{ label: 'Raised By', value: '' }];

  const model: SheetPrintModel = {
    title: 'Purchase Request',
    windowTitle: 'Purchase Request',
    columns: 'challan',
    blocks: {},
    data: {},
    company: { ...buildDocCompany(company), addressLines: [...COMPANY_CARD_ADDRESS_LINES] },
    recipient: { label: 'Requested By', fields: requesterFields },
    document: { label: 'Request', fields: documentFields },
    lines: [
      {
        // Live master code first, typed text as the fallback; the revision only
        // when the PR traces back to an SO line (itemCodeWithRev rules).
        itemCode: itemCodeWithRev(pr.itemCode ?? pr.itemCodeText, pr.itemRevision, ''),
        pol: pr.clientPoLineNo,
        itemName: pr.itemName,
        // The PR read carries no unit — the column prints a blank rule.
        uom: null,
        hsn: null,
        qty,
        remarks: pr.remarks,
      },
    ],
    totalQty: qty,
    totalUom: '',
    // Raiser is not named on this sheet (no name in the PR read), so the
    // "Prepared By" panel stays.
    hidePreparedBy: false,
  };

  return openSheetPrintWindow(model);
}
