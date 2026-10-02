// Reorder List columns for the ADR-199 fit table (<DataTable
// tableKey={reorderList}>). Split out of routes/reorder-list.tsx so that file
// stays under 400 lines.
//
// Visible order (first pinned = Item Code; the tick-box column is the engine's
// own, outside this list): Item Code · Item Name · UOM · Available · On PO ·
// Reorder Lvl · Reorder Qty · PR Qty · Vendor · Open PR. "PR Qty" (a number
// input) and "Vendor" (the shared searchable picker) are `control` columns:
// never dropped into ▸, never clipped, and they swallow the row click on their
// own. Numbers are `num` + right-aligned (owner decision 2026-09-26).

import type { ReorderListRow } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/ui/forms';
import type { DataTableColumn } from '@/ui/data';
import { useVendorsList } from '../../vendors/api';

export interface Draft {
  qty: string;
  vendorId: string | null;
  vendorLabel: string | undefined;
}

/** The shared searchable vendor picker, bound to one row's draft. */
function VendorPicker({
  value,
  label,
  onChange,
}: {
  value: string | null;
  label: string | undefined;
  onChange: (id: string | null, label: string | undefined) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isFetching } = useVendorsList({
    search: search.trim() || undefined,
    isActive: true,
    limit: 30,
    offset: 0,
  });
  const options = useMemo(
    () => (data?.vendors ?? []).map((v) => ({ id: v.id, code: v.code, name: v.name })),
    [data],
  );
  return (
    <SearchableSelect
      value={value}
      valueLabel={label}
      onChange={(id) => onChange(id, options.find((o) => o.id === id)?.code)}
      options={options}
      onSearch={setSearch}
      loading={isFetching}
      placeholder="🔍 Vendor…"
      emptyText="No matching vendor"
    />
  );
}

export function reorderListColumns(opts: {
  draftOf: (r: ReorderListRow) => Draft;
  setDraft: (r: ReorderListRow, patch: Partial<Draft>) => void;
  canRaise: boolean;
}): DataTableColumn<ReorderListRow>[] {
  const { draftOf, setDraft, canRaise } = opts;
  const isBlocked = (r: ReorderListRow): boolean => r.openPrs.length > 0;
  return [
    {
      id: 'item_code',
      sortFilterField: 'itemCode',
      header: 'Item Code',
      kind: 'code',
      nowrap: true,
      render: (r) => (
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {r.itemCode}
        </span>
      ),
    },
    {
      id: 'item_name',
      sortFilterField: 'itemName',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      render: (r) => r.itemName ?? '—',
      title: (r) => r.itemName ?? '',
    },
    {
      id: 'uom',
      sortFilterField: 'uom',
      header: 'UOM',
      kind: 'code',
      nowrap: true,
      className: 'text3',
      render: (r) => r.uom,
    },
    {
      id: 'available',
      sortFilterField: 'availableQty',
      header: 'Available',
      kind: 'num',
      align: 'right',
      nowrap: true,
      className: 'mono',
      render: (r) => r.availableQty,
    },
    {
      id: 'on_po',
      sortFilterField: 'onPoQty',
      header: 'On PO',
      kind: 'num',
      align: 'right',
      nowrap: true,
      className: 'mono',
      render: (r) => r.onPoQty,
    },
    {
      id: 'reorder_level',
      sortFilterField: 'reorderLevel',
      header: 'Reorder Lvl',
      kind: 'num',
      align: 'right',
      nowrap: true,
      className: 'mono',
      render: (r) => r.reorderLevel,
    },
    {
      id: 'reorder_qty',
      sortFilterField: 'reorderQty',
      header: 'Reorder Qty',
      kind: 'num',
      align: 'right',
      nowrap: true,
      className: 'mono',
      render: (r) => r.reorderQty || '—',
    },
    {
      id: 'pr_qty',
      header: 'PR Qty',
      kind: 'control',
      render: (r) => {
        const d = draftOf(r);
        return (
          <input
            type="number"
            min={0}
            step="any"
            className="innovic-input mono fw-700"
            style={{ width: 100, textAlign: 'right' }}
            disabled={!canRaise || isBlocked(r)}
            value={d.qty}
            onChange={(e) => setDraft(r, { qty: e.target.value })}
            onWheel={(e) => e.currentTarget.blur()}
            aria-label={`PR Qty for ${r.itemCode}`}
          />
        );
      },
    },
    {
      id: 'vendor',
      header: 'Vendor',
      kind: 'control',
      minWidth: 200,
      render: (r) => {
        if (isBlocked(r)) return <span className="text3">—</span>;
        const d = draftOf(r);
        return (
          <VendorPicker
            value={d.vendorId}
            label={d.vendorLabel}
            onChange={(id, label) => setDraft(r, { vendorId: id, vendorLabel: label })}
          />
        );
      },
    },
    {
      id: 'open_pr',
      header: 'Open PR',
      align: 'left',
      ellipsis: true,
      className: 'mono',
      render: (r) => r.openPrs.map((p) => `${p.code} × ${p.qty}`).join(', ') || '—',
      title: (r) => r.openPrs.map((p) => `${p.code} × ${p.qty}`).join(', '),
    },
  ];
}
