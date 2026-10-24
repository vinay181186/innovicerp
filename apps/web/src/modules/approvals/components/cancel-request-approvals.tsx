// Cancel Requests tab of Settings → Approvals (ADR-235), on the uniform
// approval shell (approval-tab.tsx) — the same header, Pending / Approved /
// Rejected filter, FIT table and visible row ✓ / ✗ as every other tab.
//
// The server lists only the requests the caller may decide (toDecide=true):
// a holder of the Approve tick on the document's page. ✓ approves — the
// document is Cancelled in one transaction on the server; ✗ asks for a reason
// (the shell's reject dialog) and leaves the document untouched.
//
// The list loads whole (up to the contract's 200 per call) so the search box
// matches every visible column in the browser; the queue of open cancel
// requests is short. If a view ever holds more, a note says so.

import {
  CANCEL_DOC_LABELS,
  type CancelDocType,
  type CancelRequestRow,
  type CancelRequestStatus,
} from '@innovic/shared';
import { useMemo, useState } from 'react';
import { ActionLink } from '@/components/shared/action-link';
import { matchesSearchTerm, normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDateTime } from '@/lib/date';
import { useDebounce } from '@/lib/use-debounce';
import { useCancelRequests, useDecideCancel } from '@/modules/cancel-requests/api';
import { linkProps } from '@/modules/dashboard/components/dash-text';
import type { DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ApprovalTab, type ApprovalView } from './approval-tab';

/** The contract's per-call cap (listCancelRequestsQuerySchema). */
const LOAD_LIMIT = 200;

/** Where each enrolled document opens. JW Invoice has no detail page — its
 *  list opens on the JW tab, searched to that invoice. */
function docHref(docType: CancelDocType, docId: string, docCode: string): string {
  if (docType === 'invoice') return `/invoices/${docId}`;
  if (docType === 'customer_dispatch') return `/customer-dispatches/${docId}`;
  return `/invoices?tab=jw&search=${encodeURIComponent(docCode)}`;
}

function cancelColumns(): DataTableColumn<CancelRequestRow>[] {
  return [
    {
      id: 'doc_code',
      kind: 'code',
      header: 'Doc No.',
      nowrap: true,
      className: 'mono fw-700',
      render: (r) => {
        const href = docHref(r.docType, r.docId, r.docCode);
        return (
          <span onClick={(e) => e.stopPropagation()}>
            <ActionLink {...linkProps(href)} check={href} fallback="text">
              {r.docCode}
            </ActionLink>
          </span>
        );
      },
      title: (r) => r.docCode,
      filterValue: (r) => r.docCode,
    },
    {
      id: 'doc_type',
      kind: 'text',
      header: 'Document',
      nowrap: true,
      render: (r) => CANCEL_DOC_LABELS[r.docType] ?? r.docType,
      filterValue: (r) => CANCEL_DOC_LABELS[r.docType] ?? r.docType,
    },
    {
      id: 'reason',
      kind: 'text',
      header: 'Cancel Reason',
      align: 'left',
      ellipsis: true,
      render: (r) => r.reason,
      title: (r) => r.reason,
    },
    {
      id: 'requested_by',
      kind: 'text',
      header: 'Requested By',
      align: 'left',
      ellipsis: true,
      render: (r) => r.requestedByName ?? '—',
      title: (r) => r.requestedByName ?? '',
    },
    {
      id: 'requested_at',
      kind: 'date',
      header: 'Requested At',
      nowrap: true,
      render: (r) => fmtDateTime(r.requestedAt),
      filterValue: (r) => r.requestedAt,
    },
    {
      id: 'decided_by',
      kind: 'text',
      header: 'Decided By',
      align: 'left',
      ellipsis: true,
      render: (r) => r.decidedByName ?? '—',
      title: (r) => r.decidedByName ?? '',
    },
    {
      id: 'decided_at',
      kind: 'date',
      header: 'Decided At',
      nowrap: true,
      render: (r) => fmtDateTime(r.decidedAt),
      filterValue: (r) => r.decidedAt,
    },
    {
      id: 'decision_note',
      kind: 'text',
      header: 'Reject Reason',
      align: 'left',
      ellipsis: true,
      render: (r) => r.decisionNote ?? '—',
      title: (r) => r.decisionNote ?? '',
    },
  ];
}

export function CancelRequestApprovals({
  tabs,
}: {
  /** The Approvals page's fixed tab row, shown under the header. */
  tabs?: React.ReactNode;
}): React.JSX.Element {
  const [view, setView] = useState<ApprovalView>('pending');
  const [term, setTerm] = useState('');
  const search = useDebounce(normalizeSearchTerm(term), 300);
  const list = useCancelRequests({
    status: view as CancelRequestStatus,
    toDecide: 'true',
    limit: LOAD_LIMIT,
    offset: 0,
  });
  const decide = useDecideCancel();
  const columns = useMemo(() => cancelColumns(), []);

  const all = useMemo(() => list.data?.items ?? [], [list.data?.items]);
  const rows = useMemo(
    () =>
      all.filter((r) =>
        matchesSearchTerm(
          [
            r.docCode,
            CANCEL_DOC_LABELS[r.docType],
            r.reason,
            r.requestedByName,
            fmtDateTime(r.requestedAt),
            r.decidedByName,
            fmtDateTime(r.decidedAt, ''),
            r.decisionNote,
          ],
          search,
        ),
      ),
    [all, search],
  );
  const total = list.data?.total ?? 0;
  const truncated = total > all.length;

  return (
    <ApprovalTab
      tabs={tabs}
      title="Cancel Requests"
      noun="request"
      count={list.data ? (search ? rows.length : total) : undefined}
      searchPlaceholder="Search doc no., document, reason, requested by…"
      term={term}
      onSearch={setTerm}
      searching={search !== ''}
      updating={list.isFetching && !list.isLoading}
      view={view}
      onView={setView}
      viewCounts={list.data ? { [view]: total } : undefined}
      filtersActive={view !== 'pending' || term.trim() !== ''}
      tableKey={TABLE_KEYS.approvalsCancel}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      loading={list.isLoading}
      isError={list.isError}
      errorMessage={
        list.error instanceof Error
          ? list.error.message
          : 'Could not load Cancel Requests. Try again.'
      }
      emptyPending="No Cancel Requests waiting for your approval."
      emptyDecided={
        view === 'approved'
          ? 'No approved Cancel Requests yet.'
          : 'No rejected Cancel Requests yet.'
      }
      emptyNoMatch="No Cancel Requests match."
      footer={
        truncated ? (
          <div className="text3" style={{ fontSize: 'var(--fs-xs)', margin: 'var(--sp-1) 0' }}>
            Showing the first {all.length} of {total} requests.
          </div>
        ) : null
      }
      approveRow={(r) => decide.mutateAsync({ id: r.id, decision: 'approve' })}
      rejectRow={(r, note) => decide.mutateAsync({ id: r.id, decision: 'reject', note })}
      rejectTitle={(r) => `Reject Cancel Request — ${r.docCode}`}
      rejectPrompt="Why is this Cancel Request rejected? The document stays as it is."
    />
  );
}
