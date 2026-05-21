// Assembly Tracker list (PL-5). All Equipment SOs with assembled / dispatched
// counts + status badge. Click-through to the per-SO tracker.

import type { AssemblyListItem } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useAssembliesList } from '../api';

export const assemblyListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'assemblies',
  component: AssemblyListPage,
});

const STATUS_BADGE: Record<AssemblyListItem['status'], { cls: string; label: string }> = {
  waiting: { cls: 'b-grey', label: 'Waiting' },
  ready: { cls: 'b-blue', label: 'Ready' },
  assembling: { cls: 'b-amber', label: 'Assembling' },
  done: { cls: 'b-green', label: 'Done' },
};

function AssemblyListPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useAssembliesList();
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">🔧 Assembly Tracker</div>
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load assemblies'}
            </div>
          </div>
        </div>
      ) : data && data.items.length === 0 ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state">
              <div className="empty-icon">🔧</div>
              No Equipment SOs found. Create one on the Sales Orders page with type=equipment.
            </div>
          </div>
        </div>
      ) : data ? (
        <div className="panel">
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>SO #</th>
                  <th>Customer</th>
                  <th>BOM</th>
                  <th className="td-right">Required</th>
                  <th className="td-right">Assembled</th>
                  <th className="td-right">Dispatched</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => {
                  const status = STATUS_BADGE[row.status];
                  return (
                    <tr key={row.soId}>
                      <td>
                        <Link
                          to="/assemblies/$soId"
                          params={{ soId: row.soId }}
                          className="td-code"
                          style={{ color: 'var(--cyan)', fontWeight: 600 }}
                        >
                          {row.soCode}
                        </Link>
                      </td>
                      <td>{row.customerName ?? '—'}</td>
                      <td>
                        <span className="text3" style={{ fontSize: 12 }}>
                          {row.bomCode ?? '—'}
                        </span>
                      </td>
                      <td className="td-right">{row.orderQty}</td>
                      <td className="td-right" style={{ color: 'var(--green2)' }}>
                        {row.assembledQty}
                      </td>
                      <td className="td-right" style={{ color: 'var(--cyan)' }}>
                        {row.dispatchedQty}
                      </td>
                      <td>
                        <span className={`badge ${status.cls}`}>{status.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
