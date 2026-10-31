// Stock of one item per Item + Drawing Rev (Phase C, owner model 2026-10-31).
//
// A MAKE item is counted per Rev: ABC/1 and ABC/2 are different pieces on the
// shelf. Old stock made before the register sits in a blank bucket — shown as
// "ABC · no Rev" — until the store sets its Rev by hand (Drawing Rev Fix List).
// Each row says what is on hand, what is booked to SO lines and what is free,
// and names the SO lines holding it. Buy items / RM have no Rev, so the server
// answers one blank row (or none) and this table stays out of the way.

import type { ItemRevStockRow } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { ItemRevLink } from '@/modules/item-revisions/components/item-rev-link';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { useItemRevStock } from '../api';

function revLabel(row: ItemRevStockRow, itemCode: string): string {
  return row.itemRevisionId ? row.label : `${itemCode} · no Rev`;
}

function columns(itemCode: string): DataTableColumn<ItemRevStockRow>[] {
  return [
    {
      id: 'drawing_rev',
      header: 'Item / Drawing Rev',
      nowrap: true,
      render: (r) => (
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          <ItemRevLink
            itemRevisionId={r.itemRevisionId}
            label={revLabel(r, itemCode)}
            className=""
          />
        </span>
      ),
    },
    {
      id: 'on_hand',
      header: 'On Hand',
      align: 'right',
      nowrap: true,
      className: 'mono fw-700',
      render: (r) => r.onHandQty,
    },
    {
      id: 'reserved',
      header: 'Reserved',
      align: 'right',
      nowrap: true,
      className: 'mono',
      render: (r) => r.reservedQty,
    },
    {
      id: 'free',
      header: 'Free',
      align: 'right',
      nowrap: true,
      className: 'mono fw-700',
      render: (r) => r.freeQty,
    },
    {
      id: 'bookings',
      header: 'Booked To',
      align: 'left',
      ellipsis: true,
      render: (r) =>
        r.bookings.length === 0 ? (
          <span className="text3">—</span>
        ) : (
          r.bookings
            .map((b) => `${b.docCode}${b.lineNo != null ? ` ln ${b.lineNo}` : ''} · ${b.qty}`)
            .join(', ')
        ),
      title: (r) =>
        r.bookings
          .map((b) => `${b.docCode}${b.lineNo != null ? ` ln ${b.lineNo}` : ''} · ${b.qty}`)
          .join('\n'),
    },
  ];
}

export function RevStockTable({
  itemId,
  itemCode,
}: {
  itemId: string;
  itemCode: string;
}): React.JSX.Element | null {
  const { data, isLoading, isError, error } = useItemRevStock(itemId);
  if (isLoading) {
    return (
      <div className="text3" style={{ fontSize: 12, marginBottom: 10 }}>
        <Loader2 size={14} className="inline animate-spin" /> Loading stock per Drawing Rev…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="form-error" style={{ marginBottom: 10 }}>
        {error instanceof Error ? error.message : 'Could not load stock per Drawing Rev.'}
      </div>
    );
  }
  const rows = data ?? [];
  // Nothing to split: a Buy item, or a make item whose stock is all one bucket
  // with no Rev and nothing on hand.
  if (rows.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="text3" style={{ fontSize: 11, marginBottom: 4 }}>
        Stock per Drawing Rev
      </div>
      <DataTable
        tableKey={TABLE_KEYS.itemRevStock}
        columns={columns(itemCode)}
        rows={rows}
        rowKey={(r) => r.itemRevisionId ?? 'no-rev'}
        emptyText="No stock for this item."
      />
    </div>
  );
}
