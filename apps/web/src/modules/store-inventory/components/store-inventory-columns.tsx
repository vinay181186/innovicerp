// Store / Inventory columns for the ADR-199 fit table (<DataTable
// tableKey={storeInventory}>). Split out of routes/list.tsx so that file stays
// under 400 lines.
//
// Visible order (first pinned = Item Code): Item Code · Item Name · UOM ·
// Physical · Reserved · Available · Reorder Level · On PO · At Vendor · Pending
// from Production. Material ships hidden (defaultHidden in the route) — it is
// kept so the data is not lost, but it is off the default view. The three
// ADR-180 numbers stay in order: Physical − Reserved = Available. Every number
// column is `num` + right-aligned (owner decision 2026-09-26, tabular digits);
// Item Name is the one text column that shares the spare width.
//
// The old "⚠ Below Reorder" sub-line under Physical is gone: the row now carries
// ROW_TINT.late when it is below reorder (set in the route), and the fit engine
// draws every row as one line, so a second line would be clipped anyway.

import { Link } from '@tanstack/react-router';
import type { StoreInventoryRow } from '@innovic/shared';
import type { DataTableColumn } from '@/ui/data';

/** A header cell that carries a tooltip (the fit engine has no header-title prop). */
function HeadWithHint({ label, hint }: { label: string; hint: string }): React.JSX.Element {
  return <span title={hint}>{label}</span>;
}

export function storeInventoryColumns(opts: {
  onReservedClick: (row: StoreInventoryRow) => void;
}): DataTableColumn<StoreInventoryRow>[] {
  const { onReservedClick } = opts;
  return [
    {
      id: 'item_code',
      header: 'Item Code',
      kind: 'code',
      nowrap: true,
      // The code opens the Item Master record; a real link so it can be
      // ctrl / middle-clicked into a new tab.
      render: (row) => (
        <Link
          to="/items/$id"
          params={{ id: row.itemId }}
          className="td-code fw-700"
          style={{ color: 'var(--text)' }}
          title="Open this item in the Item Master"
          onClick={(e) => e.stopPropagation()}
        >
          {row.itemCode}
        </Link>
      ),
    },
    {
      id: 'item_name',
      header: 'Item Name',
      align: 'left',
      className: 'fw-700',
      ellipsis: true,
      render: (row) => row.itemName,
      title: (row) => row.itemName,
    },
    {
      id: 'material',
      header: 'Material',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (row) => row.material ?? '—',
      title: (row) => row.material ?? '',
    },
    {
      id: 'uom',
      header: 'UOM',
      kind: 'code',
      nowrap: true,
      render: (row) => (
        <span className="tag" style={{ background: 'var(--bg4)', color: 'var(--text2)' }}>
          {row.uom}
        </span>
      ),
    },
    {
      id: 'physical',
      header: (
        <HeadWithHint
          label="Physical"
          hint="On the shelf, reserved or not. Reserving never changes it."
        />
      ),
      label: 'Physical',
      kind: 'num',
      align: 'right',
      nowrap: true,
      headColor: 'var(--green2)',
      render: (row) => (
        <span
          className="mono fw-700"
          style={{
            fontSize: 15,
            color:
              row.inStock > 0 ? 'var(--green)' : row.inStock === 0 ? 'var(--red)' : 'var(--text3)',
          }}
        >
          {row.inStock}
        </span>
      ),
    },
    {
      id: 'reserved',
      header: (
        <HeadWithHint
          label="Reserved"
          hint="Promised to SO lines but still on the shelf — click a number to see where"
        />
      ),
      label: 'Reserved',
      kind: 'num',
      align: 'right',
      nowrap: true,
      headColor: 'var(--purple)',
      // Clickable: opens the list of SO lines holding this item's stock.
      render: (row) =>
        row.reservedQty > 0 ? (
          <button
            type="button"
            className="mono fw-700"
            onClick={(e) => {
              e.stopPropagation();
              onReservedClick(row);
            }}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: 15,
              color: 'var(--purple)',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            {row.reservedQty}
          </button>
        ) : (
          <span className="mono text3">—</span>
        ),
    },
    {
      id: 'available',
      header: (
        <HeadWithHint
          label="Available"
          hint="Physical − Reserved: what a new order may still be promised"
        />
      ),
      label: 'Available',
      kind: 'num',
      align: 'right',
      nowrap: true,
      headColor: 'var(--cyan)',
      render: (row) => (
        <span
          className="mono fw-700"
          style={{ fontSize: 15, color: row.availableQty > 0 ? 'var(--cyan)' : 'var(--text3)' }}
        >
          {row.availableQty}
        </span>
      ),
    },
    {
      id: 'reorder_level',
      header: 'Reorder Level',
      kind: 'num',
      align: 'right',
      nowrap: true,
      className: 'mono text3',
      render: (row) => row.reorderLevel || '—',
    },
    {
      id: 'on_po',
      header: 'On PO',
      kind: 'num',
      align: 'right',
      nowrap: true,
      headColor: 'var(--blue)',
      render: (row) => (
        <span className="mono" style={{ color: row.onPoQty > 0 ? 'var(--blue)' : 'var(--text3)' }}>
          {row.onPoQty || '—'}
        </span>
      ),
    },
    {
      id: 'at_vendor',
      header: 'At Vendor',
      kind: 'num',
      align: 'right',
      nowrap: true,
      headColor: 'var(--amber2)',
      render: (row) => (
        <span
          className="mono"
          style={{ color: row.atVendorQty > 0 ? 'var(--amber2)' : 'var(--text3)' }}
          title={row.atVendorQty > 0 ? 'At an OSP vendor' : undefined}
        >
          {row.atVendorQty || '—'}
        </span>
      ),
    },
    {
      id: 'pending_production',
      header: 'Pending from Production',
      label: 'Pending from Production',
      kind: 'num',
      align: 'right',
      nowrap: true,
      headColor: 'var(--amber2)',
      render: (row) => (
        <span
          className="mono"
          style={{ color: row.mfgPendingQty > 0 ? 'var(--amber)' : 'var(--text3)' }}
        >
          {row.mfgPendingQty || '—'}
        </span>
      ),
    },
  ];
}
