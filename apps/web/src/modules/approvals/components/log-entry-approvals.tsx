// Op Entry tab of Settings → Approvals (ADR-130).
//
// Date/time corrections on op entries. Split by a Status dropdown in the filter
// bar (Pending / Approved / Rejected) so a decision does not vanish the moment
// it is made — the row keeps its full trail (who decided, when, and the reject
// reason). While a request sits in Waiting the entry is UNTOUCHED: the shop
// floor, the JC feed and every report still read the original values, so nothing
// here can move a production number until someone presses Approve.
//
// Qty is shown but is never part of the ask: op_log's qty columns are frozen by
// a DB trigger (ADR-127), so a correction cannot smuggle one in.
//
// ADR-199: the old card grid is now the shared fit table (DataTable + tableKey).
// Columns + row actions live in ./op-entry-approvals-columns; Reject opens the
// reason popup in ./op-entry-reject-dialog (a reject reason is a dialog, not an
// inline cell).

import { type OpLogChangeStatus, type OpLogTimeChangeRequest } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { useDebounce } from '@/lib/use-debounce';
import { useDecideOpLogTimeChange } from '@/modules/op-entry/api';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { approvalsKeys, useOpLogTimeChangePage } from '../api';
import {
  OP_ENTRY_DEFAULT_HIDDEN,
  OpEntryRowActions,
  opEntryColumns,
  opEntryRowTint,
  type OpEntryActionProps,
} from './op-entry-approvals-columns';
import { OpEntryRejectDialog } from './op-entry-reject-dialog';

const SUB_TABS: Array<{ key: OpLogChangeStatus; label: string; empty: string }> = [
  { key: 'pending', label: 'Pending', empty: 'Nothing pending approval.' },
  { key: 'approved', label: 'Approved', empty: 'No approved corrections yet.' },
  { key: 'rejected', label: 'Rejected', empty: 'No rejected corrections yet.' },
];

export function LogEntryApprovals({
  pendingCount,
  tabs,
}: {
  /** Waiting-queue size, shown as a badge beside the tabs. */
  pendingCount?: number | undefined;
  /** The Approvals inbox's PR · PO · Op Entry switch, shown under the header. */
  tabs?: React.ReactNode;
}): React.JSX.Element {
  const [sub, setSub] = useState<OpLogChangeStatus>('pending');
  // 25 requests a page (ADR-201). A tab without its own route, so the page is
  // component state. Search and Sort & Filter run on the server over every
  // request; any change of them, or of Status, goes back to page 1.
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const search = useDebounce(normalizeSearchTerm(term), 300);
  const sf = useServerSortFilter(TABLE_KEYS.approvalsOpEntry, () => setPage(1));
  const lastFilters = useRef(`${sub}|${search}`);
  useEffect(() => {
    const key = `${sub}|${search}`;
    if (lastFilters.current === key) return;
    lastFilters.current = key;
    setPage(1);
  }, [sub, search]);
  // Waiting is a FIFO queue (oldest first); the decided tabs come newest first
  // — the server orders them.
  const list = useOpLogTimeChangePage({
    status: sub,
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
  // The request whose Reject reason popup is open (ADR-199 — reason is a dialog).
  const [rejecting, setRejecting] = useState<OpLogTimeChangeRequest | null>(null);

  const active = SUB_TABS.find((t) => t.key === sub);
  const ordered = list.data?.items ?? [];

  const columns = useMemo(() => opEntryColumns(), []);
  const actionProps: OpEntryActionProps = {
    busy: decide.isPending,
    // The Promise keeps the row's ⋯ busy; a failure is swallowed here because
    // decide.isError already shows it in the red line above the table.
    onApprove: (r) =>
      decide.mutateAsync({ id: r.id, decision: 'approve' }).then(refreshInbox, () => undefined),
    onReject: (r) => setRejecting(r),
  };

  return (
    <div>
      <ListHeader
        title="Op Entry Approvals"
        icon="✅"
        count={list.data ? total : undefined}
        noun="request"
        filterNote={active?.label}
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search JC, item, operation, machine, reason, person…"
        updating={list.isFetching && !list.isLoading}
        filters={
          /* Status: Pending / Approved / Rejected (were sub-tab buttons). Only
             the waiting count is known without loading the other lists. */
          <select
            className="innovic-select"
            aria-label="Request status"
            title="Request status"
            value={sub}
            onChange={(e) => {
              setSub(e.target.value as OpLogChangeStatus);
              setRejecting(null);
            }}
          >
            {SUB_TABS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.key === 'pending' && pendingCount != null
                  ? `${t.label} (${pendingCount})`
                  : t.label}
              </option>
            ))}
          </select>
        }
        onClearFilters={() => {
          setSub('pending');
          setRejecting(null);
          setTerm('');
          sf.clearFilters();
        }}
        filtersActive={sub !== 'pending' || term.trim() !== '' || sf.filtering}
        tools={
          pendingCount ? (
            <span className="badge b-amber" title="Waiting for a decision">
              {pendingCount} waiting
            </span>
          ) : null
        }
      >
        {tabs}
      </ListHeader>

      {list.isError ? (
        <PageState
          state="error"
          message={
            list.error instanceof Error ? list.error.message : 'Could not load requests. Try again.'
          }
        />
      ) : (
        <>
          {decide.isError ? (
            <div style={{ color: 'var(--red2)', fontSize: 12, marginBottom: 8 }}>
              {decide.error.message}
            </div>
          ) : null}
          <Panel bodyPadding="none">
            <DataTable
              tableKey={TABLE_KEYS.approvalsOpEntry}
              columns={columns}
              rows={ordered}
              sortFilterServer={sf}
              rowKey={(r) => r.id}
              loading={list.isLoading}
              empty={
                search || sf.filtering
                  ? 'No requests match.'
                  : (active?.empty ?? 'Nothing here yet.')
              }
              defaultHidden={OP_ENTRY_DEFAULT_HIDDEN}
              rowClassName={opEntryRowTint}
              rowActions={(r) => <OpEntryRowActions r={r} p={actionProps} />}
            />
          </Panel>
          <ListFooter
            total={total}
            noun="request"
            page={page}
            pageSize={LIST_PAGE_SIZE}
            onPage={setPage}
          />
        </>
      )}

      {rejecting ? (
        <OpEntryRejectDialog
          req={rejecting}
          busy={decide.isPending}
          onCancel={() => setRejecting(null)}
          onReject={(reason) =>
            decide.mutate(
              { id: rejecting.id, decision: 'reject', decisionReason: reason },
              {
                onSuccess: () => {
                  refreshInbox();
                  setRejecting(null);
                },
              },
            )
          }
        />
      ) : null}
    </div>
  );
}
