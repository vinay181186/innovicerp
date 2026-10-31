// ADR-265 — THE list of everything waiting for my approval, decided in place.
// Used by the home Approvals view AND Settings → Approvals (Show: Waiting), so
// both read the same query and show the same rows.
//
//   direct rows (PO, Route Card (New), Op Entry time change, Cancel Request,
//   Day Log edit) — ✓ / ✗ on the row, tickable for "✓ Approve N";
//   review rows (document / master changes) — "Review (n)" opens the side
//   panel with ✓ / ✗ per field.
//
// The list holds every waiting row (≤ WAITING_APPROVALS_LIMIT), so search and
// the Approval Type filter run in the browser over the rows on screen.

import { type WaitingApprovalRow } from '@innovic/shared';
import { type ReactNode, useMemo, useState } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { fmtDate } from '@/lib/date';
import { DataTable, type DataTableColumn, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListHeader, PageState } from '@/ui/layout';
import { useWaitingApprovals } from '../api';
import { approvalKey, useDecideApproval } from '../use-decide-approval';
import '../approvals.css';
import { ApprovalDocLink } from './approval-doc-link';
import { ApprovalRejectDialog } from './approval-reject-dialog';
import { ApprovalRowActions } from './approval-row-actions';
import { ALL_TYPES, ApprovalTypeSelect, effectiveType } from './approval-type-select';
import { ReviewPanel } from './review-panel';

const EMPTY: WaitingApprovalRow[] = [];

const COLUMNS: DataTableColumn<WaitingApprovalRow>[] = [
  {
    id: 'approval_type',
    header: 'Approval Type',
    kind: 'text',
    nowrap: true,
    className: 'text2',
    filterValue: (r) => r.typeLabel,
    render: (r) => r.typeLabel,
  },
  {
    id: 'document',
    header: 'Document',
    kind: 'code',
    stopRowClick: true,
    filterValue: (r) => r.docCode,
    render: (r) => <ApprovalDocLink code={r.docCode} href={r.docHref} />,
  },
  {
    id: 'request',
    header: 'Request',
    kind: 'text',
    ellipsis: true,
    title: (r) => r.request,
    filterValue: (r) => r.request,
    render: (r) => r.request,
  },
  {
    id: 'item_code',
    header: 'Item Code',
    kind: 'code',
    filterValue: (r) => r.itemCode,
    title: (r) => r.itemName ?? '',
    render: (r) => (r.itemCode ? <span className="apv-code">{r.itemCode}</span> : '—'),
  },
  {
    id: 'raised_by',
    header: 'Raised By',
    kind: 'text',
    ellipsis: true,
    title: (r) => r.raisedByName ?? '',
    filterValue: (r) => r.raisedByName,
    render: (r) => r.raisedByName ?? '—',
  },
  {
    id: 'raised_on',
    header: 'Raised On',
    kind: 'date',
    filterValue: (r) => r.raisedAt,
    render: (r) => fmtDate(r.raisedAt),
  },
];

/** Rows "✓ Approve N" may take: whole-document decisions, but never a Cancel
 *  Request — approving one cancels the document and reverses its stock
 *  (ADR-235), so each is approved on its own row. */
const isBulkable = (r: WaitingApprovalRow): boolean => r.mode === 'direct' && r.kind !== 'cancel';

