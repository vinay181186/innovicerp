// JW Return register — returns machined goods to the customer against a Job
// Work Order line (ADR-079), on the shared FIT DataTable (ADR-199, table
// standard 2026-10-01). The table always fits its width (no sideways scroll):
// the rightmost columns drop into the ▸ detail row when the screen is narrow.
//
// Columns (first pinned = Return No.): Return No. · Return Date · JWSO ·
// Customer · Item Code · Item Name · Return Qty · Return Status. The ▸ detail
// row reveals Transporter and Vehicle No. JW Return has no detail page, so the
// row is NOT clickable; per-row ⋯ carries History / Print / Cancel. The qty
// guard stays server-side (qty <= produced − already returned).
//
// Split for the 400-line ceiling: the columns live in jw-returns-columns.tsx,
// the create modal in new-jw-return-modal.tsx.

import { type JwReturnChallanListItem, type ListJwReturnChallansQuery } from '@innovic/shared';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DocumentHistory } from '@/components/shared/document-history';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { useSession } from '@/lib/session';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Modal } from '@/ui/feedback';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useJwReturnsList } from '../api';
import { CancelJwReturnModal } from './cancel-jw-return-modal';
import { jwReturnColumns } from './jw-returns-columns';
import { NewJwReturnModal } from './new-jw-return-modal';
import { usePrintJwReturn } from './use-print-jw-return';

// ADR-201: 25 returns a page with Prev / Next (the page lives in this tab's
// state — the tab has no route of its own). The search box and the column ▾
// Sort & Filter run on the server over the whole book; any change of them
// goes back to page 1.

// `initialSearch` — one-time seed from the host route's ?search param (Global
// Search deep link). It fills the box AND the debounced term, so the first fetch
// already carries it; typing afterwards is local and never touches the URL.
export function JwDispatchView({
  initialSearch,
}: {
  initialSearch?: string | undefined;
}): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const [searchInput, setSearchInput] = useState(() => initialSearch ?? '');
  const [term, setTerm] = useState(() => normalizeSearchTerm(initialSearch ?? ''));
  const [showModal, setShowModal] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  IN-JR  26 " and "IN-JR 26" are one query, one cache entry, one fetch.
    const next = normalizeSearchTerm(searchInput);
    if (next === term) return;
    const id = window.setTimeout(() => {
      setTerm(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, term]);
  const sf = useServerSortFilter(TABLE_KEYS.jwReturns, () => setPage(1));

  // The term goes to the SERVER now. It used to filter the downloaded rows in
  // the browser, which only ever searched the capped page the endpoint had
  // sent — past the cap the box quietly hid matching returns. A new term is a
  // new query key, so it refetches from page 1. Only the page on screen loads.
  const query: ListJwReturnChallansQuery = useMemo(
    () => ({
      ...(term ? { search: term } : {}),
      ...(sf.param ? { sf: sf.param } : {}),
      limit: LIST_PAGE_SIZE,
      offset: pageOffset(page),
    }),
    [term, sf.param, page],
  );

  const { data, isLoading, isFetching, isError, error } = useJwReturnsList(query);
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const onPage = useCallback((p: number) => setPage(p), []);
  useClampPage(page, data?.total, onPage);

  // The return the Cancel dialog is asking about, or null when closed. The
  // dialog captures a reason (R10, ADR-194) and runs the mutation itself.
  const [cancelTarget, setCancelTarget] = useState<{ id: string; code: string } | null>(null);
  // ADR-197: the return whose History is open, or null. JW Return has no
  // detail page, so its History opens over the list.
  const [historyTarget, setHistoryTarget] = useState<{ id: string; code: string } | null>(null);
  // ⋯ Print — the row's old Print challan button's logic, as a hook.
  const printReturn = usePrintJwReturn();

  const columns = useMemo(() => jwReturnColumns(), []);

  const toggleExpand = useCallback((id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div>
      <ListHeader
        title="JW Return"
        icon="📦"
        count={total}
        noun="JW return"
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search return no., date, JWSO, customer, item, transport, status…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          sf.clearFilters();
          setSearchInput('');
        }}
        filtersActive={sf.filtering || searchInput !== ''}
        primary={
          canWrite ? (
            <button type="button" className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={14} /> New Return
            </button>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load JW returns. Try again.'}
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.jwReturns}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={isLoading}
            sortFilterServer={sf}
            empty={term || sf.filtering ? 'No JW Returns match.' : 'No JW Returns yet.'}
            // A cancelled return is washed; an issued one is the live state and
            // stays untinted.
            rowClassName={(r) => (r.status === 'cancelled' ? ROW_TINT.cancelled : undefined)}
            // The fit table's ▸ is the row's one expand control: it reveals the
            // transporter and vehicle for that return.
            renderExpanded={(r) => (expanded.has(r.id) ? <ExpandedReturn row={r} /> : null)}
            onToggleExpanded={(r) => toggleExpand(r.id)}
            rowActionsWidth="1%"
            // ⋯ Print · History · ─ · Cancel. A cancelled return offers no
            // Print; its Cancel is greyed.
            rowMenu={(r: JwReturnChallanListItem) => [
              {
                key: 'print',
                label: 'Print challan',
                icon: 'printer',
                hidden: r.status === 'cancelled',
                onSelect: () => printReturn(r),
              },
              {
                key: 'history',
                label: 'History',
                icon: 'activity',
                onSelect: () => setHistoryTarget({ id: r.id, code: r.code }),
              },
              {
                key: 'cancel',
                label: 'Cancel Return',
                icon: 'x',
                group: 'danger',
                hidden: !canWrite,
                disabledReason: r.status === 'cancelled' ? 'Already Cancelled' : undefined,
                onSelect: () => setCancelTarget({ id: r.id, code: r.code }),
              },
            ]}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="JW return"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={onPage}
      />

      {historyTarget ? (
        <Modal
          title={`History — ${historyTarget.code}`}
          onClose={() => setHistoryTarget(null)}
          size="lg"
        >
          <DocumentHistory
            entity="JwReturnChallan"
            entityId={historyTarget.id}
            refId={historyTarget.code}
          />
        </Modal>
      ) : null}
      {cancelTarget ? (
        <CancelJwReturnModal
          id={cancelTarget.id}
          code={cancelTarget.code}
          onClose={() => setCancelTarget(null)}
        />
      ) : null}
      {showModal ? <NewJwReturnModal onClose={() => setShowModal(false)} /> : null}
    </div>
  );
}

/** Transporter + Vehicle No. for one return, under an opened ▸ row. These two
 *  columns moved off the always-fits table into the detail reveal. */
function ExpandedReturn({ row }: { row: JwReturnChallanListItem }): React.JSX.Element {
  return (
    <div
      className="text3"
      style={{
        fontSize: 'var(--fs-xs)',
        padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)',
      }}
    >
      <b>Transporter:</b> {row.transport ?? '—'} &nbsp;·&nbsp; <b>Vehicle No.:</b>{' '}
      <span className="mono">{row.vehicleNo ?? '—'}</span>
    </div>
  );
}
