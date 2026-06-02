// Customer Dispatch Register — mirror of legacy dispatchLog / renderDispatch
// Register. Lists dispatches; cancel reverses the SO-line dispatched qty.

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCancelDispatch, useDispatchList } from '../api';

export const customerDispatchListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'customer-dispatches',
  component: CustomerDispatchListPage,
});

function CustomerDispatchListPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useDispatchList();
  const cancel = useCancelDispatch();

  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Failed to load'}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          🚚 Customer Dispatch Register
        </div>
        <Link to="/customer-dispatches/new" className="btn btn-primary">
          + New Dispatch
        </Link>
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Dispatch No.</th>
                <th>Date</th>
                <th>SO</th>
                <th>Customer</th>
                <th className="td-ctr">Lines</th>
                <th className="td-ctr">Total Qty</th>
                <th>Transport</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.dispatches.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    No dispatches yet. Click + New Dispatch.
                  </td>
                </tr>
              ) : (
                data.dispatches.map((d) => (
                  <tr key={d.id} style={d.status === 'cancelled' ? { opacity: 0.55 } : undefined}>
                    <td className="td-code" style={{ color: 'var(--cyan)', fontWeight: 800 }}>
                      {d.code}
                    </td>
                    <td style={{ fontSize: 11 }}>{d.dispatchDate}</td>
                    <td className="td-code" style={{ color: 'var(--purple)' }}>{d.soCode ?? '—'}</td>
                    <td className="fw-700">{d.customer ?? '—'}</td>
                    <td className="td-ctr mono">{d.lineCount}</td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>{d.totalQty}</td>
                    <td style={{ fontSize: 11 }}>
                      {d.transport ?? '—'}
                      {d.vehicleNo ? ` · ${d.vehicleNo}` : ''}
                    </td>
                    <td>
                      <span className={`badge ${d.status === 'cancelled' ? 'b-grey' : 'b-green'}`}>
                        {d.status}
                      </span>
                    </td>
                    <td>
                      {d.status !== 'cancelled' ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--red)', fontSize: 10 }}
                          disabled={cancel.isPending}
                          onClick={() => {
                            if (confirm(`Cancel dispatch ${d.code}? This reverses the dispatched qty.`)) {
                              cancel.mutate(d.id);
                            }
                          }}
                        >
                          ✖ Cancel
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
