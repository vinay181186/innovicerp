// Alerts dashboard (T-041d Phase A). Mirrors legacy `renderAlerts`
// (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html L22323):
//   - per-dept counts + Total, as one StatStrip (R5 SH-N20)
//   - main table: Alert Name · Department · Records · Email (Code column
//     dropped, R5 SH-N17)
//   - clickable row when count > 0 → drill-down route (legacy opened a modal
//     via _alertDrillDown; the port navigates to /alerts/$code)
//   - "show zero records" toggle (legacy default false)
//   - manual refresh button (60s polling otherwise)
//
// Port-only column kept: Email (Phase B digest subscription). The arrow link
// column was dropped (R5 SH-N46) — the whole row opens the drill page.
//
// ADR-199 table standard (2026-10-01): the register is the shared fit
// <DataTable tableKey={TABLE_KEYS.alertsDashboard}>. A row opens its drill ONLY
// when its count > 0 — the engine's `isRowClickable` gate — and an urgent
// (overdue / pending) alert with records carries the late row tint.

import type { ListAlertsResponse } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Bell, BellOff, BellRing, Loader2, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT, StatStrip, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListHeader } from '@/ui/layout';
import { useAlerts, alertsKeys, useMySubscriptions, useToggleSubscription } from '../api';
import { DEPT_COLOR, DEPT_LABEL } from '../lib/dept';
import { useQueryClient } from '@tanstack/react-query';

export const alertsDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'alerts',
  component: AlertsDashboardPage,
});

type DashAlert = ListAlertsResponse['alerts'][number];

// Legacy colours `count>0` names "overdue"/"pending" red — the late tint is the
// token equivalent for the whole row.
function isUrgent(a: DashAlert): boolean {
  if (a.count <= 0) return false;
  const n = a.name.toLowerCase();
  return n.includes('overdue') || n.includes('pending');
}

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

  // Columns — the alert/category first (always pinned), then department, the
  // record count (right-aligned number) and the email toggle.
  const columns: DataTableColumn<DashAlert>[] = [
    {
      header: 'Alert Name',
      id: 'name',
      key: 'name',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      title: (a) => a.name,
      render: (a) => (
        <span style={{ fontWeight: 600, ...(a.count > 0 ? {} : { color: 'var(--text3)' }) }}>
          {a.name}
        </span>
      ),
    },
    {
      header: 'Department',
      id: 'dept',
      kind: 'code',
      filterValue: (a) => DEPT_LABEL[a.dept],
      render: (a) => (
        <span style={{ fontWeight: 700, color: DEPT_COLOR[a.dept], fontSize: 12 }}>
          {DEPT_LABEL[a.dept]}
        </span>
      ),
    },
    {
      header: 'Records',
      id: 'count',
      kind: 'num',
      align: 'right',
      filterValue: (a) => a.count,
      render: (a) => (
        <span
          className="mono fw-700"
          style={{
            fontSize: 16,
            color: a.count > 0 ? (isUrgent(a) ? 'var(--red2)' : 'var(--amber2)') : 'var(--green2)',
          }}
        >
          {a.count}
        </span>
      ),
    },
    {
      header: 'Email',
      id: 'email',
      kind: 'actions',
      stopRowClick: true,
      filterable: false,
      render: (a) => {
        const subscribed = subscribedCodes.has(a.code);
        const subBusy = toggleSub.isPending && toggleSub.variables?.code === a.code;
        return (
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
              subscribed ? `Unsubscribe from ${a.name} email` : `Subscribe to ${a.name} email`
            }
            title={
              subscribed
                ? 'Subscribed — click to unsubscribe'
                : 'Not subscribed — click to get this alert by email'
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
        );
      },
    },
  ];

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
        filters={
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
        }
        onClearFilters={() => {
          setShowZero(false);
          setTerm('');
        }}
        filtersActive={showZero || term.trim() !== ''}
        tools={
          <>
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

      {isError || (!data && !isLoading) ? (
        <div className="panel">
          <div className="empty-state">
            <span style={{ color: 'var(--red2)' }}>
              {error instanceof Error ? error.message : 'Could not load alerts. Try again.'}
            </span>
          </div>
        </div>
      ) : (
        <>
          <Panel bodyPadding="none">
            <DataTable
              tableKey={TABLE_KEYS.alertsDashboard}
              columns={columns}
              rows={visible}
              rowKey={(a) => a.code}
              loading={isLoading}
              empty={term.trim() ? 'No alerts match.' : '✅ Nothing pending'}
              isRowClickable={(a) => a.count > 0}
              onRowClick={(a) => void navigate({ to: '/alerts/$code', params: { code: a.code } })}
              rowClassName={(a) => (isUrgent(a) ? ROW_TINT.late : undefined)}
            />
          </Panel>

          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
            <Bell size={12} className="inline align-text-bottom" /> = get this alert by email.
          </div>
        </>
      )}
    </div>
  );
}
