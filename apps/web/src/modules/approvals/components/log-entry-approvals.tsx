// Op Entry tab of Settings → Approvals (ADR-130), on the uniform approval shell.
//
// Date/time corrections on op entries. Split Pending / Approved / Rejected by the
// shell's status filter so a decision does not vanish the moment it is made — the
// row keeps its full trail (who decided, when, and the reject reason). While a
// request sits in Pending the entry is UNTOUCHED: the shop floor, the JC feed and
// every report still read the original values, so nothing here can move a
// production number until someone presses ✓.
//
// Qty is shown but is never part of the ask: op_log's qty columns are frozen by a
// DB trigger (ADR-127), so a correction cannot smuggle one in.
//
// Columns + the ▸ context live in ./op-entry-approvals-columns (the four context
// columns are hidden by default and revealed under the row's ▸). The visible row
// ✓ / ✗ and the reject-reason dialog are the shell's, so this tab looks and
// behaves exactly like PR, PO and the edit tabs.

import { type OpLogChangeStatus, opSrNo } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { useDebounce } from '@/lib/use-debounce';
import { useDecideOpLogTimeChange } from '@/modules/op-entry/api';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter } from '@/ui/layout';
import { approvalsKeys, useOpLogTimeChangePage } from '../api';
import {
  ApprovalTab,
  type ApprovalView,
} from './approval-tab';
import {
  OP_ENTRY_DEFAULT_HIDDEN,
  opEntryColumns,
  opEntryRowTint,
} from './op-entry-approvals-columns';

export function LogEntryApprovals({
  pendingCount,
  tabs,
}: {
  /** Waiting-queue size, shown on the Pending option and the tab badge. */
  pendingCount?: number | undefined;
  /** The Approvals page's fixed tab row, shown under the header. */
  tabs?: React.ReactNode;
}): React.JSX.Element {
  const [view, setView] = useState<ApprovalView>('pending');
  // 25 requests a page (ADR-201). A tab without its own route, so the page is
  // component state. Search and Sort & Filter run on the server over every
  // request; any change of them, or of Status, goes back to page 1.
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const search = useDebounce(normalizeSearchTerm(term), 300);
  const sf = useServerSortFilter(TABLE_KEYS.approvalsOpEntry, () => setPage(1));
  const lastFilters = useRef(`${view}|${search}`);
  useEffect(() => {
    const key = `${view}|${search}`;
    if (lastFilters.current === key) return;
    lastFilters.current = key;
    setPage(1);
  }, [view, search]);
  // Waiting is a FIFO queue (oldest first); the decided views come newest first
  // — the server orders them.
  const list = useOpLogTimeChangePage({
    status: view as OpLogChangeStatus,
    ...(search ? { search } : {}),
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  const total = list.data?.total ?? 0;
  useClampPage(page, list.data?.total, setPage);
  const decide = useDecideOpLogTimeChange();
  // A decision also shrinks the Approvals inbox (its Op Entry count and the nav
  // badge), which is a separate query.
  const qc = useQueryClient();
  const refreshInbox = (): void => {
    void qc.invalidateQueries({ queryKey: approvalsKeys.inbox() });
  };

  const rows = useMemo(() => list.data?.items ?? [], [list.data?.items]);
  const columns = useMemo(() => opEntryColumns(), []);

  // Only the pending count is known without loading the other lists; the active
  // decided view shows its loaded total.
  const viewCounts: Partial<Record<ApprovalView, number>> = {};
  if (pendingCount != null) viewCounts.pending = pendingCount;
  if (view !== 'pending' && list.data) viewCounts[view] = total;

  return (
    <ApprovalTab
      tabs={tabs}
      title="Op Entry Approvals"
      noun="request"
      count={list.data ? total : undefined}
      searchPlaceholder="Search JC, item, operation, machine, reason, person…"
      term={term}
      onSearch={setTerm}
      searching={search !== '' || sf.filtering}
      updating={list.isFetching && !list.isLoading}
      view={view}
      onView={setView}
      viewCounts={viewCounts}
      onClearExtra={() => sf.clearFilters()}
      filtersActive={view !== 'pending' || term.trim() !== '' || sf.filtering}
      tableKey={TABLE_KEYS.approvalsOpEntry}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      loading={list.isLoading}
      isError={list.isError}
      errorMessage={
        list.error instanceof Error ? list.error.message : 'Could not load requests. Try again.'
      }
      emptyPending="Nothing pending approval."
      emptyDecided={view === 'approved' ? 'No approved corrections yet.' : 'No rejected corrections yet.'}
      emptyNoMatch="No requests match."
      sortFilterServer={sf}
      defaultHidden={OP_ENTRY_DEFAULT_HIDDEN}
      rowClassName={opEntryRowTint}
      footer={
        <ListFooter
          total={total}
          noun="request"
          page={page}
          pageSize={LIST_PAGE_SIZE}
          onPage={setPage}
        />
      }
      approveRow={async (r) => {
        await decide.mutateAsync({ id: r.id, decision: 'approve' });
        refreshInbox();
      }}
      rejectRow={async (r, reason) => {
        await decide.mutateAsync({ id: r.id, decision: 'reject', decisionReason: reason });
        refreshInbox();
      }}
      rejectTitle={(r) => `Reject correction — ${r.jobCardCode} Op ${opSrNo(r.opSeq)}`}
      rejectPrompt="Why is this rejected?"
    />
  );
}
