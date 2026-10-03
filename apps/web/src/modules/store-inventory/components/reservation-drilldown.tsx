// "Where is my stock reserved?" — the drill-down behind the Reserved number on
// the Store / Inventory list (ADR-180 §H).
//
// Reserved stock is still on the shelf; this box answers which SO lines have been
// promised it. Every code that has a detail page in this app is a real link
// (Sales Order, Production Order, Job Card); anything without one is printed as
// plain reference text rather than a link that goes nowhere.
//
// ADR-199 conversion (2026-10-01): the hand-rolled table is now the shared fit
// table (<DataTable tableKey={reservationDrilldown}>). Columns and behaviour are
// unchanged; the item is named once in the title, so every row is the same item.

import {
  RESERVATION_SOURCE_LABEL,
  RESERVATION_STATUS_LABEL,
  type ReservationDetail,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { useStockReservations } from '@/modules/plans/api';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ModalShell } from './modal-shell';

/** A code with no page of its own — plain reference text, never a dead link. */
function PlainRef({ code }: { code: string | null }): React.JSX.Element {
  if (!code) return <span className="text3">—</span>;
  return (
    <span className="mono fw-700" style={{ color: 'var(--text)' }}>
      {code}
    </span>
  );
}

/** Shared look for the codes that DO open a page. Each route is written out in
 *  full below rather than passed in as a string, so the router keeps type-
 *  checking the path and its params. */
const linkStyle: React.CSSProperties = { color: 'var(--cyan)', textDecoration: 'none' };

function StatusBadge({ row }: { row: ReservationDetail }): React.JSX.Element {
  const color =
    row.status === 'active'
      ? 'var(--purple)'
      : row.status === 'partially_consumed'
        ? 'var(--amber)'
        : row.status === 'consumed'
          ? 'var(--green)'
          : 'var(--text3)';
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color }}>
      {RESERVATION_STATUS_LABEL[row.status]}
    </span>
  );
}

function reservationColumns(itemCode: string): DataTableColumn<ReservationDetail>[] {
  return [
    {
      id: 'so_no',
      header: 'SO No.',
      kind: 'code',
      nowrap: true,
      className: 'td-code',
      render: (row) =>
        row.salesOrderId ? (
          <Link
            to="/sales-orders/$id"
            params={{ id: row.salesOrderId }}
            className="mono fw-700"
            style={linkStyle}
          >
            {soNoWithInternal(row.soCodeText, row.soInternalNo)}
          </Link>
        ) : (
          <PlainRef code={soNoWithInternal(row.soCodeText, row.soInternalNo)} />
        ),
    },
    {
      id: 'line_no',
      header: 'Ln',
      kind: 'code',
      nowrap: true,
      className: 'mono text3',
      render: (row) => row.lineNo ?? '—',
    },
    {
      // POL — the CUSTOMER's own purchase-order line number, beside our SO line.
      id: 'pol',
      header: 'POL',
      kind: 'code',
      nowrap: true,
      headColor: 'var(--purple)',
      className: 'mono fw-700',
      render: (row) => <span style={{ color: 'var(--purple)' }}>{row.clientPoLineNo ?? '—'}</span>,
    },
    {
      // CODE/REV — the item code with the customer's drawing revision on that SO
      // line; the revision is never shown alone (NAMING section A).
      id: 'code_rev',
      header: 'CODE/REV',
      kind: 'code',
      nowrap: true,
      className: 'mono fw-700',
      render: (row) => itemCodeWithRev(itemCode, row.itemRevision),
    },
    {
      id: 'customer',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      render: (row) => row.customerName ?? '—',
      title: (row) => row.customerName ?? '',
    },
    {
      id: 'reserved',
      header: 'Reserved',
      kind: 'num',
      align: 'right',
      nowrap: true,
      headColor: 'var(--purple)',
      className: 'mono fw-700',
      render: (row) => <span style={{ color: 'var(--purple)' }}>{row.qty}</span>,
    },
    {
      id: 'consumed',
      header: 'Consumed',
      kind: 'num',
      align: 'right',
      nowrap: true,
      className: 'mono text3',
      render: (row) => row.consumedQty,
    },
    {
      id: 'pending',
      header: 'Pending',
      kind: 'num',
      align: 'right',
      nowrap: true,
      headColor: 'var(--green2)',
      className: 'mono fw-700',
      render: (row) => <span style={{ color: 'var(--green2)' }}>{row.remainingQty}</span>,
    },
    {
      id: 'source',
      header: 'Source',
      align: 'left',
      ellipsis: true,
      render: (row) => RESERVATION_SOURCE_LABEL[row.source],
    },
    {
      id: 'reservation_status',
      header: 'Reservation Status',
      kind: 'badge',
      nowrap: true,
      render: (row) => <StatusBadge row={row} />,
    },
    {
      id: 'production_order_no',
      header: 'Production Order No.',
      kind: 'code',
      nowrap: true,
      className: 'td-code',
      render: (row) =>
        row.productionOrderId && row.productionOrderCode ? (
          <Link
            to="/production-orders/$id"
            params={{ id: row.productionOrderId }}
            className="mono fw-700"
            style={linkStyle}
          >
            {row.productionOrderCode}
          </Link>
        ) : (
          <PlainRef code={row.productionOrderCode} />
        ),
    },
    {
      id: 'jc_no',
      header: 'JC No.',
      kind: 'code',
      nowrap: true,
      className: 'td-code',
      render: (row) =>
        row.jobCardId && row.jobCardCode ? (
          <Link
            to="/job-cards/$id"
            params={{ id: row.jobCardId }}
            className="mono fw-700"
            style={linkStyle}
          >
            {row.jobCardCode}
          </Link>
        ) : (
          <PlainRef code={row.jobCardCode} />
        ),
    },
    {
      id: 'reserved_on',
      header: 'Reserved On',
      kind: 'date',
      nowrap: true,
      className: 'mono',
      render: (row) => fmtDate(row.reservedAt),
    },
    {
      id: 'reserved_by',
      header: 'Reserved By',
      align: 'left',
      ellipsis: true,
      render: (row) => row.reservedByName ?? '—',
      title: (row) => row.remarks ?? '',
    },
  ];
}

export function ReservationDrilldown({
  itemId,
  itemCode,
  itemName,
  onClose,
}: {
  itemId: string;
  itemCode: string;
  itemName: string;
  onClose: () => void;
}): React.JSX.Element {
  // Closed rows (released / cancelled / fully dispatched) are left out: the
  // question this box answers is "who is holding my stock right now".
  const { data, isLoading, isError, error } = useStockReservations({ itemId });
  const columns = reservationColumns(itemCode);

  return (
    // The item is named once, in the title — every row is the same item.
    <ModalShell onClose={onClose} title={`Reserved Stock — ${itemCode} (${itemName})`}>
      {isLoading ? (
        <div className="text3" style={{ fontSize: 12 }}>
          <Loader2 size={14} className="inline animate-spin" /> Loading…
        </div>
      ) : isError ? (
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          {error instanceof Error ? error.message : 'Could not load reservations. Try again.'}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, marginBottom: 10 }}>
            <span className="text3">Total reserved for this item: </span>
            <b className="mono" style={{ color: 'var(--purple)', fontSize: 16 }}>
              {data?.totalReserved ?? 0}
            </b>
          </div>
          <DataTable
            tableKey={TABLE_KEYS.reservationDrilldown}
            columns={columns}
            rows={data?.rows ?? []}
            rowKey={(row) => row.id}
            emptyText="No stock is reserved for this item."
          />
        </>
      )}
    </ModalShell>
  );
}
