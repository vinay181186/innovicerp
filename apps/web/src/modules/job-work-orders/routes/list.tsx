// JW Master list — ONE ROW PER JWSO (#6, matches the SO Master list). Columns,
// in legacy renderJWMaster thead order (L12685, with Line → Lines per the
// grouped SO Master L11863):
// JWSO NO. · LINES · DATE · CLIENT · CLIENT PO · TOTAL QTY · JC QTY · MATERIAL ·
// DUE · STATUS · REMARKS · (Edit Del). Material is colored text (✓ Full / ◑
// Partial / ✕ Not Received) keyed on partyReceivedQty (actual Σ Party GRN
// receipts) vs the header clientMaterialQty (expected client-supplied material).
//
// NOT ported from legacy L12656 — the Client PO 📎 attachment link: JW carries no
// clientPoFilePath (SO does; packages/shared/src/schemas/sales-order.ts:136), so
// the link would need a DB column + upload route. Not faked here (ISSUE-031).

import {
  type JobWorkOrderDetail,
  type JobWorkOrderListItem,
  type ListJobWorkOrdersQuery,
  SO_STATUSES,
  type SoStatus,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { SoStatusBadge } from '@/modules/sales-orders/components/so-status-badge';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJobWorkOrder, useJobWorkOrdersList, useSoftDeleteJobWorkOrder } from '../api';

// No pagination — mirror the SO/WO list: load all matching JWSOs in one fetch
// and scroll (no Prev/Next). Uses the JW list-query cap (200); the count line
// flags the rare larger set instead of silently hiding rows.
const LIST_LIMIT = 200;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(SO_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const jobWorkOrdersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-work-orders',
  validateSearch: listSearchSchema,
  component: JobWorkOrdersListPage,
});

// Material status as colored text: header received vs expected client material.
function MaterialCell({ received, expected }: { received: number; expected: number }): React.JSX.Element {
  if (expected > 0 && received >= expected) {
    return <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓ Full</span>;
  }
  if (received > 0) {
    return <span style={{ color: 'var(--amber)', fontWeight: 700 }}>◑ Partial ({received})</span>;
  }
  return <span style={{ color: 'var(--red)', fontWeight: 700 }}>✕ Not Received</span>;
}

/** One cell of the card's metric strip — big number over a small caps label,
 *  mirroring the SO/WO list (TOTAL QTY / JC QTY / LINES). */
function QtyBox({ label, value, color, bordered }: { label: string; value: number; color?: string; bordered?: boolean }): React.JSX.Element {
  return (
    <div style={{ padding: '4px 12px', textAlign: 'center', minWidth: 58, borderLeft: bordered ? '1px solid var(--border)' : undefined }}>
      <div className="mono fw-700" style={{ fontSize: 15, color: color ?? 'var(--text)', lineHeight: 1.2 }}>{value}</div>
      <div className="mono" style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
    </div>
  );
}

/** Left accent bar — red when late, green once finished, blue while open. Same
 *  three tokens the badges use (mirrors the SO/WO list accentFor). */
function accentFor(jw: JobWorkOrderListItem, today: string): string {
  if (jw.earliestDueDate != null && jw.earliestDueDate < today && jw.status === 'open') return 'var(--red)';
  if (jw.status === 'closed' || jw.status === 'dispatched') return 'var(--green)';
  return 'var(--blue)';
}

