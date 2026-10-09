// Multi-Level BOM print (ADR-225 phase 5): the header facts, then ONE table of
// the tree for the qty currently on the Tree tab (GET /ml-boms/:id/tree).

import {
  BOM_LINE_TYPE_LABEL,
  type Company,
  type MlBomDetail,
  type MlBomTreeNode,
  type MlBomTreeResponse,
} from '@innovic/shared';
import { esc } from '@/lib/print/doc-print';
import { type MlSheetColumn, printMlSheet, sheetQty, sheetTreeCode } from './ml-sheet-print';

const COLUMNS: MlSheetColumn<MlBomTreeNode>[] = [
  { header: 'Level', align: 'right', width: '9mm', cell: (n) => String(n.depth) },
  { header: 'Item Code', align: 'left', cell: (n) => sheetTreeCode(n.depth, n.itemCode) },
  { header: 'Item Name', align: 'left', cell: (n) => esc(n.itemName ?? '') },
  {
    header: 'Line Type',
    cell: (n) => (n.bomType ? esc(BOM_LINE_TYPE_LABEL[n.bomType]) : ''),
  },
  { header: 'Qty per Set', align: 'right', cell: (n) => sheetQty(n.qtyPerSet) },
  { header: 'Exploded Qty', align: 'right', bold: true, cell: (n) => sheetQty(n.explodedQty) },
  { header: 'UOM', cell: (n) => esc(n.uom ?? '') },
  {
    header: 'BOM No.',
    bold: true,
    // The sub-assembly's own BOM (and the top row: this BOM).
    cell: (n) => esc(n.mlBomCode ?? ''),
  },
  { header: 'RM Grade', cell: (n) => esc(n.rawMaterialGradeText ?? '') },
  { header: 'RM Size', cell: (n) => esc(n.rawMaterialSizeText ?? '') },
];

/** Returns false when the popup was blocked. */
export function printMlBom(args: {
  detail: MlBomDetail;
  tree: MlBomTreeResponse;
  company: Company | null | undefined;
  target?: Window | undefined;
}): boolean {
  const { detail, tree } = args;
  return printMlSheet({
    title: 'Multi-Level BOM',
    windowTitle: `Multi-Level BOM ${detail.code}`,
    company: args.company,
    facts: [
      { label: 'BOM No.', value: detail.code, strong: true },
      { label: 'Item Code', value: detail.itemCode ?? '', strong: true },
      { label: 'Item Name', value: detail.itemName ?? '' },
      { label: 'BOM Rev', value: String(detail.revision) },
      { label: 'Default', value: detail.isDefault ? 'Yes' : 'No' },
      { label: 'Qty', value: sheetQty(tree.qty), strong: true },
      { label: 'Remarks', value: detail.remarks ?? '' },
    ],
    columns: COLUMNS,
    rows: tree.nodes,
    target: args.target,
  });
}
