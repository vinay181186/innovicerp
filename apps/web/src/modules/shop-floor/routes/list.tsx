// Shop Floor — mirrors legacy renderShopFloor (HTML L10286).
// Live running ops grouped by machine.

import { createRoute } from '@tanstack/react-router';
import { Loader2, RefreshCw } from 'lucide-react';
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
            <RefreshCw size={12} /> Refresh
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
              border: `1px solid ${m.runningCount > 0 ? 'var(--amber)' : 'var(--border)'}`,
              background:
                m.runningCount > 0 ? 'rgba(245,158,11,0.10)' : 'var(--bg3)',
              textAlign: 'center',
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
            <div style={{ fontSize: 36, marginBottom: 8 }}>🏭</div>
            <b>No operations currently running</b>
            <br />
            <span className="text3" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
              Use Op Entry → ▶ Start to begin tracking jobs
            </span>
          </div>
        </div>
      ) : (
        (data?.machines ?? [])
          .filter((m) => m.runningCount > 0)
          .map((m) => (
            <div
              key={m.machineId}
              id={`sf_${m.machineId}`}
              className="panel"
              style={{ marginBottom: 14 }}
            >
              <div
                style={{
                  padding: '10px 14px',
                  background: 'rgba(245,158,11,0.10)',
                  borderBottom: '1px solid rgba(245,158,11,0.30)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div
                    className="mono fw-700"
                    style={{ fontSize: 15, color: 'var(--amber)' }}
                  >
                    {m.machineCode}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                    {m.machineName ?? ''} {m.machineType ? `· ${m.machineType}` : ''}
                  </div>
                </div>
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
                      {canWrite ? <th></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {m.rows.map((r) => (
                      <tr key={r.runningOpId}>
                        <td className="mono fw-700" style={{ color: 'var(--cyan)' }}>
                          {r.jcCode}
                        </td>
                        <td
                          className="td-ctr mono fw-700"
                          style={{ color: 'var(--amber)' }}
                        >
                          {r.opSeq}
                        </td>
                        <td className="fw-700">{r.operation}</td>
                        <td className="mono" style={{ color: 'var(--purple)' }}>
                          {r.itemCode ?? '—'}
                        </td>
                        <td>{r.itemName ?? '—'}</td>
                        <td className="mono text2" style={{ fontSize: 11 }}>
                          {r.soCode ?? '—'}
                        </td>
                        <td className="td-ctr mono">{r.orderQty}</td>
                        <td
                          className="td-ctr mono fw-700"
                          style={{ color: 'var(--green)' }}
                        >
                          {r.doneQty}
                        </td>
                        <td
                          className="td-ctr mono"
                          style={{ color: 'var(--red)' }}
                        >
                          {r.pendingQty}
                        </td>
                        <td>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 10,
                              fontSize: 10,
                              fontWeight: 700,
                              background: 'var(--bg4)',
                              color: 'var(--text2)',
                            }}
                          >
                            {r.priority}
                          </span>
                        </td>
                        <td className="text2" style={{ fontSize: 11 }}>
                          {r.dueDate ?? '—'}
                        </td>
                        <td className="fw-700" style={{ color: 'var(--amber)' }}>
                          {r.operatorName ?? '—'}
                        </td>
                        <td
                          className="text3"
                          style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                        >
                          {r.startDate} {r.startTime}
                        </td>
                        {canWrite ? (
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ fontSize: 11 }}
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
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
      )}
    </div>
  );
}
