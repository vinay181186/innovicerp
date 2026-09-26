// "Where is my stock reserved?" — the drill-down behind the Reserved number on
// the Store / Inventory list (ADR-180 §H).
//
// Reserved stock is still on the shelf; this box answers which SO lines have
// been promised it. Every code that has a detail page in this app is a real
// link (Sales Order, Production Order, Job Card); anything without one is
// printed as plain reference text rather than a link that goes nowhere.

import {
  RESERVATION_SOURCE_LABEL,
  RESERVATION_STATUS_LABEL,
  type ReservationDetail,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { useStockReservations } from '@/modules/plans/api';
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

  return (
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
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>SO No.</th>
                  <th>Ln</th>
                  {/* POL — the CUSTOMER's own purchase-order line number, an
                      extra value beside our SO line number. */}
                  <th style={{ color: 'var(--purple)' }}>POL</th>
                  <th>Customer</th>
                  <th>Item Code</th>
                  <th className="th-num" style={{ color: 'var(--purple)' }}>
                    Reserved
                  </th>
                  <th className="th-num">Consumed</th>
                  <th className="th-num" style={{ color: 'var(--green2)' }}>
                    Pending
                  </th>
                  <th>Source</th>
                  <th>Reservation Status</th>
                  <th>Production Order No.</th>
                  <th>JC No.</th>
                  <th>Reserved On</th>
                  <th>Reserved By</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={14} className="empty-state">
                      No stock is reserved for this item.
                    </td>
                  </tr>
                ) : (
                  data?.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="td-code">
                        {row.salesOrderId ? (
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
                        )}
                      </td>
                      <td className="mono text3">{row.lineNo}</td>
                      <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                        {row.clientPoLineNo ?? '—'}
                      </td>
                      <td
                        style={{
                          maxWidth: 160,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={row.customerName ?? ''}
                      >
                        {row.customerName ?? '—'}
                      </td>
                      {/* Item code is the main thing: strong mono, darkest text. */}
                      <td className="mono fw-700" style={{ color: 'var(--text)' }}>
                        {itemCodeWithRev(row.itemCode, row.itemRevision)}
                      </td>
                      <td className="mono fw-700 td-num" style={{ color: 'var(--purple)' }}>
                        {row.qty}
                      </td>
                      <td className="mono text3 td-num">{row.consumedQty}</td>
                      <td className="mono fw-700 td-num" style={{ color: 'var(--green2)' }}>
                        {row.remainingQty}
                      </td>
                      <td style={{ fontSize: 11 }}>{RESERVATION_SOURCE_LABEL[row.source]}</td>
                      <td>
                        <StatusBadge row={row} />
                      </td>
                      <td className="td-code">
                        {row.productionOrderId && row.productionOrderCode ? (
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
                        )}
                      </td>
                      <td className="td-code">
                        {row.jobCardId && row.jobCardCode ? (
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
                        )}
                      </td>
                      <td className="mono">{fmtDate(row.reservedAt)}</td>
                      <td style={{ fontSize: 11 }} title={row.remarks ?? ''}>
                        {row.reservedByName ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
            💡 Release a booking from the SO Planning screen — it asks for a reason.
          </div>
        </>
      )}
    </ModalShell>
  );
}
