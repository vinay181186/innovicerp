// Stuck Activity Dashboard — mirror of legacy renderStuckDashboard (L18017).
//
// Flags SO phases that have run past their day threshold, sorted by most-over-
// threshold (stage groups kept adjacent, largest group first). Read-only.
// Thresholds ship as constants for v1 (legacy had an editable config; no config
// store yet).
//
// ADR-199 table standard (2026-10-01): the one ruled fit sheet
// <DataTable tableKey={TABLE_KEYS.stuckDashboard}>. SO No. is the pinned first
// column; Stage moved from a group-header band into its own column (coloured by
// severity); numbers right-align; a whole-row tint flags how far over threshold
// the activity is (red past 5 days, amber otherwise). The ⋯ row menu carries
// Assign Task, and the row opens the Sales Order. Column sort / filter come from
// the table's own ▾ header menus (ADR-200), alongside the page search.

import type { StuckDashboardResponse, StuckItem } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { apiFetch } from '@/lib/api';
import { fmtDate } from '@/lib/date';
import { AssignTaskModal } from '@/modules/tasks/components/task-modals';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  DataTable,
  Panel,
  ROW_TINT,
  StatStrip,
  type DataTableColumn,
  type RowMenuItem,
} from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListHeader } from '@/ui/layout';

export const stuckDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'stuck-dashboard',
  component: StuckDashboardPage,
});

// Severity ramp for the "over by" columns (legacy L18138 `over>10?'#7f1d1d':
// over>5?'#b91c1c':'#ea580c'`). Legacy's literals are tuned for its DARK theme;
// this port is light, so map to the nearest tokens and keep the three distinct
// escalating steps rather than copying the hex (ISSUE-067).
function overColor(over: number): string {
  return over > 10 ? 'var(--red2)' : over > 5 ? 'var(--red)' : 'var(--orange)';
}

const over = (it: StuckItem): number => it.days - it.threshold;

function stuckColumns(): DataTableColumn<StuckItem>[] {
  return [
    {
      id: 'so_no',
      kind: 'code',
      header: 'SO No.',
      className: 'td-code',
      render: (it) => (
        <Link
          to="/sales-orders/$id"
          params={{ id: it.soId }}
          style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {it.soNo}
        </Link>
      ),
    },
    {
      id: 'stage',
      kind: 'code',
      header: 'Stage',
      filterValue: (it) => it.stage,
      render: (it) => <span style={{ color: it.color, fontWeight: 700 }}>{it.stage}</span>,
    },
    {
      id: 'customer',
      kind: 'text',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      render: (it) => it.customer ?? '—',
      title: (it) => it.customer ?? '',
    },
    {
      id: 'stuck_for',
      kind: 'num',
      header: 'Stuck For',
      align: 'right',
      className: 'mono fw-700',
      filterValue: (it) => it.days,
      render: (it) => <span style={{ color: overColor(over(it)) }}>{it.days} days</span>,
    },
    {
      id: 'threshold',
      kind: 'num',
      header: 'Threshold',
      align: 'right',
      className: 'mono text3',
      filterValue: (it) => it.threshold,
      render: (it) => `${it.threshold} days`,
    },
    {
      id: 'over_by',
      kind: 'num',
      header: 'Over By',
      align: 'right',
      className: 'mono fw-700',
      filterValue: (it) => over(it),
      render: (it) => <span style={{ color: overColor(over(it)) }}>+{over(it)} days</span>,
    },
    {
      id: 'stuck_since',
      kind: 'date',
      header: 'Stuck Since',
      className: 'text3',
      filterValue: (it) => it.since,
      render: (it) => fmtDate(it.since),
    },
    {
      id: 'detail',
      kind: 'text',
      header: 'Detail',
      align: 'left',
      ellipsis: true,
      render: (it) => it.detail,
      title: (it) => it.detail,
    },
  ];
}

