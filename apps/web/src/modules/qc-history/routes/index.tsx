// QC History & Tracking (QC Wave 2). Ports legacy renderQCHistory (HTML
// L23531): 2 KPI tiles + SO/JC/Item + date filters + Excel export, then the
// QC Pending | QC Entries tabs (ADR-203) — one filled table at a time, its
// column header frozen. The tab lives in the URL (`tab`). Read-only.
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
import { DataTable, Panel, StatStrip } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ActionMenu, ListFooter, ListHeader } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
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
  validateSearch: z.object({
    page: pageSearchParam,
    logPage: pageSearchParam,
    /** Active tab (ADR-203); absent = QC Pending. */
    tab: z.enum(['pending', 'entries']).optional(),
  }),
  component: QcHistoryPage,
});

type Tab = 'pending' | 'entries';

function QcHistoryPage(): React.JSX.Element {
  const search = qcHistoryRoute.useSearch();
  const navigate = qcHistoryRoute.useNavigate();
  const tab: Tab = search.tab ?? 'pending';
  const setTab = (t: string): void =>
    void navigate({
      search: (prev) => ({ ...prev, tab: t === 'entries' ? 'entries' : undefined }),
      replace: true,
    });
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

  function clearFilters(): void {
    setTerm('');
    setQ(undefined);
    setDateFrom('');
    setDateTo('');
    sfPend.clearFilters();
    sfLogs.clearFilters();
    firstPages();
  }

  // Tab counts = the two lists' server totals over the searched / dated rows
  // (both lists load whichever tab is open, so both counts are always live).
  const shownCount = tab === 'pending' ? pendTotal : logsTotal;

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
    // `page-fill` (ADR-202/203): title, filters, KPI strip and tabs are fixed
    // chrome; the active tab's ONE table fills the rest and is the only thing
    // that scrolls, so its column header never leaves the screen.
    <div className="page-fill">
      <ListHeader
        title="QC History"
        icon="📊"
        count={loaded ? shownCount : undefined}
        noun="row"
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search SO, JC, POL, item code, item name…"
        updating={isFetching && !isLoading}
        filters={
          <>
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

      <TabStrip
        label="QC History"
        tabs={[
          { key: 'pending', label: 'QC Pending', count: loaded ? pendTotal : null },
          { key: 'entries', label: 'QC Entries', count: loaded ? logsTotal : null },
        ]}
        activeKey={tab}
        onChange={setTab}
      />

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
      ) : tab === 'pending' ? (
        <>
          <Panel fill bodyPadding="none">
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
          </Panel>
          <ListFooter
            total={pendTotal}
            noun="pending op"
            page={search.page}
            pageSize={LIST_PAGE_SIZE}
            onPage={(p) => gotoPages({ page: p })}
          />
        </>
      ) : (
        <>
          <Panel fill bodyPadding="none">
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
          </Panel>
          <ListFooter
            total={logsTotal}
            noun="QC entry"
            nounPlural="QC entries"
            page={search.logPage}
            pageSize={LIST_PAGE_SIZE}
            onPage={(p) => gotoPages({ logPage: p })}
          />
        </>
      )}
    </div>
  );
}
