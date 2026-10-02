// Edit Approvals inbox (ADR-202) — the 4th tab of Settings → Approvals.
//
// Lists the staged edits waiting for a decision. Each row expands (the fit
// engine's ▸) to its per-change rows: field label · before → after · ✓ approve
// · ✗ reject. The approver ticks every change, then "Submit decisions" sends
// them all at once (per-change approve/reject — design 1A). A reject needs a
// reason, captured in the shared reject dialog (modelled on Op Entry's).
//
// On the shipped table standard: ListHeader (search) + Panel(bodyPadding="none")
// + DataTable(tableKey). Reuses .tag / .badge chip classes and tokens — no
// invented design.

import {
  type ActivityChangeValue,
  type DocumentEditChange,
  type DocumentEditRow,
} from '@innovic/shared';
import { useMemo, useState } from 'react';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDateTime } from '@/lib/date';
import { type DataTableColumn, DataTable, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListHeader, PageState } from '@/ui/layout';
import { useDecideDocumentEdit, useDocumentEdits } from '../api';
import { EditRejectDialog } from './edit-reject-dialog';

/** One change's decision as the approver sets it in the expanded row. */
type ChangeDecision = { decision: 'approve' | 'reject'; reason?: string };

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
      header: 'Doc Code',
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
      header: 'Stale',
      render: (r) =>
        r.isStale ? (
          <span className="badge b-amber" title="The document changed since this edit was asked">
            Stale
          </span>
        ) : (
          <span className="text3">—</span>
        ),
    },
  ];
}

export function EditApprovalsInbox(): React.JSX.Element {
  // Pending edits load whole (few at a time) and search runs in the browser
  // across the columns on screen — the universal-search rule for a list that
  // is not server-paged.
  const list = useDocumentEdits({ status: 'pending' });
  const decide = useDecideDocumentEdit();

  const [term, setTerm] = useState('');
  // Which request rows are expanded (the fit engine's ▸ drives this through
  // onToggleExpanded). renderExpanded returns null for a collapsed row.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The per-change decisions the approver is building, keyed by request id then
  // change id. Cleared for a request once it is submitted.
  const [picks, setPicks] = useState<Record<string, Record<string, ChangeDecision>>>({});
  // The change whose Reject reason dialog is open.
  const [rejecting, setRejecting] = useState<{
    requestId: string;
    change: DocumentEditChange;
    docCode: string;
  } | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

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

  function setPick(requestId: string, changeId: string, dec: ChangeDecision): void {
    setPicks((prev) => ({
      ...prev,
      [requestId]: { ...(prev[requestId] ?? {}), [changeId]: dec },
    }));
  }

  async function submit(row: DocumentEditRow): Promise<void> {
    const chosen = picks[row.id] ?? {};
    const decisions = row.changes.map((c) => {
      const d = chosen[c.id];
      return d?.decision === 'reject'
        ? { changeId: c.id, decision: 'reject' as const, reason: d.reason }
        : { changeId: c.id, decision: 'approve' as const };
    });
    setSubmittingId(row.id);
    try {
      await decide.mutateAsync({ id: row.id, decisions });
      setPicks((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
    } finally {
      setSubmittingId(null);
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
    const chosen = picks[row.id] ?? {};
    const allDecided = row.changes.every((c) => chosen[c.id] != null);
    const busy = submittingId === row.id && decide.isPending;
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
              const d = chosen[c.id];
              return (
                <tr key={c.id}>
                  <td style={{ textAlign: 'left', fontWeight: 700 }}>{c.label}</td>
                  <td style={{ textAlign: 'left' }}>
                    <span className="text3">{fmtVal(c.before)}</span>
                    <span className="text3"> → </span>
                    <span className="tag b-amber">{fmtVal(c.after)}</span>
                  </td>
                  <td>
                    <div
                      style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className={`btn btn-sm ${d?.decision === 'approve' ? 'btn-success' : 'btn-ghost'}`}
                        disabled={busy}
                        onClick={() => setPick(row.id, c.id, { decision: 'approve' })}
                      >
                        ✓ Approve
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${d?.decision === 'reject' ? 'btn-danger' : 'btn-ghost'}`}
                        disabled={busy}
                        onClick={() =>
                          setRejecting({ requestId: row.id, change: c, docCode: row.docCode })
                        }
                      >
                        ✗ Reject
                      </button>
                      {d?.decision === 'reject' && d.reason ? (
                        <span className="text3" style={{ fontSize: 11, alignSelf: 'center' }}>
                          “{d.reason}”
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--sp-2)',
            marginTop: 'var(--sp-2)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {decide.isError && submittingId === null ? (
            <span style={{ color: 'var(--red2)', fontSize: 12, alignSelf: 'center' }}>
              {decide.error.message}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!allDecided || busy}
            title={allDecided ? undefined : 'Decide every change first'}
            onClick={() => void submit(row)}
          >
            {busy ? 'Submitting…' : 'Submit decisions'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div>
      <ListHeader
        title="Edit Approvals"
        icon="✅"
        count={list.data ? rows.length : undefined}
        noun="request"
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search doc code, requested by, field…"
        updating={list.isFetching && !list.isLoading}
        onClearFilters={() => setTerm('')}
        filtersActive={term.trim() !== ''}
      />

      {list.isError ? (
        <PageState
          state="error"
          message={
            list.error instanceof Error ? list.error.message : 'Could not load edit requests.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.editApprovalsInbox}
            columns={cols}
            rows={rows}
            rowKey={(r) => r.id}
            loading={list.isLoading}
            empty={
              term.trim() !== ''
                ? 'No edit requests match.'
                : 'No edits are waiting for approval.'
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
            setPick(rejecting.requestId, rejecting.change.id, { decision: 'reject', reason });
            setRejecting(null);
          }}
        />
      ) : null}
    </div>
  );
}
