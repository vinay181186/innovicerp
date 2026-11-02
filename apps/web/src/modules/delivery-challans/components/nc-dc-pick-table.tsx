// Multi-NC picker table for +New DC → Against NC and Against JW PO / DC (owner
// 2026-11-01): tick several NCs of the SAME Sales Order going to the SAME
// vendor, then "Make DC for N NCs" opens the one return-DC form for them.
//
// The tick column is a column of the ONE FIT table (DataTable, ADR-199), not
// DataTable's own `selectable` strip: that strip hides the box of a row that
// cannot be picked and offers a select-all, and here the user must SEE the box
// greyed with the reason on hover ("Other SO" / "Other vendor"), and a
// select-all over mixed SOs would only build a set the server refuses. A row
// click toggles the tick too. The rule itself lives in lib/nc-dc-pick.ts.

import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { type PickNc, pickBlockReason } from '../lib/nc-dc-pick';

/** The extra columns the Against JW PO / DC picker shows in front / behind. */
export interface PickExtraColumns {
  /** Columns before NC No. (e.g. PO No., Sent on DC No.). */
  lead?: DataTableColumn<PickNc>[];
  /** Columns after Qty to Return (e.g. Return Challan Status). */
  tail?: DataTableColumn<PickNc>[];
}

export function NcDcPickTable({
  tableKey,
  rows,
  allRows,
  ticked,
  onTickedChange,
  onNext,
  extra,
  showPoColumn,
  loading,
  error,
  emptyText,
}: {
  tableKey: string;
  /** The rows on screen (after the search box). */
  rows: PickNc[];
  /** Every loaded row — ticks survive a search that hides them. */
  allRows: PickNc[];
  /** Ticked NC ids in tick order (= the DC's line order). */
  ticked: string[];
  onTickedChange: (ids: string[]) => void;
  /** "Make DC for N NCs" — hands the ticked rows to the form. */
  onNext: (picked: PickNc[]) => void;
  extra?: PickExtraColumns;
  /** Against NC shows the JW PO No. column (Against JW PO / DC leads with it). */
  showPoColumn: boolean;
  loading: boolean;
  error: boolean;
  emptyText: string;
}): React.JSX.Element {
  const byId = useMemo(() => new Map(allRows.map((r) => [r.ncId, r])), [allRows]);
  // A ticked NC that left the loaded list (another user raised its DC) drops
  // out here, so the count and the form never carry it.
  const picked = useMemo(
    () => ticked.map((id) => byId.get(id)).filter((r): r is PickNc => r !== undefined),
    [ticked, byId],
  );
  const tickedSet = useMemo(() => new Set(picked.map((p) => p.ncId)), [picked]);

  const toggle = (row: PickNc): void => {
    if (tickedSet.has(row.ncId)) {
      onTickedChange(picked.filter((p) => p.ncId !== row.ncId).map((p) => p.ncId));
    } else if (pickBlockReason(row, picked) === null) {
      onTickedChange([...picked.map((p) => p.ncId), row.ncId]);
    }
  };

  const first = picked[0];
  const vendorOfSet = picked.find((p) => p.vendorId !== null);

  const columns: DataTableColumn<PickNc>[] = [
    {
      id: 'tick',
      header: '',
      label: 'Tick',
      kind: 'control',
      filterable: false,
      render: (r) => {
        const on = tickedSet.has(r.ncId);
        const reason = on ? null : pickBlockReason(r, picked);
        return (
          // A disabled box swallows the hover in some browsers, so the reason
          // sits on the wrapper and the box lets the pointer through.
          <span title={reason ?? undefined} style={{ display: 'inline-block', padding: 2 }}>
            <input
              type="checkbox"
              className="dt-sel-box"
              aria-label={`Tick ${r.ncCode}`}
              checked={on}
              disabled={reason !== null}
              style={reason !== null ? { pointerEvents: 'none' } : undefined}
              onChange={() => toggle(r)}
            />
          </span>
        );
      },
    },
    ...(extra?.lead ?? []),
    {
      id: 'ncCode',
      header: 'NC No.',
      kind: 'code',
      className: 'mono fw-700',
      render: (r) => (
        <span style={{ color: r.ready ? 'var(--blue)' : 'var(--text2)' }}>{r.ncCode}</span>
      ),
      filterValue: (r) => r.ncCode,
    },
    {
      id: 'soNo',
      header: 'SO No.',
      kind: 'code',
      className: 'mono',
      render: (r) => r.soLabel ?? '—',
      filterValue: (r) => r.soLabel,
    },
    {
      // POL = the CUSTOMER's own PO line number off the SO line behind the NC.
      id: 'pol',
      header: 'POL',
      headColor: 'var(--purple)',
      kind: 'code',
      className: 'mono fw-700',
      render: (r) => <span style={{ color: 'var(--purple)' }}>{r.clientPoLineNo ?? '—'}</span>,
      filterValue: (r) => r.clientPoLineNo,
    },
    {
      id: 'itemCode',
      header: 'Item Code',
      kind: 'code',
      render: (r) => (
        <b className="mono fw-700" style={{ color: 'var(--text)' }}>
          {r.itemCodeLabel}
        </b>
      ),
      filterValue: (r) => r.itemCodeLabel,
    },
    {
      id: 'itemName',
      header: 'Item Name',
      kind: 'text',
      ellipsis: true,
      render: (r) => r.itemName,
      title: (r) => r.itemName,
      filterValue: (r) => r.itemName,
    },
    {
      id: 'qtyToReturn',
      header: 'Qty to Return',
      kind: 'num',
      align: 'right',
      className: 'mono',
      render: (r) => (
        <span style={{ color: r.ready ? 'var(--red2)' : 'var(--text2)' }}>
          {Number(r.qtyToReturn)}
        </span>
      ),
      filterValue: (r) => Number(r.qtyToReturn),
    },
    ...(showPoColumn
      ? [
          {
            id: 'jwPoNo',
            header: 'JW PO No.',
            kind: 'code',
            className: 'mono',
            render: (r) => r.poCode ?? '—',
            filterValue: (r) => r.poCode,
          } satisfies DataTableColumn<PickNc>,
        ]
      : []),
    ...(extra?.tail ?? []),
    {
      id: 'vendor',
      header: 'Vendor',
      kind: 'text',
      ellipsis: true,
      render: (r) => r.vendorName ?? r.vendorCode ?? '—',
      title: (r) => [r.vendorCode, r.vendorName].filter(Boolean).join(' — '),
      filterValue: (r) => r.vendorName ?? r.vendorCode,
    },
  ];

  if (loading) {
    return (
      <div className="empty-state">
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading NCs…
      </div>
    );
  }
  if (error) {
    return (
      <div className="empty-state" style={{ color: 'var(--red2)' }}>
        Could not load NCs. Try again.
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={picked.length === 0}
          onClick={() => onNext(picked)}
        >
          {picked.length === 1 ? 'Make DC for 1 NC' : `Make DC for ${picked.length} NCs`}
        </button>
        <span className="text3" style={{ fontSize: 11 }}>
          {first
            ? `Ticked: ${picked.length} · SO ${first.soLabel ?? '— (none, goes alone)'}${
                vendorOfSet ? ` · ${vendorOfSet.vendorName ?? vendorOfSet.vendorCode ?? ''}` : ''
              }. Only NCs of this SO and this vendor can be added.`
            : 'Tick the NCs to send back on one DC — all of one SO, going to one vendor.'}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state" style={{ color: 'var(--amber2)' }}>
          {emptyText}
        </div>
      ) : (
        <DataTable
          tableKey={tableKey}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.ncId}
          onRowClick={toggle}
          isRowClickable={(r) => tickedSet.has(r.ncId) || pickBlockReason(r, picked) === null}
          rowClassName={(r) => (tickedSet.has(r.ncId) ? 'row-selected' : undefined)}
        />
      )}
    </>
  );
}
