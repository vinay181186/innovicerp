// Service POs list — mirror of legacy _spoRegister (renderServicePO L27504).
//
// Cards (Total/Pending/Draft/Total Value) + searchable table.

import type { ListServicePosQuery, ServicePoListItem } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useServicePosList } from '../api';

const PAGE_SIZE = 50;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['draft', 'pending', 'approved', 'completed', 'cancelled']).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const servicePosListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'service-pos',
  validateSearch: listSearchSchema,
  component: ServicePosListPage,
});

function inr(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

function statusColor(s: string): string {
  if (s === 'approved') return 'var(--green)';
  if (s === 'pending') return 'var(--amber)';
  if (s === 'completed') return 'var(--cyan)';
  if (s === 'cancelled') return 'var(--red)';
  return 'var(--text3)';
}

// Legacy stores the status title-cased and prints it verbatim (_spoRegister
// L27651). Our enum is lower-case, so map back to legacy's own strings.
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending: 'Pending',
  approved: 'Approved',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function ServicePosListPage(): React.JSX.Element {
  const search = servicePosListRoute.useSearch();
  const navigate = servicePosListRoute.useNavigate();
  const { data: me } = useSession();
  const canEdit = me?.role === 'admin' || me?.role === 'manager';

  const query: ListServicePosQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.page],
  );

  const { data, isLoading, isError, error } = useServicePosList(query);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const totalValue = items.reduce((s, p) => s + p.total, 0);
  const pending = items.filter((p) => p.status === 'pending').length;
  const draft = items.filter((p) => p.status === 'draft').length;

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
        <div>
          <div className="section-hdr" style={{ marginBottom: 0 }}>
            💳 Service PO
          </div>
          <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
            Non-inventory purchase orders (labour, maintenance, calibration, consultancy, …).
          </div>
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
        <div className="panel" style={{ minWidth: 100, padding: 12, textAlign: 'center' }}>
          <div className="text3" style={{ fontSize: 10 }}>Total Value (page)</div>
          <div className="mono fw-700" style={{ fontSize: 18, color: 'var(--green)' }}>
            ₹{inr(totalValue)}
          </div>
        </div>
        <div className="panel" style={{ minWidth: 100, padding: 12, textAlign: 'center' }}>
          <div className="text3" style={{ fontSize: 10 }}>Pending Approval</div>
          <div className="mono fw-700" style={{ fontSize: 22, color: 'var(--amber)' }}>{pending}</div>
        </div>
        <div className="panel" style={{ minWidth: 100, padding: 12, textAlign: 'center' }}>
          <div className="text3" style={{ fontSize: 10 }}>Draft</div>
          <div className="mono fw-700" style={{ fontSize: 22, color: 'var(--text3)' }}>{draft}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <input
          className="innovic-input"
          placeholder="Search SPO no / vendor / remarks…"
          value={search.search ?? ''}
          onChange={(e) =>
            void navigate({
              search: (prev) => ({ ...prev, search: e.target.value || undefined, page: 1 }),
              replace: true,
            })
          }
          style={{ width: 280, fontSize: 12 }}
        />
        <select
          className="innovic-select"
          value={search.status ?? ''}
          onChange={(e) =>
            void navigate({
              search: (prev) => ({
                ...prev,
                status: (e.target.value || undefined) as
                  | 'draft' | 'pending' | 'approved' | 'completed' | 'cancelled' | undefined,
                page: 1,
              }),
              replace: true,
            })
          }
          style={{ width: 160, fontSize: 12 }}
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
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
                <th className="td-ctr" style={{ color: 'var(--green)' }}>Total</th>
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
                items.map((p) => <Row key={p.id} po={p} />)
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
            : `Showing ${(search.page - 1) * PAGE_SIZE + 1}–${Math.min(search.page * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={search.page <= 1}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.max(1, search.page - 1) }),
                replace: true,
              })
            }
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>
            Page {search.page} / {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={search.page >= totalPages}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.min(totalPages, search.page + 1) }),
                replace: true,
              })
            }
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

function Row({ po }: { po: ServicePoListItem }): React.JSX.Element {
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
      <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
        ₹{Math.round(po.total).toLocaleString('en-IN')}
      </td>
      <td>
        <span style={{ fontWeight: 700, color: statusColor(po.status) }}>
          {STATUS_LABEL[po.status] ?? po.status}
        </span>
      </td>
      <td className="text3" style={{ fontSize: 11 }}>{po.paymentTerms}</td>
    </tr>
  );
}
