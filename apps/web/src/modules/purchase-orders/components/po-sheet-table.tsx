// Purchase Orders — List View. The ruled-sheet table (`tbl-grid`, the same
// look the Job Cards list ships) that sits beside the original card layout
// under a List View / Card View toggle. Split out of routes/list.tsx to keep
// that file under 400 lines.
//
// One row per PO, one column per thing the card already shows: PO No. + date,
// type chip, vendor, PR ref, lines, qty strip (total / received / pending),
// value, status, and the SAME row actions with the SAME gates as the card —
// View, Edit (edit tier, not closed), DC (edit tier, sends material out, not
// draft), Assign (admin/manager, not closed/cancelled). Nothing here reads a
// field the card does not, except Value, which is `totalAmount` off the list
// payload — the API nulls it when the viewer's access hides prices, and that
// null renders as "—".

import { type PurchaseOrderListItem, poSendsMaterialOut } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { PoStatusBadge } from './po-status-badge';

// Whole rupees, Indian grouping — the same shape the Invoices list uses.
const inr = (v: number): string => `₹${Math.round(v).toLocaleString('en-IN')}`;

export function PoSheetTable({
  rows,
  canEdit,
  onOpen,
}: {
  rows: PurchaseOrderListItem[];
  /** Edit tier (L3 Editor and up) — gates Edit and Create DC, as on the card. */
  canEdit: boolean;
  /** Row click → PO detail page. Same handler the card's bands use. */
  onOpen: (id: string) => void;
}): React.JSX.Element {
  return (
    <>
      {/* The sheet look (tbl-grid): bold blue column names, gridlines, cream /
          white rows, fixed widths that add up to 100% so nothing scrolls
          sideways. The sheet centres every column; only Vendor is left-aligned
          so the names share one edge. */}
      <div className="tbl-wrap" style={{ overflowX: 'hidden' }}>
        <table className="innovic-table tbl-grid">
          <colgroup>
            <col style={{ width: '4%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '14%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Sr No</th>
              <th>PO No.</th>
              <th>PO Type</th>
              <th style={{ textAlign: 'left' }}>Vendor</th>
              <th>PR Ref</th>
              <th>Lines</th>
              <th>Total Qty</th>
              <th>Received</th>
              <th>Pending</th>
              <th>Value</th>
              <th>PO Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((po, i) => {
              const isJW = po.poType === 'job_work';
              const isSvc = po.poType === 'service';
              const pending = po.totalQty - po.receivedQty;
              const vendor = po.vendorName ?? po.vendorCodeText ?? '—';
              return (
                <tr key={po.id} onClick={() => onOpen(po.id)} style={{ cursor: 'pointer' }}>
                  <td className="text3">{i + 1}</td>
                  <td>
                    <Link
                      to="/purchase-orders/$id"
                      params={{ id: po.id }}
                      className="td-code"
                      style={{ color: 'var(--blue)', fontWeight: 800, fontSize: 13 }}
                      title="Open the PO detail page"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {po.code}
                    </Link>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {fmtDate(po.poDate)}
                    </div>
                  </td>
                  <td>
                    {/* Same chip the card shows — amber JW, teal SVC, blue MAT. */}
                    <span className={`badge ${isJW ? 'b-amber' : isSvc ? 'b-teal' : 'b-blue'}`}>
                      {isJW ? 'JW' : isSvc ? 'SVC' : 'MAT'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <span
                      className="fw-700"
                      style={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={vendor}
                    >
                      {vendor}
                    </span>
                  </td>
                  <td>
                    <span
                      className="mono"
                      style={{ color: 'var(--purple)', fontWeight: 700, fontSize: 12 }}
                    >
                      {po.prCodeText ?? '—'}
                    </span>
                  </td>
                  <td className="mono">{po.lineCount}</td>
                  <td>
                    <span className="mono fw-700">{po.totalQty}</span>
                  </td>
                  <td>
                    <span
                      className="mono fw-700"
                      style={{ color: po.receivedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
                    >
                      {po.receivedQty}
                    </span>
                  </td>
                  <td>
                    <span
                      className="mono fw-700"
                      style={{ color: pending > 0 ? 'var(--amber)' : 'var(--green)' }}
                    >
                      {pending}
                    </span>
                  </td>
                  <td>
                    {/* null = prices hidden for this viewer (API-side). */}
                    {po.totalAmount == null ? (
                      <span className="text3">—</span>
                    ) : (
                      <span className="mono">{inr(po.totalAmount)}</span>
                    )}
                  </td>
                  <td>
                    <PoStatusBadge status={po.status} />
                  </td>
                  <td>
                    {/* 2×2 action grid — the card's actions and gates, verbatim.
                        stopPropagation so a button click does not also open
                        the row. */}
                    <div
                      className="jc-row-acts"
                      style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Link
                        to="/purchase-orders/$id"
                        params={{ id: po.id }}
                        className="btn btn-primary btn-sm"
                        title="View"
                      >
                        👁 View
                      </Link>
                      {canEdit && po.status !== 'closed' ? (
                        <Link
                          to="/purchase-orders/$id/edit"
                          params={{ id: po.id }}
                          className="btn btn-ghost btn-sm"
                          title="Edit"
                        >
                          ✎ Edit
                        </Link>
                      ) : null}
                      {/* Job Work AND Service both send material out — same DC lane. */}
                      {canEdit && poSendsMaterialOut(po.poType) && po.status !== 'draft' ? (
                        <Link
                          to="/delivery-challans/new"
                          search={{ poId: po.id }}
                          className="btn btn-ghost btn-sm"
                          title="Create DC"
                        >
                          📦 DC
                        </Link>
                      ) : null}
                      {po.status !== 'closed' && po.status !== 'cancelled' ? (
                        <AssignTaskButton
                          linkedRef={{
                            type: 'purchase_order',
                            id: po.id,
                            display: `PO ${po.code}`,
                            navPage: `/purchase-orders/${po.id}`,
                          }}
                          suggestedTitle={`Follow up ${po.code}`}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
        💡 Click a row to open the purchase order.
      </div>
    </>
  );
}