function JobWorkOrdersListPage(): React.JSX.Element {
  const search = jobWorkOrdersListRoute.useSearch();
  const navigate = jobWorkOrdersListRoute.useNavigate();
  const { data: me } = useSession();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListJobWorkOrdersQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [search.search, search.status],
  );

  const { data, isLoading, isFetching, isError, error } = useJobWorkOrdersList(query);
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const deleteMut = useSoftDeleteJobWorkOrder();
  const today = new Date().toISOString().slice(0, 10);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleExpand = (id: string): void => setExpandedId((prev) => (prev === id ? null : id));

  const onDelete = (jwId: string, code: string): void => {
    if (confirm(`Move JW ${code} to Trash?`)) deleteMut.mutate(jwId);
  };

  const total = data?.total ?? 0;
  const rows = data?.items ?? [];

  return (
    <div>
      {/* Frozen header band — matches the SO/WO list (sales-orders/routes/list.tsx).
          Title + search + status filter + New button stay pinned while the cards
          scroll underneath. `#content` is the scroll container, so top:0 pins this
          to its padding box; the background must be opaque var(--bg) or cards show
          through as they pass under. The green info banner below is a one-time
          explainer, so it is left OUTSIDE the band and scrolls away. Not bled to
          the edges — that would give the app a horizontal scrollbar. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'var(--bg)',
          paddingBottom: 8,
          marginBottom: 10,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="section-hdr" style={{ marginBottom: 0 }}>JWSO Master — Job Work Sales Order (Material from Client)</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input className="innovic-input" placeholder="Search JWSO, client, item…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ width: 220, fontSize: 12 }} />
            <select className="innovic-select" value={search.status ?? ''} onChange={(e) => { const v = e.target.value as SoStatus | ''; void navigate({ search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }), replace: true }); }} style={{ width: 130, fontSize: 12 }}>
              <option value="">All statuses</option>
              {SO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {isFetching && !isLoading ? <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}><Loader2 className="inline h-3 w-3 animate-spin" /> Updating…</span> : null}
            {canWrite ? <Link to="/job-work-orders/new" className="btn btn-primary">+ New JWSO Order</Link> : null}
          </div>
        </div>
      </div>

      <div style={{ padding: '10px 14px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8, marginBottom: 14, fontSize: 12, color: 'var(--text2)' }}>
        <b style={{ color: 'var(--green)' }}>📌 Job Work:</b> Client provides raw material → We machine/process it → Deliver finished parts back to client. Track client material receipt here.
      </div>

      {isLoading ? (
        <div className="panel"><div className="empty-state" style={{ padding: 20 }}><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading…</div></div>
      ) : isError ? (
        <div className="panel"><div className="empty-state" style={{ padding: 20, color: 'var(--red)' }}>{error instanceof Error ? error.message : 'Failed to load job work orders'}</div></div>
      ) : rows.length === 0 ? (
        <div className="panel"><div className="empty-state" style={{ padding: 20 }}>No Job Work Sales Orders — click + New JWSO Order</div></div>
      ) : (
        rows.map((jw) => {
          const isExpanded = expandedId === jw.jwId;
          const overdue = !!jw.earliestDueDate && jw.earliestDueDate < today && jw.status === 'open';
          const jcColor =
            jw.jcQty >= jw.totalQty && jw.totalQty > 0
              ? 'var(--green)'
              : jw.jcQty > 0
                ? 'var(--amber)'
                : 'var(--text3)';
          return (
            <div
              key={jw.jwId}
              className="panel"
              style={{ display: 'flex', overflow: 'hidden', padding: 0, marginBottom: 10 }}
            >
              {/* Accent bar — red late, green finished, blue open. */}
              <div style={{ width: 4, flexShrink: 0, background: accentFor(jw, today) }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Band 1: identity + status + actions */}
                <div
                  onClick={() => toggleExpand(jw.jwId)}
                  title={isExpanded ? 'Hide line items' : 'Show line items'}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 14px', cursor: 'pointer' }}
                >
                  <span style={{ color: 'var(--text3)', display: 'inline-flex' }} aria-hidden>
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <Link
                    to="/job-work-orders/$id"
                    params={{ id: jw.jwId }}
                    className="td-code"
                    style={{ color: 'var(--blue)', fontWeight: 800, fontSize: 13 }}
                    title="Open the JWSO detail page"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {jw.code}
                  </Link>
                  <span className="fw-700" style={{ fontSize: 13 }}>{jw.customerName ?? '—'}</span>
                  <SoStatusBadge status={jw.status} />
                  <span style={{ flex: 1 }} />
                  {canWrite ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                      <Link to="/job-work-orders/$id/edit" params={{ id: jw.jwId }} className="btn btn-ghost btn-sm">
                        Edit
                      </Link>
                      <button type="button" className="btn btn-danger btn-sm" disabled={deleteMut.isPending} onClick={() => onDelete(jw.jwId, jw.code)}>
                        Del
                      </button>
                    </div>
                  ) : null}
                </div>
                {/* Band 2: metric strip + meta line */}
                <div
                  onClick={() => toggleExpand(jw.jwId)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '0 14px 10px', cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6 }}>
                    <QtyBox label="Total Qty" value={jw.totalQty} />
                    <QtyBox label="JC Qty" value={jw.jcQty} color={jcColor} bordered />
                    {/* Dispatched = finished parts delivered back to the client
                        (Σ line returned_qty). Balance = still owed on the order. */}
                    <QtyBox
                      label="Dispatched"
                      value={jw.dispatchedQty}
                      color={jw.dispatchedQty > 0 ? 'var(--green)' : 'var(--text3)'}
                      bordered
                    />
                    <QtyBox
                      label="Balance"
                      value={Math.max(0, jw.totalQty - jw.dispatchedQty)}
                      color={jw.totalQty - jw.dispatchedQty > 0 ? 'var(--red)' : 'var(--green)'}
                      bordered
                    />
                    <QtyBox label="Lines" value={jw.lineCount} bordered />
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <span className="text2">{jw.jwDate}</span>
                    <span>·</span>
                    <span>
                      PO <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{jw.clientPoNo ?? '—'}</span>
                    </span>
                    <span>·</span>
                    <span>
                      Material{' '}
                      <MaterialCell received={jw.partyReceivedQty} expected={Number(jw.clientMaterialQty ?? 0)} />
                    </span>
                    <span>·</span>
                    <span style={{ color: overdue ? 'var(--red)' : undefined, fontWeight: overdue ? 700 : undefined }}>
                      {jw.earliestDueDate ? `Due ${jw.earliestDueDate}${overdue ? ' ⚠' : ''}` : 'No due date'}
                    </span>
                    {jw.remarks ? (
                      <>
                        <span>·</span>
                        <span title={jw.remarks}>{jw.remarks}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                {/* Band 3: line items */}
                {isExpanded ? (
                  <div style={{ background: 'var(--bg3)', borderTop: '1px solid var(--border)' }}>
                    <JwExpandedPanel jwId={jw.jwId} canWrite={canWrite} />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
        <span>
          {total === 0
            ? 'No JWSOs'
            : total > LIST_LIMIT
              ? `Showing first ${LIST_LIMIT} of ${total} — refine with search`
              : `Showing all ${total} JWSO${total === 1 ? '' : 's'}`}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, padding: '0 4px' }}>
        💡 Click a row to open the JWSO. Click the chevron to expand its line items inline.
      </div>
    </div>
  );
}

