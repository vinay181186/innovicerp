// QC History & Tracking (QC Wave 2). Ports legacy renderQCHistory (HTML
// L23531): All/Pending/Completed status + 2 KPI tiles + SO/JC/Item + date
// filters + pending QC table + completed QC-entries table + Excel export.
// Read-only, legacy chrome.
//
// ADR-201: each table shows 25 rows per page (`page` / `logPage` in the URL)
// and loads only that page. Search, the QC date range and Sort & Filter (▾)
// run on the SERVER over every row; any change goes back to page 1. The status
// counts are the two lists' server totals, the KPI tiles are server figures,
// and the Excel export fetches EVERY filtered row.

import type { ListQcLogsQuery, ListQcPendingQuery } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import {
  LIST_PAGE_SIZE,
  fetchAllPages,
  pageOffset,
  pageSearchParam,
  useClampPage,
} from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, StatStrip } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ActionMenu, ListFooter, ListHeader } from '@/ui/layout';
import {
  fetchQcLogs,
  fetchQcPending,
  useQcHistoryStats,
  useQcLogsList,
  useQcPendingList,
} from '../api';
import {
  QC_HISTORY_DEFAULT_PINNED,
  qcEntryColumns,
  qcPendingColumns,
} from '../components/qc-history-columns';
import { exportCompletedQc, exportPendingQc } from '../lib/export';

export const qcHistoryRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-history',
  validateSearch: z.object({ page: pageSearchParam, logPage: pageSearchParam }),
  component: QcHistoryPage,
});

type Tab = 'all' | 'pending' | 'completed';

// Legacy L23599-23601 tabs, now the Status dropdown in the filter bar.
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'completed', label: 'Completed' },
];

