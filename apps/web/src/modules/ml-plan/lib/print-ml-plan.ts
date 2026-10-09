// Multi-Level Plan print (ADR-225 phase 5): the header facts, then ONE table
// of the plan rows — everything already loaded on the detail page.

import {
  BOM_LINE_TYPE_LABEL,
  ML_PLAN_STATUS_LABEL,
  type Company,
  type MlPlanDetail,
  type MlPlanNode,
} from '@innovic/shared';
import { fmtDateTime } from '@/lib/date';
import { esc } from '@/lib/print/doc-print';
import {
  type MlSheetColumn,
  printMlSheet,
  sheetQty,
  sheetTreeCode,
} from '@/modules/ml-bom/lib/ml-sheet-print';

const num = (
  header: string,
  pick: (n: MlPlanNode) => string | null,
  bold = false,
): MlSheetColumn<MlPlanNode> => ({
  header,
  align: 'right',
  bold,
  cell: (n) => sheetQty(pick(n)),
});

const COLUMNS: MlSheetColumn<MlPlanNode>[] = [
  { header: 'Level', align: 'right', width: '9mm', cell: (n) => String(n.depth) },
  { header: 'Item Code', align: 'left', cell: (n) => sheetTreeCode(n.depth, n.itemCode) },
  { header: 'Item Name', align: 'left', cell: (n) => esc(n.itemName ?? '') },
  {
    header: 'Line Type',
    cell: (n) => (n.bomType ? esc(BOM_LINE_TYPE_LABEL[n.bomType]) : ''),
  },
  num('Qty per Set', (n) => n.qtyPerSet),
  num('Gross Need', (n) => n.grossNeedQty),
  num('From Stock', (n) => n.fromStockQty),
  num('On PO / PR', (n) => n.onPoPrQty),
  num('Net Need', (n) => n.netNeedQty, true),
  num('Raised', (n) => n.raisedQty),
  num('To Raise', (n) => n.toRaiseQty, true),
  { header: 'UOM', cell: (n) => esc(n.uom ?? '') },
];

/** Returns false when the popup was blocked. */
export function printMlPlan(args: {
  detail: MlPlanDetail;
  company: Company | null | undefined;
}): boolean {
  const { detail } = args;
  return printMlSheet({
    title: 'Multi-Level Plan',
    windowTitle: `Multi-Level Plan ${detail.code}`,
    company: args.company,
    facts: [
      { label: 'MLP No.', value: detail.code, strong: true },
      { label: 'SO No.', value: detail.soCode, strong: true },
      { label: 'Internal SO No.', value: detail.soInternalNo ?? '', strong: true },
      { label: 'POL', value: detail.clientPoLineNo ?? '' },
      { label: 'Item Code', value: detail.itemCode ?? '', strong: true },
      { label: 'Item Name', value: detail.itemName ?? '' },
      { label: 'Order Qty', value: String(detail.orderQty) },
      { label: 'Plan Qty', value: String(detail.planQty), strong: true },
      { label: 'BOM No.', value: detail.mlBomCode, strong: true },
      { label: 'BOM Rev', value: String(detail.mlBomRevision) },
      { label: 'Status', value: ML_PLAN_STATUS_LABEL[detail.status] },
      { label: 'Snapshot At', value: fmtDateTime(detail.snapshotAt, '') },
    ],
    columns: COLUMNS,
    rows: [...detail.nodes].sort((a, b) => a.seq - b.seq),
  });
}