// Inline line-item panel for one JWSO — mirrors the SO Master expand. Loads the
// JWSO detail (header + lines) and lists each line's item / part / material /
// qty / rate / due / status.
function JwExpandedPanel({ jwId, canWrite }: { jwId: string; canWrite: boolean }): React.JSX.Element {
  const { data, isLoading, isError, error } = useJobWorkOrder(jwId);
  if (isLoading) return <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text3)' }}><Loader2 size={12} className="inline animate-spin" /> Loading lines…</div>;
  if (isError || !data) return <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--red)' }}>{error instanceof Error ? error.message : 'Failed to load JWSO detail'}</div>;
  return <JwLinesTable jw={data} canWrite={canWrite} />;
}

function JwLinesTable({ jw, canWrite }: { jw: JobWorkOrderDetail; canWrite: boolean }): React.JSX.Element {
  return (
    <div style={{ padding: '8px 12px 8px 36px' }}>
      <div style={{ fontSize: 10, color: 'var(--blue)', fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 6 }}>▸ LINE ITEMS — {jw.code}</div>
      <table className="innovic-table" style={{ width: '100%', margin: 0 }}>
        <thead>
          <tr style={{ background: 'var(--bg4)' }}>
            <th style={{ width: 36 }}>Ln</th><th>Item Code</th><th>Part Name</th><th>Material</th><th>Drawing No</th>
            <th className="td-ctr">Qty</th>
            <th className="td-ctr" style={{ color: 'var(--green)' }}>Dispatched</th>
            <th className="td-ctr">Balance</th>
            <th>UOM</th><th className="td-ctr">Rate</th><th>Due Date</th><th>Status</th>
            {canWrite ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {jw.lines.length === 0 ? (
            <tr><td colSpan={canWrite ? 13 : 12} className="empty-state">No lines yet</td></tr>
          ) : (
            jw.lines.map((l) => {
              const balance = Math.max(0, l.orderQty - l.returnedQty);
              return (
              <tr key={l.id} style={{ background: 'var(--bg)' }}>
                <td className="td-ctr mono fw-700" style={{ color: 'var(--blue)' }}>{l.lineNo}</td>
                <td className="td-code" style={{ color: 'var(--text)' }}>{l.itemCodeText ?? '—'}</td>
                <td style={{ color: 'var(--blue)', fontWeight: 600 }}>{l.partName}</td>
                <td className="text2" style={{ fontSize: 11 }}>{l.material ?? '—'}</td>
                <td className="mono" style={{ fontSize: 11, color: 'var(--purple)' }}>{l.drawingNo ?? '—'}</td>
                <td className="td-ctr mono fw-700" style={{ fontSize: 14 }}>{l.orderQty}</td>
                <td className="td-ctr mono fw-700" style={{ color: l.returnedQty > 0 ? 'var(--green)' : 'var(--text3)' }}>{l.returnedQty}</td>
                <td className="td-ctr mono fw-700" style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }}>{balance}</td>
                <td className="text3" style={{ fontSize: 11, textTransform: 'uppercase' }}>{l.uom}</td>
                <td className="td-ctr mono" style={{ fontSize: 11 }}>{l.rate}</td>
                <td className="text2" style={{ fontSize: 11 }}>{l.dueDate ?? '—'}</td>
                <td><SoStatusBadge status={l.status} /></td>
                {canWrite ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link to="/job-work-orders/$id/edit" params={{ id: jw.id }} className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}>Edit</Link>
                  </td>
                ) : null}
              </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
