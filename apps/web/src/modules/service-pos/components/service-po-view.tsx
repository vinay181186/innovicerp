// Service PO view — non-inventory purchase orders (labour, maintenance,
// calibration, consultancy…). Mirror of legacy _spoRegister (renderServicePO
// L27504): cards (Total / Value / Open / Completed) + searchable table.
//
// Extracted from the standalone service-pos list route so it can render inside
// the Purchase Orders screen as a tab. Same hooks, same query, same money
// gating (the API nulls SPO totals for L1 Viewers). The only change: search /
// status / page were URL search-params on the retired route, so they are local
// component state here — the SPO detail and new pages are still their own
// routes and are linked to as before.

import type { ListServicePosQuery, ServicePoListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { useServicePosList } from '../api';

const PAGE_SIZE = 50;

type SpoStatus = NonNullable<ListServicePosQuery['status']>;

function inr(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

// Simplified lifecycle: active SPOs (draft/pending/approved) all show as "Open";
// only Completed and Cancelled are distinct.
function statusColor(s: string): string {
  if (s === 'completed') return 'var(--cyan)';
  if (s === 'cancelled') return 'var(--red)';
  return 'var(--amber)'; // Open
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Open',
  pending: 'Open',
  approved: 'Open',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function ServicePoView(): React.JSX.Element {
  // Was `servicePosListRoute.useSearch()` / `.useNavigate()`. The standalone
  // route is retired, so the same three filters live in component state.
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<SpoStatus | ''>('');
  const [page, setPage] = useState(1);
  const { data: me } = useSession();
  const canEdit = me?.role === 'admin' || me?.role === 'manager';

  const query: ListServicePosQuery = useMemo(
    () => ({
      search: searchText.trim() || undefined,
      status: statusFilter || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    [searchText, statusFilter, page],
  );

  const { data, isLoading, isError, error } = useServicePosList(query);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Money hidden for L1 Viewers: the API nulls SPO totals, so a null total is
  // the signal to drop the value KPI and the Total column.
  const priceHidden = items.some((p) => p.total == null);
  const totalValue = items.reduce((s, p) => s + (p.total ?? 0), 0);
  const openCount = items.filter(
    (p) => p.status === 'draft' || p.status === 'pending' || p.status === 'approved',
  ).length;
  const completedCount = items.filter((p) => p.status === 'completed').length;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div className="text3" style={{ fontSize: 11 }}>
          Non-inventory purchase orders (labour, maintenance, calibration, consultancy, …).
        </div>
        {canEdit ? (
          <Link to="/service-pos/new" className="btn btn-primary">
            <Plus size={14} /> New Service PO
          </Link>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="panel" style={{ minWidth: 100, padding: 12, textAlign: 'center' }}>
          <div className="text3" style={{ fontSize: 10 }}>Total SPOs</div>
          <div className="mono fw-700" style={{ fontSize: 22, color: 'var(--cyan)' }}>{total}</div>
        </div>
        {priceHidden ? null : (
          <div className="panel" style={{ minWidth: 100, padding: 12, textAlign: 'center' }}>
            <div className="text3" style={{ fontSize: 10 }}>Total Value (page)</div>
            <div className="mono fw-700" style={{ fontSize: 18, color: 'var(--green)' }}>
              ₹{inr(totalValue)}
            </div>
          </div>
        )}
        <div className="panel" style={{ minWidth: 100, padding: 12, textAlign: 'center' }}>
          <div className="text3" style={{ fontSize: 10 }}>Open</div>
          <div className="mono fw-700" style={{ fontSize: 22, color: 'var(--amber)' }}>{openCount}</div>
        </div>
        <div className="panel" style={{ minWidth: 100, padding: 12, textAlign: 'center' }}>
          <div className="text3" style={{ fontSize: 10 }}>Completed</div>
          <div className="mono fw-700" style={{ fontSize: 22, color: 'var(--cyan)' }}>{completedCount}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <input
          className="innovic-input"
          placeholder="Search SPO no / vendor / remarks…"
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
            setPage(1);
          }}
          style={{ width: 280, fontSize: 12 }}
        />
        <select
          className="innovic-select"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as SpoStatus | '');
            setPage(1);
          }}
          style={{ width: 160, fontSize: 12 }}
        >
          <option value="">All statuses</option>
          {/* New SPOs are all "Open" (stored as pending); Completed/Cancelled
              are the terminal states. */}
          <option value="pending">Open</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>SPO No.</th>
                <th>Date</th>
                <th>Vendor</th>
                <th>SO / Cost Center</th>
                <th style={{ color: '#7c3aed' }}>Expense</th>
                <th>Lines</th>
                {priceHidden ? null : (
                  <th className="td-ctr" style={{ color: 'var(--green)' }}>Total</th>
                )}
                <th>Status</th>
                <th>Terms</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={9} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load'}
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    No Service POs yet. Click + New Service PO.
                  </td>
                </tr>
              ) : (
                items.map((p) => <Row key={p.id} po={p} priceHidden={priceHidden} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          fontSize: 12,
          color: 'var(--text3)',
        }}
      >
        <span>
          {total === 0
            ? 'No entries'
            : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>
            Page {page} / {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Mirror of legacy vndLabel L1492: "Name [CODE]" with the code muted, falling
// back to whichever of the two is present. Legacy re-looks-up the vendor in
// db.vendors; the list row already carries both fields, so no lookup is needed.
function VendorLabel({
  code,
  name,
}: {
  code: string | null;
  name: string | null;
}): React.JSX.Element {
  if (!code && !name) return <>—</>;
  const shownName = name ?? code ?? '';
  const shownCode = code ?? '';
  if (shownName && shownCode && shownName !== shownCode) {
    return (
      <>
        {shownName}{' '}
        <span className="text3" style={{ fontSize: 10 }}>
          [{shownCode}]
        </span>
      </>
    );
  }
  return <>{shownName || shownCode}</>;
}

function Row({ po, priceHidden }: { po: ServicePoListItem; priceHidden: boolean }): React.JSX.Element {
  return (
    <tr>
      <td>
        <Link
          to="/service-pos/$id"
          params={{ id: po.id }}
          className="mono fw-700"
          style={{ color: 'var(--cyan)', textDecoration: 'none' }}
        >
          {po.spoNo}
        </Link>
      </td>
      <td className="text2" style={{ fontSize: 11 }}>{po.spoDate}</td>
      <td>
        <VendorLabel code={po.vendorCodeText} name={po.vendorName} />
      </td>
      <td className="text2" style={{ fontSize: 11 }}>
        {po.costCenter === 'general' ? 'General' : (po.soCode ?? po.soNoText ?? '—')}
      </td>
      <td style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>{po.expenseHead}</td>
      <td style={{ fontSize: 11 }}>{po.lineCount}</td>
      {priceHidden ? null : (
        <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
          ₹{Math.round(po.total ?? 0).toLocaleString('en-IN')}
        </td>
      )}
      <td>
        <span style={{ fontWeight: 700, color: statusColor(po.status) }}>
          {STATUS_LABEL[po.status] ?? po.status}
        </span>
      </td>
      <td className="text3" style={{ fontSize: 11 }}>{po.paymentTerms}</td>
    </tr>
  );
}
