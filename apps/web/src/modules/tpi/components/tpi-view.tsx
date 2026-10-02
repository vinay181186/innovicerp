// TPI — Third Party Inspection (legacy renderTPI L21381). Pending TPI ops with
// an inline TPI entry form (PendingTpi, tpi-pending-card.tsx) + completed TPI
// records table. The submit reuses op-entry submitQcLog with isTpi + tpi
// metadata (op_log, migration 0037). Legacy chrome.
//
// Renders both as its own route AND as the "🔍 TPI" tab on QC Call Register,
// so all state here is local (no URL params). Pass `title` when it IS the page.
//
// ADR-201: each list shows 25 per page and loads only that page; the search
// runs on the SERVER over every call / record and sends both lists back to
// page 1; the counts are server totals; the Excel export fetches EVERY record
// matching the search.

import type { ListTpiQuery } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE, fetchAllPages, pageOffset, useClampPage } from '@/lib/list-paging';
import { DataTable } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader } from '@/ui/layout';
import { fetchTpiCompleted, useTpiCompletedList, useTpiPendingList } from '../api';
import { exportTpiRecords } from '../lib/export';
import { TPI_COMPLETED_DEFAULT_PINNED, tpiCompletedColumns } from './tpi-completed-columns';
import { PendingTpi } from './tpi-pending-card';

// Legacy L21472 / L21477 hand-roll the two panel strips rather than using
// .panel-hdr / .panel-title (13px bold on --bg4, 10/14 padding) — mirrored.
const STRIP: React.CSSProperties = {
  padding: '10px 14px',
  background: 'var(--bg4)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

export function TpiView(props: { title?: string }): React.JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);
  const completedColumns = useMemo(() => tpiCompletedColumns(), []);

  // Search over every text column the two lists show (JC, SO, POL, item code /
  // name, operation, inspector, organisation, certificate) — on the server,
  // 300 ms after typing stops; both lists go back to page 1.
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [pendPage, setPendPage] = useState(1);
  const [compPage, setCompPage] = useState(1);
  useEffect(() => {
    const next = normalizeSearchTerm(term);
    if (next === q) return;
    const id = window.setTimeout(() => {
      setQ(next);
      setPendPage(1);
      setCompPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [term, q]);

  const search = q || undefined;
  const pendQ = useTpiPendingList({
    search,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(pendPage),
  });
  const compQuery: ListTpiQuery = { search, limit: LIST_PAGE_SIZE, offset: pageOffset(compPage) };
  const compQ = useTpiCompletedList(compQuery);
  useClampPage(pendPage, pendQ.data?.total, setPendPage);
  useClampPage(compPage, compQ.data?.total, setCompPage);

  const pending = pendQ.data?.items ?? [];
  const completed = compQ.data?.items ?? [];
  const pendTotal = pendQ.data?.total ?? 0;
  const compTotal = compQ.data?.total ?? 0;
  const isLoading = pendQ.isLoading || compQ.isLoading;
  const isFetching = pendQ.isFetching || compQ.isFetching;
  const error = pendQ.error ?? compQ.error;
  const loaded = pendQ.data !== undefined && compQ.data !== undefined;

  // Excel: EVERY completed record matching the search, not just this page.
  const onExport = useCallback(async (): Promise<void> => {
    const rows = await fetchAllPages((limit, offset) =>
      fetchTpiCompleted({ search, limit, offset }),
    );
    await exportTpiRecords(rows);
  }, [search]);

  return (
    <div>
      <ListHeader
        title={props.title ?? 'TPI'}
        icon="🔍"
        count={loaded ? pendTotal : undefined}
        noun="pending TPI call"
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search JC, SO, POL, item, operation, inspector, certificate…"
        updating={isFetching && !isLoading}
        tools={
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title="Export every completed TPI record matching the search to Excel"
            disabled={compTotal === 0}
            onClick={() => void onExport()}
          >
            ⬇ Export
          </button>
        }
      />

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading TPI…
          </div>
        </div>
      ) : error || !loaded ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Could not load TPI. Try again.'}
          </div>
        </div>
      ) : (
        <>
          <div className="panel" style={{ marginBottom: 16 }}>
            <div style={STRIP}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>
                <span style={{ color: 'var(--amber2)' }}>⏳</span> Pending TPI ({pendTotal})
              </span>
            </div>
            <div style={{ padding: 10 }}>
              {pending.length === 0 ? (
                <div className="empty-state" style={{ padding: 20, color: 'var(--green2)' }}>
                  {q ? 'No pending TPI calls match.' : '✅ No pending TPI calls'}
                </div>
              ) : (
                pending.map((o) => (
                  <PendingTpi
                    key={o.jcOpId}
                    o={o}
                    open={openId === o.jcOpId}
                    onToggle={() => setOpenId(openId === o.jcOpId ? null : o.jcOpId)}
                    onDone={() => setOpenId(null)}
                  />
                ))
              )}
            </div>
            <ListFooter
              total={pendTotal}
              noun="pending TPI call"
              page={pendPage}
              pageSize={LIST_PAGE_SIZE}
              onPage={setPendPage}
            />
          </div>

          <div className="panel">
            <div style={STRIP}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>
                <span style={{ color: 'var(--green2)' }}>✅</span> Completed TPI ({compTotal})
              </span>
            </div>
            <DataTable
              tableKey={TABLE_KEYS.tpiCompleted}
              columns={completedColumns}
              rows={completed}
              sortFilter={false}
              rowKey={(l) => l.logId}
              emptyText={q ? 'No TPI records match.' : 'No TPI records yet.'}
              defaultPinned={TPI_COMPLETED_DEFAULT_PINNED}
            />
            <ListFooter
              total={compTotal}
              noun="TPI record"
              page={compPage}
              pageSize={LIST_PAGE_SIZE}
              onPage={setCompPage}
            />
          </div>
        </>
      )}
    </div>
  );
}
