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
import { useStockReservations } from '@/modules/plans/api';
import { createdByColumn, DataTable, leadColumns, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ModalShell } from './modal-shell';
import { RevStockTable } from './rev-stock-table';

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
    <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color }}>
      {RESERVATION_STATUS_LABEL[row.status]}
    </span>
  );
}

function reservationColumns(
  itemCode: string,
  itemName: string,
): DataTableColumn<ReservationDetail>[] {
  return [
    // ADR-261 — the locked lead block. Created On = the booking's created_at
    // (it replaced the old Reserved On column — same fact). Item Code
    // carries the SO line's drawing rev (CODE/REV); Item Name is the item's.
    // Every open booking of the item in one unpaged box, so Sr No starts at 1.
    ...leadColumns<ReservationDetail>({
      firstRowNo: 1,
      soNo: (row) => row.soCodeText,
      internalSoNo: (row) => row.soInternalNo,
      pol: (row) => row.clientPoLineNo,
      createdOn: (row) => row.reservedAt,
      itemCode: (row) => row.itemCode ?? itemCode,
      itemRev: (row) => row.itemRevision,
      itemName: () => itemName,
      overrides: {
        so_no: {
          render: (row) =>
            row.salesOrderId ? (
              <Link
                to="/sales-orders/$id"
                params={{ id: row.salesOrderId }}
                className="mono fw-700"
                style={linkStyle}
              >
                {row.soCodeText}
              </Link>
            ) : (
              <PlainRef code={row.soCodeText} />
            ),
        },
      },
    }),
    {
      id: 'line_no',
      header: 'Ln',
      kind: 'code',
      nowrap: true,
      className: 'mono text3',
      render: (row) => row.lineNo ?? '—',
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
    // Created On / Created By = when and by whom the booking was made (the
    // reservation row) — they replace the old Reserved On / Reserved By columns
    // (same facts, ADR-261 rev). The booking remarks show on hover.
    createdByColumn<ReservationDetail>({
      createdByName: (row) => row.reservedByName,
      overrides: { title: (row) => [row.reservedByName, row.remarks].filter(Boolean).join(' — ') },
    }),
  ];
}

export function ReservationDrilldown({
  itemId,
  itemCode,
  itemName,
  itemLabel,
  itemRevisionId,
  onClose,
}: {
  itemId: string;
  itemCode: string;
  itemName: string;
  /** The Store row's label — "ABC/1", plain "ABC", or "ABC · no Rev". */
  itemLabel: string;
  /** The Item + Drawing Rev bucket the row stands for (null = no-Rev bucket);
   *  highlighted in the per-Rev table. */
  itemRevisionId: string | null;
  onClose: () => void;
}): React.JSX.Element {
  // Closed rows (released / cancelled / fully dispatched) are left out: the
  // question this box answers is "who is holding my stock right now".
  // A Store row stands for ONE Item + Drawing Rev bucket, so its Reserved
  // number counts only that bucket's bookings: filter by the row's Rev, or
  // 'none' for a MAKE item's blank (no-Rev) row. A Buy item has a single row
  // (label = the bare code) and keeps the item-wide list.
  const revScope = itemRevisionId ?? (itemLabel !== itemCode ? 'none' : undefined);
  const { data, isLoading, isError, error } = useStockReservations({
    itemId,
    ...(revScope ? { itemRevisionId: revScope } : {}),
  });
  const columns = reservationColumns(itemCode, itemName);
  const scopeName = revScope ? itemLabel : 'this item';

  return (
    // The item is named once, in the title — every row is the same item. The
    // title says what the row ⋯ menu said ("Stock per Drawing Rev") — one label
    // per action (owner rule 2026-11-02).
    <ModalShell
      onClose={onClose}
      confirmExit={false}
      title={`Stock per Drawing Rev — ${itemLabel} (${itemName})`}
    >
      {isLoading ? (
        <div className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
          <Loader2 size={14} className="inline animate-spin" /> Loading…
        </div>
      ) : isError ? (
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          {error instanceof Error ? error.message : 'Could not load reservations. Try again.'}
        </div>
      ) : (
        <>
          {/* Phase C — the same item split per Item + Drawing Rev bucket. */}
          <RevStockTable itemId={itemId} itemCode={itemCode} focusRevisionId={itemRevisionId} />
          <div style={{ fontSize: 'var(--fs-sm)', marginBottom: 10 }}>
            <span className="text3">Total reserved for {scopeName}: </span>
            <b className="mono" style={{ color: 'var(--purple)', fontSize: 'var(--fs-md)' }}>
              {data?.totalReserved ?? 0}
            </b>
          </div>
          <DataTable
            tableKey={TABLE_KEYS.reservationDrilldown}
            columns={columns}
            rows={data?.rows ?? []}
            rowKey={(row) => row.id}
            emptyText={`No stock is reserved for ${scopeName}.`}
          />
        </>
      )}
    </ModalShell>
  );
}
