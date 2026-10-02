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
import { useMemo, useState } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { useDecideOpLogTimeChange, useOpLogTimeChangeRequests } from '@/modules/op-entry/api';
import { DataTable, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListHeader, PageState } from '@/ui/layout';
import { approvalsKeys } from '../api';
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
  const list = useOpLogTimeChangeRequests({ status: sub, limit: 200 });
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
  const rows = list.data ?? [];
  // Waiting is a FIFO queue (oldest first). The history tabs read better with
  // the most recent decision on top. Client-side search over the cards loaded
  // (up to 200) — JC, item, operation, machine, reason and the people on each.
  const [term, setTerm] = useState('');
  const ordered = (sub === 'pending' ? rows : [...rows].reverse()).filter((r) =>
    matchesSearchTerm(
      [
        r.jobCardCode,
        r.itemCode,
        r.itemRevision,
        r.itemName,
        r.clientPoLineNo,
        r.operation,
        r.machineCode,
        r.reason,
        r.requestedByName,
        r.decidedByName,
      ],
      term,
    ),
  );

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
        count={list.data ? ordered.length : undefined}
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
        }}
        filtersActive={sub !== 'pending' || term.trim() !== ''}
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
              sortFilter={false}
              rowKey={(r) => r.id}
              loading={list.isLoading}
              empty={term ? 'No requests match.' : (active?.empty ?? 'Nothing here yet.')}
              defaultHidden={OP_ENTRY_DEFAULT_HIDDEN}
              rowClassName={opEntryRowTint}
              rowActions={(r) => <OpEntryRowActions r={r} p={actionProps} />}
            />
          </Panel>
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
