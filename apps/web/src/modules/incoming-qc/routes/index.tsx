// Incoming QC (QC Wave 2). Ports legacy renderIncomingQC (HTML L23748):
// pipeline dashboard + pending-GRN inspection queue + recently-completed
// table. The ⋯ menu's Inspect opens the accept/reject form as a popup OVER
// this queue (IncomingQcInspectModal) — the same form the QC Call Register
// draws inline in its expanded row — so the inspector never leaves the list
// they are working through.
//
// ADR-203: Pending Inspection | Completed are TABS (tab in the URL) — one
// filled table on screen at a time, its column header frozen; the metrics strip
// and NC banner stay above as fixed chrome.
//
// ADR-199 table standard: both tables are the shared FIT table
// (<DataTable tableKey=…>), one line per GRN line, the fit engine sizing columns
// to the screen and dropping the rightmost unpinned ones into a ▸ detail row
// when it is too narrow. The row columns + ▸ detail live in two column modules
// so this file stays under the 400-line ceiling.
//
// ADR-201: both tables show 25 rows a page (Prev / Next, page in the URL), and
// the search and each table's Sort & Filter run on the SERVER over every line.
// The strip is the server's whole-queue metrics. The Inspect popup reads its
// one line on its own (grnLineId), so a ?line= deep link opens whatever page
// the line is on.

import { createRoute, Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Banner } from '@/ui/feedback/Banner';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
import { useIncomingQc } from '../api';
import { type IncomingRaisedNc } from '../components/incoming-qc-inspect-form';
import { IncomingQcInspectModal } from '../components/incoming-qc-inspect-modal';
import { IncomingQcMetricsStrip } from '../components/incoming-qc-metrics';
import {
  IncomingQcCompletedExpanded,
  incomingQcCompletedColumns,
} from '../components/incoming-qc-completed-columns';
import {
  IncomingQcPendingExpanded,
  incomingQcPendingColumns,
} from '../components/incoming-qc-pending-columns';

const searchSchema = z.object({
  // DEEP LINK: `?line=<grnLineId>` means "open the Inspect popup for this GRN
  // line" (the same param the QC Call Register accepts). It is consumed —
  // taken back out of the URL — the moment the popup opens, so a refresh or
  // Back is not a second request to open it.
  line: z.string().optional(),
  search: z.string().optional(),
  /** Pending Inspection page (1-based). */
  page: pageSearchParam,
  /** Completed QC page (1-based). */
  donePage: pageSearchParam,
  /** Active tab (ADR-203); absent = Pending Inspection. */
  tab: z.enum(['pending', 'done']).optional(),
});

export const incomingQcRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'incoming-qc',
  validateSearch: searchSchema,
  component: IncomingQcPage,
});

