// Edit Approvals — ONE document type (ADR-202).
//
// The Approvals page draws one of these per document type that has edits
// waiting (page.tsx builds the tab row from GET /document-edits/counts). This
// component owns a single type's queue, split Pending / Approved / Rejected by a
// Status dropdown — mirroring the Op Entry tab — so a decision does not vanish
// the instant it is made; the decided tabs keep the full trail.
//
// Per-change, immediate (design 1A): each ✓ / ✗ sends ONE decision straight
// away (useDecideDocumentEdit), no "Submit decisions" step. ✓ approves; ✗ opens
// the reason dialog, then rejects. A change already decided shows its outcome
// read-only. The server (service.ts) resolves only the named change and leaves
// the rest of the request pending, so a row can be decided a change at a time.
//
// On the shipped table standard: ListHeader (search) + Panel(bodyPadding="none")
// + DataTable(tableKey). Reuses .badge / .tag chip classes and tokens — no
// invented design.

import {
  type ActivityChangeValue,
  type DocumentEditChange,
  type DocumentEditEntity,
  type DocumentEditRow,
  type DocumentEditStatus,
} from '@innovic/shared';
import { useMemo, useState } from 'react';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDateTime } from '@/lib/date';
import { Icon } from '@/ui/core';
import { type DataTableColumn, DataTable, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListHeader, PageState } from '@/ui/layout';
import { useDecideDocumentEdit, useDocumentEdits } from '../api';
import { EditRejectDialog } from './edit-reject-dialog';

/** The three views a document type's queue is split into. Keeps the decided
 *  trail on screen (Pending / Approved / Rejected), like the Op Entry tab. */
const SUB_TABS: Array<{ key: DocumentEditStatus; label: string; empty: string }> = [
  { key: 'pending', label: 'Pending', empty: 'No edits waiting for approval.' },
  { key: 'approved', label: 'Approved', empty: 'No approved edits yet.' },
  { key: 'rejected', label: 'Rejected', empty: 'No rejected edits yet.' },
];

/** before / after value → readable text (already formatted by the API). */
function fmtVal(v: ActivityChangeValue): string {
  if (v === null || v === '') return '—';
  return String(v);
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

export function DocTypeApprovals({
  entity,
  tabs,
}: {
  /** The document type this queue is for (the active page tab). */
  entity: DocumentEditEntity;
  /** The Approvals page's per-document tab row, shown under the header. */
  tabs: React.ReactNode;
}): React.JSX.Element {
  const [sub, setSub] = useState<DocumentEditStatus>('pending');
  // The queue loads whole (few at a time) and search runs in the browser across
  // the columns on screen — the universal-search rule for a list that is not
  // server-paged. A new entity tab remounts this (page.tsx keys it), so the view
  // resets to Pending.
  const list = useDocumentEdits({ entity, status: sub });
  const decide = useDecideDocumentEdit();

  const [term, setTerm] = useState('');
  // Which request rows are expanded (the fit engine's ▸ drives this through
  // onToggleExpanded). renderExpanded returns null for a collapsed row.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The change whose Reject reason dialog is open.
  const [rejecting, setRejecting] = useState<{
    requestId: string;
    change: DocumentEditChange;
    docCode: string;
  } | null>(null);
  // The one change currently being decided, so only its two buttons go busy.
  const [decidingChangeId, setDecidingChangeId] = useState<string | null>(null);

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
  const active = SUB_TABS.find((t) => t.key === sub);

  /** Send ONE decision immediately (per-change, 1A). No Submit step. */
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
                    ) : (
                      <div
                        style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="btn btn-sm btn-success"
                          title="Approve"
                          aria-label={`Approve ${c.label}`}
                          disabled={busy}
                          onClick={() => void decideChange(row.id, c.id, 'approve')}
                        >
                          <Icon name="check" size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          title="Reject"
                          aria-label={`Reject ${c.label}`}
                          disabled={busy}
                          onClick={() =>
                            setRejecting({ requestId: row.id, change: c, docCode: row.docCode })
                          }
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {decide.isError ? (
          <div style={{ color: 'var(--red2)', fontSize: 12, marginTop: 'var(--sp-1)' }}>
            {decide.error.message}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="page-fill">
      <ListHeader
        title="Edit Approvals"
        icon="✅"
        count={list.data ? rows.length : undefined}
        noun="request"
        filterNote={active?.label}
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search doc no., requested by, field…"
        updating={list.isFetching && !list.isLoading}
        filters={
          <select
            className="innovic-select"
            aria-label="Request status"
            title="Request status"
            value={sub}
            onChange={(e) => {
              setSub(e.target.value as DocumentEditStatus);
              setRejecting(null);
            }}
          >
            {SUB_TABS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
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
      >
        {tabs}
      </ListHeader>

      {list.isError ? (
        <PageState
          state="error"
          message={
            list.error instanceof Error ? list.error.message : 'Could not load edit requests.'
          }
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.editApprovalsInbox}
            columns={cols}
            rows={rows}
            rowKey={(r) => r.id}
            loading={list.isLoading}
            empty={
              term.trim() !== ''
                ? 'No edit requests match.'
                : (active?.empty ?? 'Nothing here yet.')
            }
            renderExpanded={renderExpanded}
            onToggleExpanded={(row) => toggleExpanded(row)}
          />
        </Panel>
      )}

      {rejecting ? (
        <EditRejectDialog
          docCode={rejecting.docCode}
          fieldLabel={rejecting.change.label}
          onCancel={() => setRejecting(null)}
          onReject={(reason) => {
            const target = rejecting;
            setRejecting(null);
            void decideChange(target.requestId, target.change.id, 'reject', reason);
          }}
        />
      ) : null}
    </div>
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
