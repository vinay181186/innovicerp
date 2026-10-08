// The Multi-Level BOM detail page's tab bodies (ADR-225): Lines · Tree ·
// Exploded Items · Used In. History is the shared <DocumentHistory>.

import {
  BOM_LINE_TYPE_LABEL,
  type MlBomDetail,
  type MlBomExplodedItem,
  type MlBomLine,
  type MlBomTreeNode,
  type MlBomTreeResponse,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { PageState } from '@/ui/layout';

const dash = <span className="text3">—</span>;

function lineTypeLabel(t: keyof typeof BOM_LINE_TYPE_LABEL | null): React.ReactNode {
  return t ? BOM_LINE_TYPE_LABEL[t] : dash;
}

function BomLink({ id, code }: { id: string | null; code: string | null }): React.JSX.Element {
  if (!id || !code) return dash;
  return (
    <Link to="/ml-boms/$id" params={{ id }} className="td-code">
      {code}
    </Link>
  );
}

const strongCode = (code: string | null): React.ReactNode =>
  code ? (
    <span className="mono fw-700" style={{ color: 'var(--text)' }}>
      {code}
    </span>
  ) : (
    dash
  );

/** Quantities arrive as numeric strings; drop trailing zeros only. */
const qty = (v: string | null): React.ReactNode => (v == null ? dash : String(Number(v)));

// ── Lines ────────────────────────────────────────────────────────────────

const LINE_COLUMNS: DataTableColumn<MlBomLine>[] = [
  { header: 'Sr No', align: 'right', className: 'mono fw-700', render: (l) => l.lineNo },
  { header: 'Item Code', nowrap: true, render: (l) => strongCode(l.childItemCode) },
  {
    header: 'Item Name',
    align: 'left',
    ellipsis: true,
    render: (l) => l.childItemName ?? dash,
    title: (l) => l.childItemName ?? '',
  },
  { header: 'UOM', nowrap: true, className: 'mono', render: (l) => l.childUom ?? dash },
  {
    header: 'Qty per Set',
    align: 'right',
    nowrap: true,
    className: 'mono fw-700',
    render: (l) => qty(l.qtyPerSet),
  },
  { header: 'Line Type', nowrap: true, render: (l) => lineTypeLabel(l.bomType) },
  {
    header: 'BOM No.',
    nowrap: true,
    render: (l) => <BomLink id={l.childMlBomId} code={l.childMlBomCode} />,
  },
  { header: 'RM Grade', nowrap: true, render: (l) => l.rawMaterialGradeText ?? dash },
  { header: 'RM Size', nowrap: true, render: (l) => l.rawMaterialSizeText ?? dash },
  {
    header: 'Remarks',
    align: 'left',
    ellipsis: true,
    render: (l) => l.remarks ?? dash,
    title: (l) => l.remarks ?? '',
  },
];

export function MlBomLinesTab({ detail }: { detail: MlBomDetail }): React.JSX.Element {
  return (
    <DataTable
      columns={LINE_COLUMNS}
      rows={detail.lines}
      density="compact"
      autoWidth
      emptyText="No lines."
    />
  );
}

// ── Tree ─────────────────────────────────────────────────────────────────

const TREE_COLUMNS: DataTableColumn<MlBomTreeNode>[] = [
  { header: 'Level', align: 'right', className: 'mono', render: (n) => n.depth },
  {
    header: 'Item Code',
    align: 'left',
    nowrap: true,
    // Indented by depth, exactly as the Rework Tree (jc-flow-panels.tsx).
    render: (n) => (
      <span style={{ paddingLeft: n.depth * 18 }}>
        {n.depth > 0 ? <span className="text3">└ </span> : null}
        {strongCode(n.itemCode)}
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
  { header: 'Line Type', nowrap: true, render: (n) => lineTypeLabel(n.bomType) },
  {
    header: 'Qty per Set',
    align: 'right',
    nowrap: true,
    className: 'mono',
    render: (n) => qty(n.qtyPerSet),
  },
  {
    header: 'Exploded Qty',
    align: 'right',
    nowrap: true,
    className: 'mono fw-700',
    render: (n) => qty(n.explodedQty),
  },
  { header: 'UOM', nowrap: true, className: 'mono', render: (n) => n.uom ?? dash },
  {
    header: 'BOM No.',
    nowrap: true,
    render: (n) =>
      n.depth > 0 ? (
        <BomLink id={n.mlBomId} code={n.mlBomCode} />
      ) : (
        <span className="td-code">{n.mlBomCode ?? '—'}</span>
      ),
  },
  { header: 'RM Grade', nowrap: true, render: (n) => n.rawMaterialGradeText ?? dash },
  { header: 'RM Size', nowrap: true, render: (n) => n.rawMaterialSizeText ?? dash },
];

interface TreeTabProps {
  tree: MlBomTreeResponse | undefined;
  loading: boolean;
  error: Error | null;
}

export function MlBomTreeTab({ tree, loading, error }: TreeTabProps): React.JSX.Element {
  if (error) return <PageState as="inline" state="error" message={error.message} />;
  return (
    <DataTable
      columns={TREE_COLUMNS}
      rows={tree?.nodes ?? []}
      rowKey={(n) => n.key}
      loading={loading && !tree}
      density="compact"
      autoWidth
      emptyText="No lines."
    />
  );
}

// ── Exploded Items ───────────────────────────────────────────────────────

const EXPLODED_COLUMNS: DataTableColumn<MlBomExplodedItem>[] = [
  { header: 'Item Code', nowrap: true, render: (e) => strongCode(e.itemCode) },
  {
    header: 'Item Name',
    align: 'left',
    ellipsis: true,
    render: (e) => e.itemName ?? dash,
    title: (e) => e.itemName ?? '',
  },
  { header: 'Line Type', nowrap: true, render: (e) => lineTypeLabel(e.bomType) },
  {
    header: 'Exploded Qty',
    align: 'right',
    nowrap: true,
    className: 'mono fw-700',
    render: (e) => qty(e.explodedQty),
  },
  { header: 'UOM', nowrap: true, className: 'mono', render: (e) => e.uom ?? dash },
];

export function MlBomExplodedTab({ tree, loading, error }: TreeTabProps): React.JSX.Element {
  if (error) return <PageState as="inline" state="error" message={error.message} />;
  return (
    <DataTable
      columns={EXPLODED_COLUMNS}
      rows={tree?.exploded ?? []}
      rowKey={(e) => `${e.itemId}-${e.bomType}`}
      loading={loading && !tree}
      density="compact"
      autoWidth
      emptyText="No lines."
    />
  );
}

// ── Used In ──────────────────────────────────────────────────────────────

type UsedInRow = MlBomDetail['usedIn'][number];

const USED_IN_COLUMNS: DataTableColumn<UsedInRow>[] = [
  {
    header: 'BOM No.',
    nowrap: true,
    render: (u) => <BomLink id={u.mlBomId} code={u.code} />,
  },
  { header: 'Item Code', nowrap: true, render: (u) => strongCode(u.itemCode) },
];

export function MlBomUsedInTab({ detail }: { detail: MlBomDetail }): React.JSX.Element {
  return (
    <DataTable
      columns={USED_IN_COLUMNS}
      rows={detail.usedIn}
      rowKey={(u) => u.mlBomId}
      density="compact"
      autoWidth
      emptyText="Not used in another BOM."
    />
  );
}
