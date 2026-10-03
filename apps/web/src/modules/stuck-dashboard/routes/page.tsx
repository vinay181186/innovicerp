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

import type { StuckItem } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDate } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { soNoWithInternal } from '@/lib/so-number';
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
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useStuckDashboard } from '../api';

const searchSchema = z.object({
  search: z.string().optional(),
  page: pageSearchParam,
});

export const stuckDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'stuck-dashboard',
  validateSearch: searchSchema,
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
      sortFilterField: 'soNo',
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
          {soNoWithInternal(it.soNo, it.soInternalNo)}
        </Link>
      ),
    },
    {
      id: 'stage',
      sortFilterField: 'stage',
      kind: 'code',
      header: 'Stage',
      filterValue: (it) => it.stage,
      render: (it) => <span style={{ color: it.color, fontWeight: 700 }}>{it.stage}</span>,
    },
    {
      id: 'customer',
      sortFilterField: 'customer',
      kind: 'text',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      render: (it) => it.customer ?? '—',
      title: (it) => it.customer ?? '',
    },
    {
      id: 'stuck_for',
      sortFilterField: 'days',
      kind: 'num',
      header: 'Stuck For',
      align: 'right',
      className: 'mono fw-700',
      filterValue: (it) => it.days,
      render: (it) => <span style={{ color: overColor(over(it)) }}>{it.days} days</span>,
    },
    {
      id: 'threshold',
      sortFilterField: 'threshold',
      kind: 'num',
      header: 'Threshold',
      align: 'right',
      className: 'mono text3',
      filterValue: (it) => it.threshold,
      render: (it) => `${it.threshold} days`,
    },
    {
      id: 'over_by',
      sortFilterField: 'overBy',
      kind: 'num',
      header: 'Over By',
      align: 'right',
      className: 'mono fw-700',
      filterValue: (it) => over(it),
      render: (it) => <span style={{ color: overColor(over(it)) }}>+{over(it)} days</span>,
    },
    {
      id: 'stuck_since',
      sortFilterField: 'since',
      kind: 'date',
      header: 'Stuck Since',
      className: 'text3',
      filterValue: (it) => it.since,
      render: (it) => fmtDate(it.since),
    },
    {
      id: 'detail',
      sortFilterField: 'detail',
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
  const search = stuckDashboardRoute.useSearch();
  const nav = stuckDashboardRoute.useNavigate();
  const navigate = useNavigate();
  // ADR-201: 25 rows a page; search + Sort & Filter run on the SERVER over
  // every stuck activity (SO No., customer, stage, detail); any change → page 1.
  const [term, setTerm] = useState(search.search ?? '');
  useEffect(() => {
    const t = normalizeSearchTerm(term);
    const next = t === '' ? undefined : t;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void nav({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [term, search.search, nav]);
  const sf = useServerSortFilter(TABLE_KEYS.stuckDashboard, () => {
    void nav({ search: (prev) => ({ ...prev, page: 1 }), replace: true });
  });
  const onPage = useCallback(
    (p: number) => void nav({ search: (prev) => ({ ...prev, page: p }) }),
    [nav],
  );
  // Default order (server): grouped by stage, largest group first, most over
  // threshold first inside a group — so same-stage rows stay adjacent.
  const { data, isLoading, isFetching, isError, error } = useStuckDashboard({
    search: search.search,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(search.page),
  });
  useClampPage(search.page, data?.total, onPage);
  // The row whose ⋯ → Assign Task popup is open; null = closed.
  const [assignFor, setAssignFor] = useState<StuckItem | null>(null);
  const rows = data?.items ?? [];
  const filtered = Boolean(search.search) || sf.filtering;

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
    // `page-fill` (ADR-202): one table panel on this page, so it fills the
    // content area and the TABLE is the only thing that scrolls — the column
    // header can never ride off the top of the screen at the last row. The
    // KPI strip in the header and the thresholds hint stay fixed chrome.
    <div className="page-fill">
      <ListHeader
        title="Stuck Dashboard"
        icon="⚠"
        count={data.total}
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
          <Panel fill bodyPadding="none">
            <DataTable<StuckItem>
              tableKey={TABLE_KEYS.stuckDashboard}
              columns={columns}
              rows={rows}
              sortFilterServer={sf}
              rowKey={(it, i) => `${it.soId}:${it.stage}:${pageOffset(search.page) + i}`}
              empty={filtered ? 'No stuck activities match.' : 'No stuck jobs.'}
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
          <ListFooter
            total={data.total}
            noun="stuck activity"
            nounPlural="stuck activities"
            page={search.page}
            pageSize={LIST_PAGE_SIZE}
            onPage={onPage}
          />
          {/* Thresholds on demand — a "?" with the day limits in its tooltip. */}
          <div
            className="text3"
            /* alignSelf keeps it label-width: as a flex item of `.page-fill` an
                inline-block is blockified, which stretched the `help` cursor and
                the tooltip across the whole page. */
            style={{
              fontSize: 11,
              marginTop: 12,
              cursor: 'help',
              display: 'inline-block',
              alignSelf: 'flex-start',
            }}
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
