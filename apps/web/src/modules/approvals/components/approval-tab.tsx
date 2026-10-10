// The ONE uniform shell for every tab of Settings → Approvals (PR, PO, SO, GRN,
// Job Card, Delivery Challan, NC, JWSO, Plan, Production Order, Op Entry).
//
// Every tab — whatever its data source — renders through this one component, so
// they all look and behave the same:
//   ListHeader(search) + an always-visible Pending / Approved / Rejected filter
//   (a select whose option labels carry the counts) + Panel + DataTable + a
//   VISIBLE row Action ✓ / ✗ (Pending view only) + a ▸ read-only detail.
//
// Two owner-reported bugs are fixed HERE, once, for every tab:
//   1. The ✓ / ✗ were hidden in the row expander. They are now a dedicated,
//      always-visible Action column on each pending row (DataTable `rowActions`).
//   2. A row only re-locked when the background refetch landed, so it looked like
//      you could tick twice. The row now locks the INSTANT you click (optimistic:
//      the Action cell shows "deciding…" and both buttons go away). It stays
//      locked until the refetch drops the decided row from the list — and on
//      error it unlocks and the message is shown. See `runDecide` + the prune
//      effect below.
//
// The shell owns all of the action machinery (the locked set, the reject-reason
// dialog, the error line). Each tab is a thin adapter that supplies its rows,
// columns and the two async calls: `approveRow` and `rejectRow`.

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Icon } from '@/ui/core';
import { type DataTableColumn, DataTable, Panel } from '@/ui/data';
import type { ServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { ListHeader, PageState } from '@/ui/layout';
import { ApprovalRejectDialog } from './approval-reject-dialog';

/** The three views every approval tab is split into — default Pending. */
export type ApprovalView = 'pending' | 'approved' | 'rejected';

export const APPROVAL_VIEWS: Array<{ key: ApprovalView; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

/** The visible ✓ / ✗ for one pending row (bug 1). While that row is being
 *  decided it shows "deciding…" and no buttons (bug 2 — instant lock). */
function ApprovalRowActions({
  busy,
  onApprove,
  onReject,
}: {
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}): React.JSX.Element {
  if (busy) {
    return (
      <span className="text3" style={{ fontSize: 'var(--fs-xs)', fontStyle: 'italic' }}>
        deciding…
      </span>
    );
  }
  return (
    // The Action cell already stops the row click (DataTable), but a pending row
    // may still navigate on click, so guard here too.
    <div
      style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="btn btn-sm btn-success"
        title="Approve"
        aria-label="Approve"
        onClick={onApprove}
      >
        <Icon name="check" size={14} />
      </button>
      <button
        type="button"
        className="btn btn-sm btn-danger"
        title="Reject"
        aria-label="Reject"
        onClick={onReject}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

export interface ApprovalTabProps<T> {
  /** The fixed tab row, rendered under the header on every tab. */
  tabs: ReactNode;
  /** Page title for this tab, e.g. "PR Approvals". */
  title: string;
  searchPlaceholder: string;
  /** Count shown on the header count line (records in the current view). */
  count?: number | undefined;
  /** Singular noun for the count line, e.g. "request", "order". */
  noun: string;

  /* ---- search (adapter-owned state) ---- */
  term: string;
  onSearch: (v: string) => void;
  /** True while a search term is active — picks the "no match" empty text. */
  searching: boolean;
  updating?: boolean | undefined;

  /* ---- Pending / Approved / Rejected filter ---- */
  view: ApprovalView;
  onView: (v: ApprovalView) => void;
  /** Count per view for the option labels; omit a view to show it without one. */
  viewCounts?: Partial<Record<ApprovalView, number>> | undefined;
  /** Reset anything the adapter owns beyond view + term (e.g. Sort & Filter). */
  onClearExtra?: (() => void) | undefined;
  /** Enables the Clear button. */
  filtersActive: boolean;

  /* ---- table ---- */
  tableKey: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  loading: boolean;
  isError: boolean;
  errorMessage?: string | undefined;
  emptyPending: string;
  emptyDecided: string;
  emptyNoMatch: string;
  sortFilterServer?: ServerSortFilter | undefined;
  defaultHidden?: string[] | undefined;
  rowClassName?: ((r: T, i: number) => string | undefined) | undefined;
  renderExpanded?: ((r: T) => ReactNode) | undefined;
  onToggleExpanded?: ((r: T) => void) | undefined;
  onRowClick?: ((r: T) => void) | undefined;
  /** Footer (ListFooter) for server-paged tabs; omit for whole-list tabs. */
  footer?: ReactNode | undefined;

  /* ---- actions (Pending view only) ---- */
  /** Approve this row. For an edit request this approves ALL its pending
   *  changes. Resolve to reconcile; reject the Promise to unlock + show the msg. */
  approveRow?: ((r: T) => Promise<unknown>) | undefined;
  /** Reject this row with the typed reason. For an edit request this rejects
   *  ALL its pending changes with the one reason. */
  rejectRow?: ((r: T, reason: string) => Promise<unknown>) | undefined;
  /** Hide the ✓ / ✗ on a row the caller cannot act on. Default: all pending. */
  canAct?: ((r: T) => boolean) | undefined;
  /** Title for the reject-reason dialog, given the row. */
  rejectTitle?: ((r: T) => string) | undefined;
  rejectPrompt?: string | undefined;
}

export function ApprovalTab<T>(props: ApprovalTabProps<T>): React.JSX.Element {
  const {
    tabs,
    title,
    searchPlaceholder,
    count,
    noun,
    term,
    onSearch,
    searching,
    updating,
    view,
    onView,
    viewCounts,
    onClearExtra,
    filtersActive,
    tableKey,
    columns,
    rows,
    rowKey,
    loading,
    isError,
    errorMessage,
    emptyPending,
    emptyDecided,
    emptyNoMatch,
    sortFilterServer,
    defaultHidden,
    rowClassName,
    renderExpanded,
    onToggleExpanded,
    onRowClick,
    footer,
    approveRow,
    rejectRow,
    canAct,
    rejectTitle,
    rejectPrompt,
  } = props;

  // The rows currently locked after a ✓ / ✗ click (bug 2). A row stays here
  // until the refetch drops it from `rows`, so you cannot tick it twice.
  const [deciding, setDeciding] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  // The row whose Reject reason dialog is open.
  const [rejecting, setRejecting] = useState<T | null>(null);

  // Reconcile the locked set with the live rows: a row that is gone (its
  // decision landed and the list refetched) is unlocked automatically; a row
  // that is back after an error was already unlocked in the catch below.
  useEffect(() => {
    setDeciding((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(rows.map(rowKey));
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (present.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows, rowKey]);

  async function runDecide(r: T, fn: () => Promise<unknown>): Promise<void> {
    const k = rowKey(r);
    setActionError(null);
    setDeciding((prev) => new Set(prev).add(k)); // INSTANT lock, before the call
    try {
      await fn();
      // Leave it locked: the refetch removes the decided row and the prune
      // effect above clears the key. This closes the double-tick window.
    } catch (e) {
      setDeciding((prev) => {
        const next = new Set(prev);
        next.delete(k);
        return next;
      });
      setActionError(e instanceof Error ? e.message : 'Could not record the decision.');
    }
  }

  const showActions = view === 'pending' && approveRow != null && rejectRow != null;
  const rowActions = showActions
    ? (r: T): ReactNode => {
        if (canAct && !canAct(r)) return null;
        const busy = deciding.has(rowKey(r));
        return (
          <ApprovalRowActions
            busy={busy}
            onApprove={() => void runDecide(r, () => approveRow(r))}
            onReject={() => {
              setActionError(null);
              setRejecting(r);
            }}
          />
        );
      }
    : undefined;

  const empty = searching
    ? emptyNoMatch
    : view === 'pending'
      ? emptyPending
      : emptyDecided;

  return (
    <div className="page-fill">
      <ListHeader
        title={title}
        icon="✅"
        count={count}
        noun={noun}
        filterNote={APPROVAL_VIEWS.find((v) => v.key === view)?.label}
        search={term}
        onSearch={onSearch}
        searchPlaceholder={searchPlaceholder}
        updating={updating ?? false}
        filters={
          <select
            className="innovic-select"
            aria-label="Request status"
            title="Request status"
            value={view}
            onChange={(e) => {
              onView(e.target.value as ApprovalView);
              setRejecting(null);
            }}
          >
            {APPROVAL_VIEWS.map((v) => {
              const n = viewCounts?.[v.key];
              return (
                <option key={v.key} value={v.key}>
                  {n != null ? `${v.label} (${n})` : v.label}
                </option>
              );
            })}
          </select>
        }
        onClearFilters={() => {
          onView('pending');
          onSearch('');
          onClearExtra?.();
          setRejecting(null);
        }}
        filtersActive={filtersActive}
      >
        {tabs}
      </ListHeader>

      {isError ? (
        <PageState state="error" message={errorMessage ?? 'Could not load this list.'} />
      ) : (
        <>
          {actionError ? (
            <div style={{ color: 'var(--red2)', fontSize: 12, margin: 'var(--sp-1) 0' }}>
              {actionError}
            </div>
          ) : null}
          <Panel fill bodyPadding="none">
            <DataTable
              tableKey={tableKey}
              columns={columns}
              rows={rows}
              rowKey={rowKey}
              loading={loading}
              empty={empty}
              {...(sortFilterServer ? { sortFilterServer } : {})}
              {...(defaultHidden ? { defaultHidden } : {})}
              {...(rowClassName ? { rowClassName } : {})}
              {...(renderExpanded ? { renderExpanded: (r: T) => renderExpanded(r) } : {})}
              {...(onToggleExpanded ? { onToggleExpanded: (r: T) => onToggleExpanded(r) } : {})}
              {...(onRowClick ? { onRowClick: (r: T) => onRowClick(r) } : {})}
              {...(rowActions ? { rowActions: (r: T) => rowActions(r) } : {})}
            />
          </Panel>
          {footer}
        </>
      )}

      {rejecting ? (
        <ApprovalRejectDialog
          title={rejectTitle ? rejectTitle(rejecting) : 'Reject'}
          prompt={rejectPrompt}
          confirmLabel="Reject"
          onCancel={() => setRejecting(null)}
          onReject={(reason) => {
            const r = rejecting;
            setRejecting(null);
            if (rejectRow) void runDecide(r, () => rejectRow(r, reason));
          }}
        />
      ) : null}
    </div>
  );
}