function IncomingQcPage(): React.JSX.Element {
  const { data: eff } = useMyAccess();
  const search = incomingQcRoute.useSearch();
  const navigate = incomingQcRoute.useNavigate();

  const gotoPending = useCallback(
    (p: number) => void navigate({ search: (s) => ({ ...s, page: p }), replace: true }),
    [navigate],
  );
  const gotoDone = useCallback(
    (p: number) => void navigate({ search: (s) => ({ ...s, donePage: p }), replace: true }),
    [navigate],
  );

  // Search box → ?search= (debounced); any change sends both tables to page 1.
  const [term, setTerm] = useState(search.search ?? '');
  useEffect(() => {
    setTerm((prev) =>
      normalizeSearchTerm(prev) === (search.search ?? '') ? prev : (search.search ?? ''),
    );
  }, [search.search]);
  useEffect(() => {
    const t = normalizeSearchTerm(term);
    const next = t === '' ? undefined : t;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({
        search: (s) => ({ ...s, search: next, page: 1, donePage: 1 }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [term, search.search, navigate]);

  // Sort & Filter on the SERVER per table (ADR-200); a change → that table's page 1.
  const sfPending = useServerSortFilter(TABLE_KEYS.incomingQcPending, () => gotoPending(1));
  const sfDone = useServerSortFilter(TABLE_KEYS.incomingQcDone, () => gotoDone(1));

  const { data, isLoading, isFetching, isError, error } = useIncomingQc({
    search: search.search,
    pendingLimit: LIST_PAGE_SIZE,
    pendingOffset: pageOffset(search.page),
    completedLimit: LIST_PAGE_SIZE,
    completedOffset: pageOffset(search.donePage),
    pendingSf: sfPending.param,
    completedSf: sfDone.param,
  });
  useClampPage(search.page, data?.pendingTotal, gotoPending);
  useClampPage(search.donePage, data?.completedTotal, gotoDone);

  // Which pending GRN line the Inspect popup is open on; null = closed. The
  // row is read on its own (whatever page it is on) and never from another
  // line's cached answer, so a refetch (the queue polls every 30s) cannot
  // leave the box on stale figures.
  const [inspectLineId, setInspectLineId] = useState<string | null>(null);
  const lineQuery = useIncomingQc(
    { grnLineId: inspectLineId ?? undefined, pendingLimit: 1, completedLimit: 1 },
    { enabled: inspectLineId !== null, keepPrevious: false },
  );
  // The NC the last reject raised — named with a link to its disposition,
  // the same banner the QC Call Register shows (incoming-qc-inspect#1).
  const [raisedNc, setRaisedNc] = useState<IncomingRaisedNc | null>(null);
  const linePending = lineQuery.data?.pending;
  const inspectRow =
    inspectLineId && linePending?.[0]?.grnLineId === inspectLineId ? linePending[0] : null;

  // DEEP LINK — open the popup for the line, once per id; the param is
  // stripped (replace, so Back does not step through it). A line that is not
  // waiting (already inspected elsewhere) closes again once its read says so.
  const autoOpenedLineRef = useRef<string | null>(null);
  useEffect(() => {
    const line = search.line;
    if (!line || autoOpenedLineRef.current === line) return;
    autoOpenedLineRef.current = line;
    setInspectLineId(line);
    void navigate({ search: (prev) => ({ ...prev, line: undefined }), replace: true });
  }, [search.line, navigate]);

  // The line is no longer pending — fully inspected elsewhere, or the GRN was
  // changed — so there is nothing left to inspect: close rather than keep a
  // form up for a line that no longer needs one.
  useEffect(() => {
    if (inspectLineId && linePending && linePending.length === 0) setInspectLineId(null);
  }, [inspectLineId, linePending]);

  const pendingRows = data?.pending ?? [];
  const completedRows = data?.completed ?? [];
  const pendingTotal = data?.pendingTotal ?? 0;
  const completedTotal = data?.completedTotal ?? 0;
  const filtering = (search.search ?? '') !== '';
  const tab = search.tab ?? 'pending';
  const setTab = (t: string): void =>
    void navigate({
      search: (s) => ({ ...s, tab: t === 'done' ? 'done' : undefined }),
      replace: true,
    });

  // ▸ expand: the caller owns the open set; the fit table's ▸ is the row's one
  // expand control (onToggleExpanded), and renderExpanded returns null for a
  // collapsed row.
  const [pendingOpen, setPendingOpen] = useState<Set<string>>(new Set());
  const [completedOpen, setCompletedOpen] = useState<Set<string>>(new Set());
  const togglePending = useCallback((id: string) => toggle(setPendingOpen, id), []);
  const toggleCompleted = useCallback((id: string) => toggle(setCompletedOpen, id), []);

  const pendingCols = incomingQcPendingColumns();
  const completedCols = incomingQcCompletedColumns();

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !effectiveFormPerms(eff, 'qc_incoming').view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Incoming QC. Ask an admin.
      </div>
    );
  }

  return (
    // `page-fill` (ADR-202/203): title, search, metrics strip, NC banner and the
    // tabs are fixed chrome; the active tab's ONE table fills the rest and is the
    // only thing that scrolls, so its column header never leaves the screen.
    <div className="page-fill">
      <ListHeader
        title="Incoming QC"
        icon="🔬"
        count={data ? pendingTotal : undefined}
        noun="pending line"
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search GRN, PO, vendor, POL, item code, item name…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          sfPending.clearFilters();
          sfDone.clearFilters();
          setTerm('');
        }}
        filtersActive={term !== '' || sfPending.filtering || sfDone.filtering}
      >
        {/* Pipeline dashboard — one strip, the whole queue */}
        {data ? <IncomingQcMetricsStrip m={data.metrics} /> : null}
      </ListHeader>

      {raisedNc ? (
        <Banner
          tone="warn"
          accent
          onDismiss={() => setRaisedNc(null)}
          title={
            <>
              NC{' '}
              <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                {raisedNc.code}
              </span>{' '}
              raised —{' '}
              <Link to="/nc-register/$id" params={{ id: raisedNc.id }}>
                Dispose now →
              </Link>
            </>
          }
        >
          The rejected qty from the Incoming QC just saved is on this NC until it is disposed.
        </Banner>
      ) : null}

      {inspectRow ? (
        <IncomingQcInspectModal
          key={inspectRow.grnLineId}
          o={inspectRow}
          onClose={() => setInspectLineId(null)}
          onNcRaised={setRaisedNc}
        />
      ) : null}

      <TabStrip
        label="Incoming QC"
        tabs={[
          { key: 'pending', label: 'Pending Inspection', count: data ? pendingTotal : null },
          { key: 'done', label: 'Completed', count: data ? completedTotal : null },
        ]}
        activeKey={tab}
        onChange={setTab}
      />

      {isError || (!data && !isLoading) ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load Incoming QC. Try again.'
          }
        />
      ) : tab === 'pending' ? (
        <>
          <Panel fill bodyPadding="none">
            <DataTable
              tableKey={TABLE_KEYS.incomingQcPending}
              columns={pendingCols}
              rows={pendingRows}
              rowKey={(r) => r.grnLineId}
              loading={isLoading}
              sortFilterServer={sfPending}
              emptyText={
                filtering || sfPending.filtering
                  ? 'No GRN lines match.'
                  : 'No GRN lines waiting for QC.'
              }
              // Row click opens the GRN doc; Inspect (⋯) opens the accept/reject
              // popup over the queue.
              onRowClick={(r) =>
                void navigate({ to: '/goods-receipt-notes/$id', params: { id: r.grnId } })
              }
              renderExpanded={(r) =>
                pendingOpen.has(r.grnLineId) ? <IncomingQcPendingExpanded r={r} /> : null
              }
              onToggleExpanded={(r) => togglePending(r.grnLineId)}
              rowMenu={(r) => [
                {
                  key: 'inspect',
                  label: 'Inspect',
                  icon: 'check',
                  group: 'workflow',
                  onSelect: () => setInspectLineId(r.grnLineId),
                },
              ]}
            />
          </Panel>
          <ListFooter
            total={pendingTotal}
            noun="pending line"
            page={search.page}
            pageSize={LIST_PAGE_SIZE}
            onPage={gotoPending}
          />
        </>
      ) : (
        <>
          <Panel fill bodyPadding="none">
            <DataTable
              tableKey={TABLE_KEYS.incomingQcDone}
              columns={completedCols}
              rows={completedRows}
              rowKey={(r) => r.grnLineId}
              loading={isLoading}
              sortFilterServer={sfDone}
              emptyText={
                filtering || sfDone.filtering
                  ? 'No completed inspections match.'
                  : 'No completed inspections yet.'
              }
              onRowClick={(r) =>
                void navigate({ to: '/goods-receipt-notes/$id', params: { id: r.grnId } })
              }
              // Row tint by the real QC result (disposition): accepted green,
              // partial amber, rejected red.
              rowClassName={(r) => ROW_TINT_BY_DISP[r.disposition]}
              renderExpanded={(r) =>
                completedOpen.has(r.grnLineId) ? <IncomingQcCompletedExpanded r={r} /> : null
              }
              onToggleExpanded={(r) => toggleCompleted(r.grnLineId)}
            />
          </Panel>
          <ListFooter
            total={completedTotal}
            noun="completed line"
            page={search.donePage}
            pageSize={LIST_PAGE_SIZE}
            onPage={gotoDone}
          />
        </>
      )}
    </div>
  );
}

// Completed QC result → row tint (ADR-199 ROW_TINT). Real disposition enum only.
const ROW_TINT_BY_DISP: Record<string, string> = {
  Accepted: ROW_TINT.done,
  'Partial Accept': ROW_TINT.pending,
  Rejected: ROW_TINT.late,
};

function toggle(set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string): void {
  set((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}
