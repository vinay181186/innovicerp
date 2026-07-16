// Alerts dashboard (T-041d Phase A). Mirrors legacy `renderAlerts`
// (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html L22323):
//   - per-dept summary cards + TOTAL card (L22349-22366)
//   - main table: Department · Code · Alert Name · Records (L22367-22369)
//   - clickable row when count > 0 → drill-down route (legacy opened a modal
//     via _alertDrillDown; the port navigates to /alerts/$code)
//   - "show zero records" toggle (legacy default false)
//   - manual refresh button (60s polling otherwise)
//
// Port-only columns kept beyond legacy's four: Email (Phase B digest
// subscription) and the drill-down arrow link.

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Bell, BellOff, BellRing, Loader2, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useAlerts, alertsKeys, useMySubscriptions, useToggleSubscription } from '../api';
import { DEPT_COLOR, DEPT_LABEL } from '../lib/dept';
import { useQueryClient } from '@tanstack/react-query';

export const alertsDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'alerts',
  component: AlertsDashboardPage,
});

function AlertsDashboardPage() {
  const { data, isLoading, isFetching, isError, error, refetch } = useAlerts();
  const subscriptions = useMySubscriptions();
  const toggleSub = useToggleSubscription();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showZero, setShowZero] = useState(false);

  const subscribedCodes = useMemo(() => {
    const set = new Set<string>();
    for (const s of subscriptions.data?.subscriptions ?? []) set.add(s.code);
    return set;
  }, [subscriptions.data]);

  const visible = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.alerts].sort((a, b) => a.code.localeCompare(b.code));
    return showZero ? sorted : sorted.filter((a) => a.count > 0);
  }, [data, showZero]);

  const total = useMemo(() => (data ? data.alerts.reduce((s, a) => s + a.count, 0) : 0), [data]);

  const byDept = useMemo(() => {
    const out: Record<string, number> = {};
    if (!data) return out;
    for (const a of data.alerts) {
      out[a.dept] = (out[a.dept] ?? 0) + a.count;
    }
    return out;
  }, [data]);

  return (
    <div>
      {/* Header row — legacy L22357-22362. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          🔔 Alerts Dashboard
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label
            style={{
              fontSize: 11,
              color: 'var(--text3)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showZero}
              onChange={(e) => setShowZero(e.target.checked)}
              style={{ accentColor: 'var(--cyan)' }}
            />{' '}
            Show zero records
          </label>
          {/* No legacy counterpart — kept: legacy reached Alert Configuration
              from its sidebar, which the port renders as a route link. */}
          <Link to="/alerts/config" className="btn btn-ghost" style={{ fontSize: 12 }}>
            Configure
          </Link>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            onClick={() => {
              void qc.invalidateQueries({ queryKey: alertsKeys.list() });
              void refetch();
            }}
            disabled={isFetching}
          >
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : undefined} /> Refresh
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading alerts…
          </div>
        </div>
      ) : isError || !data ? (
        <div className="panel">
          <div className="empty-state">
            <span style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load alerts.'}
            </span>
          </div>
        </div>
      ) : (
        <>
          {/* Dept summary cards — legacy L22349-22354 + the TOTAL card L22364-22366. */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {(Object.keys(byDept) as Array<keyof typeof DEPT_COLOR>).map((dept) => {
              const deptCount = byDept[dept] ?? 0;
              return (
                <div
                  key={dept}
                  className="panel"
                  style={{
                    minWidth: 90,
                    padding: 10,
                    textAlign: 'center',
                    borderTop: `3px solid ${DEPT_COLOR[dept]}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      color: DEPT_COLOR[dept],
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {DEPT_LABEL[dept]}
                  </div>
                  <div
                    className="mono fw-700"
                    style={{
                      fontSize: 20,
                      color: deptCount > 0 ? 'var(--amber)' : 'var(--green)',
                    }}
                  >
                    {deptCount}
                  </div>
                </div>
              );
            })}
            <div
              className="panel"
              style={{
                minWidth: 90,
                padding: 10,
                textAlign: 'center',
                borderTop: '3px solid var(--red)',
              }}
            >
              <div style={{ fontSize: 10, color: 'var(--red)', fontWeight: 700 }}>TOTAL</div>
              <div
                className="mono fw-700"
                style={{ fontSize: 20, color: total > 0 ? 'var(--red)' : 'var(--green)' }}
              >
                {total}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Code</th>
                    <th>Alert Name</th>
                    <th>Records</th>
                    <th>Email</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="empty-state">
                        ✅ No alerts! Everything is clear.
                      </td>
                    </tr>
                  ) : (
                    visible.map((a) => {
                      const isUrgent =
                        a.count > 0 &&
                        (a.name.toLowerCase().includes('overdue') ||
                          a.name.toLowerCase().includes('pending'));
                      const interactive = a.count > 0;
                      const subscribed = subscribedCodes.has(a.code);
                      const subBusy = toggleSub.isPending && toggleSub.variables?.code === a.code;
                      return (
                        <tr
                          key={a.code}
                          style={{ cursor: interactive ? 'pointer' : 'default' }}
                          title={interactive ? 'Click to see details' : 'No records'}
                          onClick={
                            interactive
                              ? () =>
                                  void navigate({ to: '/alerts/$code', params: { code: a.code } })
                              : undefined
                          }
                        >
                          <td>
                            <span
                              style={{ fontWeight: 700, color: DEPT_COLOR[a.dept], fontSize: 12 }}
                            >
                              {DEPT_LABEL[a.dept]}
                            </span>
                          </td>
                          <td className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>
                            {a.code}
                          </td>
                          {/* Legacy sets `color:var(--text1)` here for count>0 — a token it
                              never defines (:root L14 has text/text2/text3 only), so the cell
                              inherits the default td colour. Reproduced by omitting colour. */}
                          <td
                            style={{
                              fontWeight: 600,
                              ...(interactive ? {} : { color: 'var(--text3)' }),
                            }}
                          >
                            {a.name}
                          </td>
                          <td className="td-ctr">
                            <span
                              className="mono fw-700"
                              style={{
                                fontSize: 16,
                                color: interactive
                                  ? isUrgent
                                    ? 'var(--red)'
                                    : 'var(--amber)'
                                  : 'var(--green)',
                              }}
                            >
                              {a.count}
                            </span>
                          </td>
                          <td className="td-ctr">
                            <button
                              type="button"
                              disabled={subBusy || subscriptions.isLoading}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSub.mutate({ code: a.code, subscribed: !subscribed });
                              }}
                              className="btn btn-ghost btn-icon"
                              aria-pressed={subscribed}
                              aria-label={
                                subscribed
                                  ? `Unsubscribe from ${a.code} email digest`
                                  : `Subscribe to ${a.code} email digest`
                              }
                              title={
                                subscribed
                                  ? 'Subscribed — click to unsubscribe'
                                  : 'Not subscribed — click to receive the email digest'
                              }
                            >
                              {subBusy ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : subscribed ? (
                                <BellRing size={14} style={{ color: 'var(--cyan)' }} />
                              ) : (
                                <BellOff size={14} />
                              )}
                            </button>
                          </td>
                          <td className="td-ctr">
                            {interactive ? (
                              <Link
                                to="/alerts/$code"
                                params={{ code: a.code }}
                                onClick={(e) => e.stopPropagation()}
                                style={{ color: 'var(--text3)' }}
                                aria-label={`Drill into ${a.code}`}
                              >
                                <ArrowRight size={14} className="inline" />
                              </Link>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tip — legacy L22370. The email-digest sentence is ours: the Email
              column above is a real port-only feature (Phase B subscriptions). */}
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
            💡 Click any alert with records to see details. Use the{' '}
            <Bell size={12} className="inline align-text-bottom" /> column to opt into the email
            digest for that alert. Configure alerts in{' '}
            <Link to="/alerts/config" style={{ color: 'var(--cyan)' }}>
              🔔 Alert Configuration
            </Link>
            .
          </div>
        </>
      )}
    </div>
  );
}
