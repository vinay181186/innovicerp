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
import { matchesSearchTerm } from '@/components/shared/search-match';
import { authenticatedRoute } from '@/routes/_authenticated';
import { StatStrip } from '@/ui/data';
import { ListHeader } from '@/ui/layout';
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
  const [term, setTerm] = useState('');

  const subscribedCodes = useMemo(() => {
    const set = new Set<string>();
    for (const s of subscriptions.data?.subscriptions ?? []) set.add(s.code);
    return set;
  }, [subscriptions.data]);

  const visible = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.alerts].sort((a, b) => a.code.localeCompare(b.code));
    const shown = showZero ? sorted : sorted.filter((a) => a.count > 0);
    // Client-side search over the three text columns (department, code, name).
    return shown.filter((a) => matchesSearchTerm([DEPT_LABEL[a.dept], a.code, a.name], term));
  }, [data, showZero, term]);

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
      <ListHeader
        title="Alerts"
        icon="🔔"
        count={data ? visible.length : undefined}
        noun="alert"
        filterNote={showZero ? undefined : 'with records'}
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search department, alert code, alert name…"
        updating={isFetching && !isLoading}
        tools={
          <>
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
            <Link to="/alerts/config" className="btn btn-ghost btn-sm">
              Configure
            </Link>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                void qc.invalidateQueries({ queryKey: alertsKeys.list() });
                void refetch();
              }}
              disabled={isFetching}
            >
              <RefreshCw size={13} className={isFetching ? 'animate-spin' : undefined} /> Refresh
            </button>
          </>
        }
      >
        {/* Dept summary — legacy L22349-22354 + the TOTAL card L22364-22366,
            as one strip. */}
        {data ? (
          <StatStrip
            items={[
              ...(Object.keys(byDept) as Array<keyof typeof DEPT_COLOR>).map((dept) => ({
                key: dept,
                label: DEPT_LABEL[dept],
                count: byDept[dept] ?? 0,
                color: (byDept[dept] ?? 0) > 0 ? 'var(--amber2)' : 'var(--green2)',
              })),
              {
                key: 'total',
                label: 'Total',
                count: total,
                color: total > 0 ? 'var(--red2)' : 'var(--green2)',
              },
            ]}
          />
        ) : null}
      </ListHeader>

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
            <span style={{ color: 'var(--red2)' }}>
              {error instanceof Error ? error.message : 'Could not load alerts. Try again.'}
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="panel">
            <div className="tbl-wrap">
              <table className="innovic-table tbl-grid">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Code</th>
                    <th>Alert Name</th>
                    <th className="th-num">Records</th>
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
                          <td className="td-num">
                            <span
                              className="mono fw-700"
                              style={{
                                fontSize: 16,
                                color: interactive
                                  ? isUrgent
                                    ? 'var(--red2)'
                                    : 'var(--amber2)'
                                  : 'var(--green2)',
                              }}
                            >
                              {a.count}
                            </span>
                          </td>
                          <td>
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
                          <td>
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

          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
            <Bell size={12} className="inline align-text-bottom" /> = get this alert by email.
          </div>
        </>
      )}
    </div>
  );
}