function QcHistoryPage(): React.JSX.Element {
  const search = qcHistoryRoute.useSearch();
  const navigate = qcHistoryRoute.useNavigate();
  const [tab, setTab] = useState<Tab>('all');
  const [term, setTerm] = useState('');
  const [q, setQ] = useState<string | undefined>(undefined);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const pendingColumns = useMemo(() => qcPendingColumns(), []);
  const entryColumns = useMemo(() => qcEntryColumns(), []);

  const gotoPages = useCallback(
    (next: { page?: number; logPage?: number }): void => {
      void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
    },
    [navigate],
  );
  const firstPages = useCallback(() => gotoPages({ page: 1, logPage: 1 }), [gotoPages]);

  // The search box is sent to the server 300 ms after typing stops.
  useEffect(() => {
    const next = normalizeSearchTerm(term) || undefined;
    if (next === q) return;
    const id = window.setTimeout(() => {
      setQ(next);
      firstPages();
    }, 300);
    return () => window.clearTimeout(id);
  }, [term, q, firstPages]);

  const sfPend = useServerSortFilter(TABLE_KEYS.qcHistoryPending, () => gotoPages({ page: 1 }));
  const sfLogs = useServerSortFilter(TABLE_KEYS.qcHistoryEntries, () => gotoPages({ logPage: 1 }));

  const pendQuery: ListQcPendingQuery = {
    search: q,
    sf: sfPend.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(search.page),
  };
  const logsQuery: ListQcLogsQuery = {
    search: q,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    sf: sfLogs.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(search.logPage),
  };
  const pendQ = useQcPendingList(pendQuery);
  const logsQ = useQcLogsList(logsQuery);
  const statsQ = useQcHistoryStats();
  useClampPage(search.page, pendQ.data?.total, (p) => gotoPages({ page: p }));
  useClampPage(search.logPage, logsQ.data?.total, (p) => gotoPages({ logPage: p }));

  const pending = pendQ.data?.items ?? [];
  const logs = logsQ.data?.items ?? [];
  const pendTotal = pendQ.data?.total ?? 0;
  const logsTotal = logsQ.data?.total ?? 0;
  const isLoading = pendQ.isLoading || logsQ.isLoading;
  const isFetching = pendQ.isFetching || logsQ.isFetching || statsQ.isFetching;
  const error = pendQ.error ?? logsQ.error;
  const loaded = pendQ.data !== undefined && logsQ.data !== undefined;

  const showPend = tab === 'all' || tab === 'pending';
  const showComp = tab === 'all' || tab === 'completed';

  function clearFilters(): void {
    setTerm('');
    setQ(undefined);
    setDateFrom('');
    setDateTo('');
    setTab('all');
    sfPend.clearFilters();
    sfLogs.clearFilters();
    firstPages();
  }

  // Row counts per status over the searched / dated rows (server totals) —
  // the Status dropdown's option labels.
  const tabCount: Record<Tab, number> = {
    all: pendTotal + logsTotal,
    pending: pendTotal,
    completed: logsTotal,
  };
  const shownCount = (showPend ? pendTotal : 0) + (showComp ? logsTotal : 0);

  // Excel: EVERY row matching the filters, not just the page on screen.
  async function exportLogs(): Promise<void> {
    const rows = await fetchAllPages((limit, offset) =>
      fetchQcLogs({ ...logsQuery, limit, offset }),
    );
    exportCompletedQc(rows);
  }
  async function exportPending(): Promise<void> {
    const rows = await fetchAllPages((limit, offset) =>
      fetchQcPending({ ...pendQuery, limit, offset }),
    );
    exportPendingQc(rows);
  }

  return (
    <div>
      <ListHeader
        title="QC History"
        icon="📊"
        count={loaded ? shownCount : undefined}
        noun="row"
        filterNote={tab === 'all' ? undefined : TABS.find((tb) => tb.key === tab)?.label}
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search SO, JC, POL, item code, item name…"
        updating={isFetching && !isLoading}
        filters={
          <>
            <select
              className="innovic-select"
              aria-label="QC status"
              title="QC status"
              value={tab}
              onChange={(e) => setTab(e.target.value as Tab)}
            >
              {TABS.map((tb) => (
                <option key={tb.key} value={tb.key}>
                  {`${tb.label} (${tabCount[tb.key]})`}
                </option>
              ))}
            </select>
            <input
              type="date"
              className="innovic-input"
              title="QC Date From"
              aria-label="QC Date From"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                gotoPages({ logPage: 1 });
              }}
            />
            <input
              type="date"
              className="innovic-input"
              title="QC Date To"
              aria-label="QC Date To"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                gotoPages({ logPage: 1 });
              }}
            />
          </>
        }
        onClearFilters={clearFilters}
        filtersActive={
          tab !== 'all' ||
          term.trim() !== '' ||
          dateFrom !== '' ||
          dateTo !== '' ||
          sfPend.filtering ||
          sfLogs.filtering
        }
        tools={
          <ActionMenu
            label="⬇ Export"
            items={[
              {
                label: 'Completed Entries',
                disabled: logsTotal === 0,
                onClick: () => void exportLogs(),
              },
              {
                label: 'QC Pending',
                disabled: pendTotal === 0,
                onClick: () => void exportPending(),
              },
            ]}
          />
        }
      >
        {statsQ.data ? (
          /* Stats — legacy L23604-23609, one strip under the title (server figures). */
          <StatStrip
            items={[
              {
                key: 'overdue',
                label: 'Overdue (more than 1 day)',
                count: statsQ.data.overdue,
                color: 'var(--red2)',
              },
              {
                key: 'today',
                label: "Today's Entries",
                count: statsQ.data.today,
                color: 'var(--blue)',
              },
            ]}
          />
        ) : null}
      </ListHeader>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading QC history…
          </div>
        </div>
      ) : error || !loaded ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Could not load QC History. Try again.'}
          </div>
        </div>
      ) : (
        <>
          {showPend ? (
            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-hdr">
                <span className="panel-title" style={{ color: 'var(--amber2)' }}>
                  ⏳ QC Pending ({pendTotal})
                </span>
              </div>
              <DataTable
                tableKey={TABLE_KEYS.qcHistoryPending}
                columns={pendingColumns}
                rows={pending}
                rowKey={(o) => o.jcOpId}
                sortFilterServer={sfPend}
                rowClassName={(o) => (o.overdue ? 'qc-alert-blink' : undefined)}
                emptyText={
                  q || sfPend.filtering ? 'Nothing QC Pending matches.' : 'Nothing QC Pending.'
                }
                defaultPinned={QC_HISTORY_DEFAULT_PINNED}
                rowMenu={() => [
                  {
                    key: 'open-qc',
                    label: 'Open QC',
                    icon: 'search',
                    group: 'workflow',
                    to: '/qc-call-register',
                  },
                ]}
                renderLink={(p) => <Link {...p} />}
              />
              <ListFooter
                total={pendTotal}
                noun="pending op"
                page={search.page}
                pageSize={LIST_PAGE_SIZE}
                onPage={(p) => gotoPages({ page: p })}
              />
            </div>
          ) : null}

          {showComp ? (
            <div className="panel">
              <div className="panel-hdr">
                <span className="panel-title" style={{ color: 'var(--green2)' }}>
                  ✅ QC Entries ({logsTotal})
                </span>
              </div>
              <DataTable
                tableKey={TABLE_KEYS.qcHistoryEntries}
                columns={entryColumns}
                rows={logs}
                sortFilterServer={sfLogs}
                rowKey={(l) => l.logId}
                emptyText={
                  q || dateFrom || dateTo || sfLogs.filtering
                    ? 'No QC entries match.'
                    : 'No QC entries yet.'
                }
                defaultPinned={QC_HISTORY_DEFAULT_PINNED}
              />
              <ListFooter
                total={logsTotal}
                noun="QC entry"
                nounPlural="QC entries"
                page={search.logPage}
                pageSize={LIST_PAGE_SIZE}
                onPage={(p) => gotoPages({ logPage: p })}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
