// ADR-265 — the Review side panel: the changes asked on one document, decided
// here (no jump to another page). ✓ / ✗ per field sends just that change;
// Approve all sends every remaining change in one call; Reject all asks the
// reason once. All go to POST /document-edits/:id/decide. A refusal (409:
// superseded, already decided …) shows the server's words in the panel.

import type { DocumentEditChange, WaitingApprovalRow } from '@innovic/shared';
import { useEffect, useMemo, useState } from 'react';
import { ActionLink } from '@/components/shared/action-link';
import { fmtDate } from '@/lib/date';
import { linkProps } from '@/modules/dashboard/components/dash-text';
import { groupChanges } from '@/modules/document-edits/components/change-groups';
import { Icon } from '@/ui/core';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { decideErrText } from '../use-decide-approval';
import { ApprovalRejectDialog } from './approval-reject-dialog';
import { ApprovalRowActions } from './approval-row-actions';

interface ChangeRow {
  change: DocumentEditChange;
  fieldLabel: string;
  kind: 'header' | 'edit' | 'add' | 'remove';
  heading: string | null;
}

const val = (v: DocumentEditChange['before']): string => (v === null || v === '' ? '—' : String(v));

export type DecideChanges = (
  row: WaitingApprovalRow,
  changeIds: string[],
  decision: 'approve' | 'reject',
  reason?: string,
) => Promise<void>;

export function ReviewPanel({
  row,
  onClose,
  decideChanges,
}: {
  row: WaitingApprovalRow;
  onClose: () => void;
  decideChanges: DecideChanges;
}): React.JSX.Element {
  // Changes being decided now (locked until the refetch drops them).
  const [deciding, setDeciding] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // null = closed; [] never; the change ids the Reject reason applies to.
  const [rejecting, setRejecting] = useState<string[] | null>(null);

  const rows = useMemo<ChangeRow[]>(() => {
    const groups = groupChanges(row.changes);
    const many = groups.length > 1;
    return groups.flatMap((g) =>
      g.rows.map((r, i) => ({
        change: r.change,
        fieldLabel: r.fieldLabel,
        kind: r.kind,
        heading: many && i === 0 ? g.heading : null,
      })),
    );
  }, [row.changes]);

  const present = row.changes.map((c) => c.id).join('|');
  useEffect(() => {
    const ids = new Set(present.split('|'));
    setDeciding((prev) => {
      const next = new Set([...prev].filter((k) => ids.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [present]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && rejecting === null) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, rejecting]);

  const open = row.changes.filter((c) => !deciding.has(c.id)).map((c) => c.id);

  async function run(ids: string[], decision: 'approve' | 'reject', reason?: string) {
    if (ids.length === 0) return;
    setError(null);
    setDeciding((prev) => new Set([...prev, ...ids]));
    try {
      await decideChanges(row, ids, decision, reason);
    } catch (e) {
      setDeciding((prev) => new Set([...prev].filter((k) => !ids.includes(k))));
      setError(decideErrText(e));
    }
  }

  const columns: DataTableColumn<ChangeRow>[] = [
    {
      id: 'field',
      header: 'Field',
      kind: 'text',
      ellipsis: true,
      title: (r) => r.change.label,
      render: (r) =>
        r.kind === 'add' ? (
          <span className="tag b-green">+ Add</span>
        ) : r.kind === 'remove' ? (
          <span className="tag b-red">− Remove</span>
        ) : (
          <span style={{ fontWeight: 700 }}>{r.fieldLabel}</span>
        ),
    },
    {
      id: 'now',
      header: 'Now',
      kind: 'text',
      ellipsis: true,
      title: (r) => val(r.change.before),
      render: (r) => <span className="apv-now">{val(r.change.before)}</span>,
    },
    {
      id: 'requested',
      header: 'Requested',
      kind: 'text',
      ellipsis: true,
      title: (r) =>
        r.kind === 'header' || r.kind === 'edit' ? val(r.change.after) : r.change.label,
      render: (r) => (
        <span className="apv-req">
          {r.kind === 'add' || r.kind === 'remove' ? r.change.label : val(r.change.after)}
        </span>
      ),
    },
  ];

  const title = `${row.typeLabel} · ${row.docCode}`;
  return (
    <>
      <button type="button" className="apv-scrim" aria-label="Close review" onClick={onClose} />
      <div className="apv-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="apv-panel-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="apv-panel-title">{title}</h2>
            <div className="apv-panel-meta">
              <span>
                {row.raisedByName ?? '—'} · {fmtDate(row.raisedAt)}
              </span>
              {row.isStale ? (
                <span
                  className="badge b-amber"
                  title="The document changed since this edit was asked"
                >
                  Changed
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="apv-panel-body">
          {error ? (
            <div className="apv-panel-err" role="alert">
              {error}
            </div>
          ) : null}
          <DataTable
            tableKey={TABLE_KEYS.approvalsReview}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.change.id}
            sortFilter={false}
            emptyText="No changes left to decide."
            groupRow={(r) =>
              r.heading ? <span style={{ fontWeight: 700 }}>{r.heading}</span> : null
            }
            rowActions={(r) => (
              <ApprovalRowActions
                busy={deciding.has(r.change.id)}
                onApprove={() => void run([r.change.id], 'approve')}
                onReject={() => {
                  setError(null);
                  setRejecting([r.change.id]);
                }}
              />
            )}
          />
        </div>
        <div className="apv-panel-foot">
          <button
            type="button"
            className="btn btn-success btn-sm"
            disabled={open.length === 0}
            onClick={() => void run(open, 'approve')}
          >
            ✓ Approve all
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={open.length === 0}
            onClick={() => {
              setError(null);
              setRejecting(open);
            }}
          >
            ✗ Reject all
          </button>
          <span style={{ flex: 1 }} />
          {row.docHref ? (
            <ActionLink
              {...linkProps(row.docHref)}
              check={row.docHref}
              className="apv-link"
              style={{ fontWeight: 600 }}
            >
              Open document
            </ActionLink>
          ) : null}
        </div>
      </div>
      {rejecting ? (
        <ApprovalRejectDialog
          title={`Reject — ${row.docCode}`}
          prompt="Why is this rejected?"
          onCancel={() => setRejecting(null)}
          onReject={(reason) => {
            const ids = rejecting;
            setRejecting(null);
            void run(ids, 'reject', reason);
          }}
        />
      ) : null}
    </>
  );
}
