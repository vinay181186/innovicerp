// Edit Approvals — ONE document type, on the uniform approval shell (ADR-202).
//
// The Approvals page draws one of these per enrolled document type (SO, GRN, Job
// Card, Delivery Challan, NC, JWSO, Plan, Production Order). It owns a single
// type's staged-edit queue, split Pending / Approved / Rejected by the shell's
// status filter, and feeds the shell:
//   • rows        — useDocumentEdits({ entity, status })
//   • view counts — useDocumentEditCounts (per-status, per entity)
//   • row ✓ / ✗   — approveRow approves ALL the request's still-pending changes,
//                    rejectRow rejects them all with one reason (bug 1 + bug 2
//                    instant-lock live in the shell).
//   • ▸ detail    — the before → after of every change, with per-field ✓ / ✗ for
//                    a multi-field edit so an approver can still split a request.
//
// Reuses the shipped look: .badge / .tag chip classes and tokens, no invented
// design.

import {
  type ActivityChangeValue,
  type DocumentEditChange,
  type DocumentEditEntity,
  type DocumentEditRow,
} from '@innovic/shared';
import { useMemo, useState } from 'react';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDateTime } from '@/lib/date';
import { Icon } from '@/ui/core';
import { type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { useDecideDocumentEdit, useDocumentEditCounts, useDocumentEdits } from '../api';
import { EditRejectDialog } from './edit-reject-dialog';
import {
  ApprovalTab,
  type ApprovalView,
} from '@/modules/approvals/components/approval-tab';

/** before / after value → readable text (already formatted by the API). */
function fmtVal(v: ActivityChangeValue): string {
  if (v === null || v === '') return '—';
  return String(v);
}

/** Changes on a request that have not yet been decided individually. */
function stillPending(r: DocumentEditRow): DocumentEditChange[] {
  const decided = new Set(r.decisions.map((d) => d.changeId));
  return r.changes.filter((c) => !decided.has(c.id));
}

function columns(): DataTableColumn<DocumentEditRow>[] {
  return [
    {
      id: 'doc_code',
      key: 'docCode',
      kind: 'code',
      header: 'Doc No.',
      className: 'mono fw-700',
      render: (r) => <span style={{ color: 'var(--blue)' }}>{r.docCode}</span>,
    },
    {
      id: 'requested_by',
      kind: 'text',
      header: 'Requested By',
      align: 'left',
      ellipsis: true,
      render: (r) => r.requestedByName,
      title: (r) => r.requestedByName,
    },
    {
      id: 'requested_at',
      kind: 'date',
      header: 'Requested At',
      render: (r) => <span className="mono">{fmtDateTime(r.requestedAt)}</span>,
    },
    {
      id: 'num_changes',
      kind: 'num',
      header: '# Changes',
      align: 'right',
      className: 'mono',
      render: (r) => r.changes.length,
    },
    {
      id: 'stale',
      kind: 'badge',
      header: 'Changed?',
      render: (r) =>
        r.isStale ? (
          <span className="badge b-amber" title="The document changed since this edit was asked">
            Changed
          </span>
        ) : (
          <span className="text3">—</span>
        ),
    },
  ];
}

export function EditApprovalTab({
  entity,
  tabs,
}: {
  /** The document type this queue is for (the active page tab). */
  entity: DocumentEditEntity;
  /** The Approvals page's fixed tab row, shown under the header. */
  tabs: React.ReactNode;
}): React.JSX.Element {
  const [view, setView] = useState<ApprovalView>('pending');
  const [term, setTerm] = useState('');
  // Which request rows are expanded (the fit engine's ▸ drives this through
  // onToggleExpanded). renderExpanded returns null for a collapsed row.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The one per-field change whose Reject reason dialog is open (expander split).
  const [rejectingChange, setRejectingChange] = useState<{
    requestId: string;
    change: DocumentEditChange;
    docCode: string;
  } | null>(null);
  // The one change currently being decided from the expander, so only its two
  // buttons go busy.
  const [decidingChangeId, setDecidingChangeId] = useState<string | null>(null);

  // The queue loads whole (few at a time) and search runs in the browser across
  // the columns on screen. A new entity tab remounts this (page.tsx keys it), so
  // the view resets to Pending.
  const list = useDocumentEdits({ entity, status: view });
  const decide = useDecideDocumentEdit();
  const counts = useDocumentEditCounts();

  const viewCounts = useMemo(() => {
    const c = counts.data?.counts.find((x) => x.entity === entity);
    return c ? { pending: c.pending, approved: c.approved, rejected: c.rejected } : undefined;
  }, [counts.data?.counts, entity]);

  const allRows = useMemo(() => list.data?.rows ?? [], [list.data?.rows]);
  const q = normalizeSearchTerm(term).toLowerCase();
  const rows = useMemo(() => {
    if (q === '') return allRows;
    return allRows.filter((r) =>
      [r.docCode, r.requestedByName, ...r.changes.map((c) => c.label)]
        .filter(Boolean)
        .some((s) => s.toLowerCase().includes(q)),
    );
  }, [allRows, q]);

  const cols = useMemo(() => columns(), []);

  /** Send ONE per-field decision immediately (expander split). */
  async function decideChange(
    requestId: string,
    changeId: string,
    decision: 'approve' | 'reject',
    reason?: string,
  ): Promise<void> {
    setDecidingChangeId(changeId);
    try {
      await decide.mutateAsync({
        id: requestId,
        decisions: [
          decision === 'reject'
            ? { changeId, decision: 'reject', reason }
            : { changeId, decision: 'approve' },
        ],
      });
    } finally {
      setDecidingChangeId(null);
    }
  }

  const toggleExpanded = (row: DocumentEditRow): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  };

  const renderExpanded = (row: DocumentEditRow): React.ReactNode => {
    if (!expanded.has(row.id)) return null;
    // Outcomes already recorded on this request (by an earlier ✓/✗, possibly by
    // someone else). A change with an outcome is read-only.
    const outcomeByChange = new Map(row.decisions.map((d) => [d.changeId, d]));
    const pendingHere = view === 'pending';
    return (
      <div style={{ padding: 'var(--sp-2) var(--sp-3)' }}>
        <table className="innovic-table tbl-compact tbl-ctr" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Field</th>
              <th style={{ textAlign: 'left' }}>Change</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {row.changes.map((c) => {
              const outcome = outcomeByChange.get(c.id);
              const busy = decidingChangeId === c.id && decide.isPending;
              return (
                <tr key={c.id}>
                  <td style={{ textAlign: 'left', fontWeight: 700 }}>{c.label}</td>
                  <td style={{ textAlign: 'left' }}>
                    <span className="text3">{fmtVal(c.before)}</span>
                    <span className="text3"> → </span>
                    <span className="tag b-amber">{fmtVal(c.after)}</span>
                  </td>
                  <td>
                    {outcome ? (
                      <DecisionOutcome
                        outcome={outcome.outcome}
                        reason={outcome.reason}
                        who={row.decidedByName}
                        when={row.decidedAt}
                      />
                    ) : pendingHere ? (
                      <div
                        style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="btn btn-sm btn-success"
                          title="Approve this field"
                          aria-label={`Approve ${c.label}`}
                          disabled={busy}
                          onClick={() => void decideChange(row.id, c.id, 'approve')}
                        >
                          <Icon name="check" size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          title="Reject this field"
                          aria-label={`Reject ${c.label}`}
                          disabled={busy}
                          onClick={() =>
                            setRejectingChange({ requestId: row.id, change: c, docCode: row.docCode })
                          }
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                    ) : (
                      <span className="text3">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <ApprovalTab<DocumentEditRow>
        tabs={tabs}
        title="Edit Approvals"
        noun="request"
        count={list.data ? rows.length : undefined}
        searchPlaceholder="Search doc no., requested by, field…"
        term={term}
        onSearch={setTerm}
        searching={term.trim() !== ''}
        updating={list.isFetching && !list.isLoading}
        view={view}
        onView={setView}
        viewCounts={viewCounts}
        filtersActive={view !== 'pending' || term.trim() !== ''}
        tableKey={TABLE_KEYS.editApprovalsInbox}
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        isError={list.isError}
        errorMessage={
          list.error instanceof Error ? list.error.message : 'Could not load edit requests.'
        }
        emptyPending="No edits waiting for approval."
        emptyDecided={view === 'approved' ? 'No approved edits yet.' : 'No rejected edits yet.'}
        emptyNoMatch="No edit requests match."
        renderExpanded={renderExpanded}
        onToggleExpanded={toggleExpanded}
        approveRow={async (r) => {
          await decide.mutateAsync({
            id: r.id,
            decisions: stillPending(r).map((c) => ({ changeId: c.id, decision: 'approve' as const })),
          });
        }}
        rejectRow={async (r, reason) => {
          await decide.mutateAsync({
            id: r.id,
            decisions: stillPending(r).map((c) => ({
              changeId: c.id,
              decision: 'reject' as const,
              reason,
            })),
          });
        }}
        rejectTitle={(r) => `Reject all changes — ${r.docCode}`}
        rejectPrompt="Why are these changes rejected?"
      />

      {rejectingChange ? (
        <EditRejectDialog
          docCode={rejectingChange.docCode}
          fieldLabel={rejectingChange.change.label}
          onCancel={() => setRejectingChange(null)}
          onReject={(reason) => {
            const target = rejectingChange;
            setRejectingChange(null);
            void decideChange(target.requestId, target.change.id, 'reject', reason);
          }}
        />
      ) : null}
    </>
  );
}

/** A change that has already been decided — read-only outcome + reason + who/when. */
function DecisionOutcome({
  outcome,
  reason,
  who,
  when,
}: {
  outcome: 'approved' | 'rejected' | 'superseded';
  reason: string | null;
  who: string | null;
  when: string | null;
}): React.JSX.Element {
  const meta = [who, when ? fmtDateTime(when) : null].filter(Boolean).join(' · ');
  if (outcome === 'approved') {
    return (
      <span className="badge b-green" title={meta || undefined}>
        <Icon name="check" size={12} /> Approved
      </span>
    );
  }
  if (outcome === 'rejected') {
    return (
      <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
        <span className="badge b-red" title={meta || undefined}>
          <Icon name="x" size={12} /> Rejected
        </span>
        {reason ? (
          <span className="text3" style={{ fontSize: 11 }}>
            “{reason}”
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="badge b-grey" title="The document changed before this was approved — not applied">
      Superseded
    </span>
  );
}