function StuckDashboardPage(): React.JSX.Element {
  const { data, isLoading, isFetching, isError, error } = useQuery<StuckDashboardResponse>({
    queryKey: ['stuck-dashboard'],
    queryFn: () => apiFetch<StuckDashboardResponse>('/stuck-dashboard'),
    staleTime: 30_000,
  });
  const navigate = useNavigate();
  // Client-side search over the rows loaded — SO No., customer, stage, detail.
  const [term, setTerm] = useState('');
  // The row whose ⋯ → Assign Task popup is open; null = closed.
  const [assignFor, setAssignFor] = useState<StuckItem | null>(null);

  // Keep the legacy ordering: group by stage, largest group first, rows inside a
  // group in the server's most-over order — then flatten to one list so same-
  // stage rows stay adjacent in the single table.
  const rows = useMemo(() => {
    const items = (data?.items ?? []).filter((it) =>
      matchesSearchTerm([it.soNo, it.customer, it.stage, it.detail], term),
    );
    const grouped = new Map<string, StuckItem[]>();
    for (const it of items) {
      const arr = grouped.get(it.stage);
      if (arr) arr.push(it);
      else grouped.set(it.stage, [it]);
    }
    return [...grouped.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .flatMap(([, arr]) => arr);
  }, [data, term]);

  const columns = useMemo(() => stuckColumns(), []);

  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red2)' }}>
        {error instanceof Error ? error.message : 'Could not load stuck jobs. Try again.'}
      </div>
    );
  }

  return (
    <div>
      <ListHeader
        title="Stuck Dashboard"
        icon="⚠"
        count={rows.length}
        noun="stuck activity"
        nounPlural="stuck activities"
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search SO No., customer, stage, detail…"
        updating={isFetching}
      >
        <StatStrip
          items={[
            {
              key: 'total',
              label: 'Total Stuck',
              count: data.summary.totalStuck,
              color: 'var(--amber2)',
            },
            {
              key: 'critical',
              label: 'Critical',
              count: data.summary.criticalStuck,
              color: 'var(--red2)',
              title: 'Over by 5+ days',
            },
            {
              key: 'stages',
              label: 'Stages Affected',
              count: data.summary.stagesAffected,
              color: 'var(--blue)',
            },
          ]}
        />
      </ListHeader>

      {data.summary.totalStuck === 0 ? (
        <div
          className="empty-state"
          style={{
            padding: 60,
            color: 'var(--green2)',
            background: 'var(--sig-ok-bg)',
            borderRadius: 'var(--radius2)',
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700 }}>No stuck jobs.</div>
        </div>
      ) : (
        <>
          <Panel bodyPadding="none">
            <DataTable<StuckItem>
              tableKey={TABLE_KEYS.stuckDashboard}
              columns={columns}
              rows={rows}
              rowKey={(it, i) => `${it.soId}:${it.stage}:${i}`}
              empty={term ? 'No stuck activities match.' : 'No stuck jobs.'}
              rowClassName={(it) => (over(it) > 5 ? ROW_TINT.late : ROW_TINT.pending)}
              onRowClick={(it) =>
                void navigate({ to: '/sales-orders/$id', params: { id: it.soId } })
              }
              rowMenu={(it): RowMenuItem[] => [
                {
                  key: 'assign',
                  label: 'Assign Task',
                  icon: 'user-round',
                  group: 'assign',
                  onSelect: () => setAssignFor(it),
                },
              ]}
            />
          </Panel>
          {/* Thresholds on demand — a "?" with the day limits in its tooltip. */}
          <div
            className="text3"
            style={{ fontSize: 11, marginTop: 12, cursor: 'help', display: 'inline-block' }}
            title={`Thresholds (days): design ${data.thresholds.design} · plan ${data.thresholds.planToJc} · material ${data.thresholds.materialProc} · production op ${data.thresholds.productionOp} · QC ${data.thresholds.qc} · assembly ${data.thresholds.assembly}`}
          >
            ? Thresholds
          </div>
        </>
      )}
      {assignFor ? (
        <AssignTaskModal
          linkedRef={{
            type: 'sales_order',
            id: assignFor.soId,
            display: `SO ${assignFor.soNo}`,
            navPage: `/sales-orders/${assignFor.soId}`,
          }}
          suggestedTitle={`Unstick ${assignFor.soNo} — ${assignFor.stage}`}
          onClose={() => setAssignFor(null)}
        />
      ) : null}
    </div>
  );
}