export function ApprovalsList({
  showSelect,
  onClearExtra,
  extraActive = false,
  sticky = true,
}: {
  /** Settings → Approvals: the Show select, placed before Approval Type. */
  showSelect?: ReactNode;
  /** Clear also resets what the page owns (Show → Waiting). */
  onClearExtra?: () => void;
  extraActive?: boolean;
  sticky?: boolean;
}): React.JSX.Element {
  const waiting = useWaitingApprovals();
  const all = waiting.data?.rows ?? EMPTY;
  const counts = waiting.data?.counts ?? [];
  const [pickedType, setPickedType] = useState(ALL_TYPES);
  const [term, setTerm] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<WaitingApprovalRow | null>(null);
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const actions = useDecideApproval(all);

  const type = effectiveType(pickedType, counts);
  const rows = useMemo(
    () =>
      all.filter(
        (r) =>
          (type === ALL_TYPES || r.typeKey === type) &&
          matchesSearchTerm([r.docCode, r.request, r.itemCode, r.raisedByName], term),
      ),
    [all, type, term],
  );
  // A selection only ever holds direct rows still on screen.
  const selectable = new Set(rows.filter(isBulkable).map(approvalKey));
  const selectedKeys = new Set([...sel].filter((k) => selectable.has(k)));
  // The Review panel follows the live row; it closes once the row is decided.
  const reviewing = reviewKey ? all.find((r) => approvalKey(r) === reviewKey) : undefined;

  const approve = (list: WaitingApprovalRow[]): void => {
    const keys = new Set(list.map(approvalKey));
    setSel((prev) => new Set([...prev].filter((k) => !keys.has(k))));
    void actions.approve(list);
  };

  const filtersActive = extraActive || type !== ALL_TYPES || term.trim() !== '';
  const typeLabel = counts.find((c) => c.typeKey === type)?.typeLabel;

  return (
    <div className="page-fill">
      <ListHeader
        title="Approvals"
        icon="✅"
        count={waiting.data?.total}
        noun="waiting for me"
        nounPlural="waiting for me"
        filterNote={typeLabel}
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search document, request, item code, raised by…"
        updating={waiting.isFetching && !waiting.isLoading}
        sticky={sticky}
        filters={
          <>
            {showSelect}
            <ApprovalTypeSelect
              value={type}
              counts={counts}
              total={waiting.data?.total ?? 0}
              onChange={setPickedType}
            />
          </>
        }
        onClearFilters={() => {
          setPickedType(ALL_TYPES);
          setTerm('');
          onClearExtra?.();
        }}
        filtersActive={filtersActive}
      />

      {waiting.isError ? (
        <PageState
          state="error"
          message={
            waiting.error instanceof Error
              ? waiting.error.message
              : 'Could not load the approvals waiting for you.'
          }
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.approvalsWaiting}
            columns={COLUMNS}
            rows={rows}
            rowKey={approvalKey}
            loading={waiting.isLoading}
            emptyText={
              term.trim() !== '' || type !== ALL_TYPES
                ? 'No waiting approvals match.'
                : 'Nothing waiting for your approval.'
            }
            selectable
            isRowSelectable={isBulkable}
            selectedKeys={selectedKeys}
            onToggleRow={(k, _row, next) =>
              setSel((prev) => {
                const out = new Set(prev);
                if (next) out.add(String(k));
                else out.delete(String(k));
                return out;
              })
            }
            onToggleAll={(next, keys) => setSel(next ? new Set(keys.map(String)) : new Set())}
            selectionActions={(list) => {
              const direct = list.filter(isBulkable);
              return (
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  disabled={direct.length === 0}
                  onClick={() => approve(direct)}
                >
                  ✓ Approve {direct.length}
                </button>
              );
            }}
            rowActions={(r) =>
              r.mode === 'review' ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setReviewKey(approvalKey(r));
                  }}
                >
                  Review ({r.changes.length})
                </button>
              ) : (
                <ApprovalRowActions
                  busy={actions.busy.has(approvalKey(r))}
                  onApprove={() => approve([r])}
                  onReject={() => setRejecting(r)}
                />
              )
            }
          />
        </Panel>
      )}

      {rejecting ? (
        <ApprovalRejectDialog
          title={`Reject — ${rejecting.docCode}`}
          prompt="Why is this rejected?"
          onCancel={() => setRejecting(null)}
          onReject={(reason) => {
            const r = rejecting;
            setRejecting(null);
            void actions.reject(r, reason);
          }}
        />
      ) : null}
      {reviewing ? (
        <ReviewPanel
          row={reviewing}
          onClose={() => setReviewKey(null)}
          decideChanges={actions.decideChanges}
        />
      ) : null}
    </div>
  );
}
