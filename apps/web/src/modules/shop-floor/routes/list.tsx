// Shop Floor — mirrors legacy renderShopFloor (HTML L10286).
// Live running ops grouped by machine.

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useShopFloor, useStopRunningOp } from '../api';

export const shopFloorRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'shop-floor',
  component: ShopFloorPage,
});

function ShopFloorPage(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const { data, isLoading, isError, error, refetch } = useShopFloor();
  const stopMut = useStopRunningOp();

  const total = data?.total ?? 0;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="section-hdr m-0">🏭 Shop Floor — Live Running Jobs</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 14, color: 'var(--amber)', fontWeight: 700 }}>
            {total} operation{total !== 1 ? 's' : ''} currently running
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void refetch()}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Machine status card row */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        {(data?.machines ?? []).map((m) => (
          <a
            key={m.machineId}
            href={`#sf_${m.machineId}`}
            style={{
              flex: 1,
              minWidth: 120,
              padding: '10px 14px',
              borderRadius: 8,
              border: `1px solid ${m.runningCount > 0 ? 'var(--amber2)' : 'var(--border)'}`,
              background: m.runningCount > 0 ? 'var(--amber3)' : 'var(--bg3)',
              textAlign: 'center',
              cursor: 'pointer',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div
              className="mono fw-700"
              style={{
                fontSize: 14,
                color: m.runningCount > 0 ? 'var(--amber)' : 'var(--text3)',
              }}
            >
              {m.machineCode}
            </div>
            <div
              style={{
                fontSize: 10,
                color: m.runningCount > 0 ? 'var(--amber)' : 'var(--text3)',
              }}
            >
              {m.runningCount > 0 ? `▶ ${m.runningCount} running` : '⚫ Idle'}
            </div>
          </a>
        ))}
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
              {error instanceof Error ? error.message : 'Failed to load'}
            </div>
          </div>
        </div>
      ) : total === 0 ? (
        <div className="panel">
          <div className="empty-state" style={{ padding: 56 }}>
            <div className="empty-icon">🏭</div>
            <b>No operations currently running</b>
            <br />
            <span className="text3" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
              Use Op Entry → ▶ Start to begin tracking jobs
            </span>
          </div>
        </div>
      ) : (
        (data?.machines ?? []).map((m) =>
          m.runningCount === 0 ? (
            // Legacy L10302-10307: idle machines still get a header-only panel,
            // so every machine-status card above has a scroll target.
            <div
              key={m.machineId}
              id={`sf_${m.machineId}`}
              className="panel"
              style={{ marginBottom: 12 }}
            >
              <div className="panel-hdr" style={{ background: 'var(--bg4)' }}>
                <span
                  className="mono fw-700"
                  style={{ fontSize: 16, color: 'var(--cyan)' }}
                >
                  {m.machineCode}
                </span>
                <span className="text3" style={{ fontSize: 12 }}>
                  {m.machineName ?? ''}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>⚫ IDLE</span>
              </div>
            </div>
          ) : (
            <div
              key={m.machineId}
              id={`sf_${m.machineId}`}
              className="panel"
              style={{ marginBottom: 14 }}
            >
              {/* Legacy L10331-10335 renders the machine name twice — once as the
                  small line under the code, once in the `text2` span beside it. */}
              <div
                className="panel-hdr"
                style={{
                  background: 'var(--amber3)',
                  borderBottom: '1px solid var(--amber2)',
                }}
              >
                <span
                  className="mono fw-700"
                  style={{ fontSize: 15, color: 'var(--amber)' }}
                >
                  {m.machineCode}
                </span>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
                  {m.machineName ?? ''}
                </div>
                <span className="text2" style={{ fontSize: 12 }}>
                  {m.machineName ?? ''} · {m.machineType ?? ''}
                </span>
                <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 12 }}>
                  ▶ {m.runningCount} RUNNING
                </span>
              </div>
              <div className="tbl-wrap">
                <table className="innovic-table">
                  <thead>
                    <tr>
                      <th>JC No.</th>
                      <th className="td-ctr">Op</th>
                      <th>Operation</th>
                      <th>Item Code</th>
                      <th>Item Name</th>
                      <th>SO/WO</th>
                      <th className="td-ctr">Order</th>
                      <th className="td-ctr" style={{ color: 'var(--green)' }}>
                        Done
                      </th>
                      <th className="td-ctr" style={{ color: 'var(--red)' }}>
                        Pending
                      </th>
                      <th>Priority</th>
                      <th>Due</th>
                      <th>Operator</th>
                      <th>Started</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.rows.map((r) => (
                      <tr key={r.runningOpId}>
                        <td className="td-code cyan">
                          {r.jcId ? (
                            <Link
                              to="/job-cards/$id"
                              params={{ id: r.jcId }}
                              style={{
                                color: 'inherit',
                                textDecoration: 'underline dotted',
                                cursor: 'pointer',
                              }}
                              title="View job card status"
                            >
                              {r.jcCode}
                            </Link>
                          ) : (
                            r.jcCode
                          )}
                        </td>
                        <td className="td-ctr mono fw-700 amber">{r.opSeq}</td>
                        <td className="fw-700">{r.operation}</td>
                        <td className="td-code" style={{ color: 'var(--purple)' }}>
                          {r.itemCode ?? '—'}
                        </td>
                        <td>{r.itemName ?? '—'}</td>
                        <td className="mono text2" style={{ fontSize: 11 }}>
                          {r.soCode ?? '—'}
                        </td>
                        <td className="td-ctr mono">{r.orderQty}</td>
                        <td className="td-ctr green mono fw-700">{r.doneQty}</td>
                        <td className="td-ctr mono" style={{ color: 'var(--red)' }}>
                          {r.pendingQty}
                        </td>
                        <td>
                          {/* Legacy badge() (L1959): High → b-amber, Normal → b-grey. */}
                          <span
                            className={`badge ${r.priority === 'high' ? 'b-amber' : 'b-grey'}`}
                          >
                            {r.priority === 'high' ? 'High' : 'Normal'}
                          </span>
                        </td>
                        <td className="text2" style={{ fontSize: 11 }}>
                          {r.dueDate ?? '—'}
                        </td>
                        <td className="fw-700 amber">{r.operatorName ?? '—'}</td>
                        <td
                          className="text3"
                          style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                        >
                          {r.startDate} {r.startTime}
                        </td>
                        {/* Legacy L10327 renders an empty <td> when !canEdit(). */}
                        <td>
                          {canWrite ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={stopMut.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Stop ${r.jcCode} Op${r.opSeq} on ${m.machineCode}?`,
                                  )
                                ) {
                                  stopMut.mutate(r.runningOpId);
                                }
                              }}
                            >
                              ■ Stop
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ),
        )
      )}
    </div>
  );
}
