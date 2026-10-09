// The Multi-Level Plan detail page's Plan tab (ADR-225 phase 3): the copied
// tree as one flat table, indented by depth exactly as the Multi-Level BOM
// Tree tab. Numbers are right-aligned (owner decision 2026-09-26).

import { BOM_LINE_TYPE_LABEL, type MlPlanNode } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { DataTable, type DataTableColumn } from '@/ui/data';

const dash = <span className="text3">—</span>;

/** Quantities arrive as numeric strings; drop trailing zeros only. */
const qty = (v: string | null): React.ReactNode => (v == null ? dash : String(Number(v)));

const num = (
  header: string,
  pick: (n: MlPlanNode) => string | null,
  strong = false,
): DataTableColumn<MlPlanNode> => ({
  header,
  align: 'right',
  nowrap: true,
  className: strong ? 'mono fw-700' : 'mono',
  render: (n) => qty(pick(n)),
});

const COLUMNS: DataTableColumn<MlPlanNode>[] = [
  { header: 'Level', align: 'right', className: 'mono', render: (n) => n.depth },
  {
    header: 'Item Code',
    align: 'left',
    nowrap: true,
    render: (n) => (
      <span style={{ paddingLeft: n.depth * 18 }}>
        {n.depth > 0 ? <span className="text3">└ </span> : null}
        {n.itemCode ? (
          // A sub-assembly (and the top row) reads bold; a plain part one step
          // lighter — still full --text, never the faint one.
          <span
            className="mono"
            style={{ color: 'var(--text)', fontWeight: n.isSubAssembly ? 700 : 500 }}
          >
            {n.itemCode}
          </span>
        ) : (
          dash
        )}
      </span>
    ),
  },
  {
    header: 'Item Name',
    align: 'left',
    ellipsis: true,
    render: (n) => n.itemName ?? dash,
    title: (n) => n.itemName ?? '',
  },
  {
    header: 'Line Type',
    nowrap: true,
    render: (n) => (n.bomType ? BOM_LINE_TYPE_LABEL[n.bomType] : dash),
  },
  num('Qty per Set', (n) => n.qtyPerSet),
  num('Gross Need', (n) => n.grossNeedQty),
  num('From Stock', (n) => n.fromStockQty),
  num('On PO / PR', (n) => n.onPoPrQty),
  num('Net Need', (n) => n.netNeedQty, true),
  num('Raised', (n) => n.raisedQty),
  num('To Raise', (n) => n.toRaiseQty, true),
  { header: 'UOM', nowrap: true, className: 'mono', render: (n) => n.uom ?? dash },
  {
    header: 'BOM No.',
    nowrap: true,
    render: (n) =>
      n.isSubAssembly && n.mlBomId && n.mlBomCode ? (
        <Link to="/ml-boms/$id" params={{ id: n.mlBomId }} className="td-code">
          {n.mlBomCode}
        </Link>
      ) : (
        dash
      ),
  },
  { header: 'RM Grade', nowrap: true, render: (n) => n.rawMaterialGradeText ?? dash },
  { header: 'RM Size', nowrap: true, render: (n) => n.rawMaterialSizeText ?? dash },
];

export function MlPlanNodesTable({ nodes }: { nodes: MlPlanNode[] }): React.JSX.Element {
  const rows = [...nodes].sort((a, b) => a.seq - b.seq);
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      rowKey={(n) => n.id}
      density="compact"
      autoWidth
      emptyText="No lines."
    />
  );
}
