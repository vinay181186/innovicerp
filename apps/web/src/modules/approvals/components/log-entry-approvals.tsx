// Op Entry tab of Settings → Approvals (ADR-130).
//
// Date/time corrections on op entries. Split by a Status dropdown in the
// filter bar (Pending / Approved / Rejected) so a decision does not vanish the moment it is made — the row keeps
// its full trail (who decided, when, and the reject reason). While a request
// sits in Waiting the entry is UNTOUCHED: the shop floor, the JC feed and every
// report still read the original values, so nothing here can move a production
// number until someone presses Approve.
//
// Qty is shown but is never part of the ask: op_log's qty columns are frozen
// by a DB trigger (ADR-127), so a correction cannot smuggle one in.

import { type OpLogChangeStatus, type OpLogTimeChangeRequest, opSrNo } from '@innovic/shared';
import { Check, Loader2, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fmtDateAndTime, fmtDateTime } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { useDecideOpLogTimeChange, useOpLogTimeChangeRequests } from '@/modules/op-entry/api';
import { ListHeader } from '@/ui/layout';
import { approvalsKeys } from '../api';

// The op-log entry type as the user reads it (codes stay as stored).
const LOG_TYPE_LABEL: Record<string, string> = { start: 'Start', complete: 'Completed', qc: 'QC' };

const when = (date: string, time: string | null): string => fmtDateAndTime(date, time);

const istStamp = (iso: string): string => fmtDateTime(iso);

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
  /** The Approvals inbox's PR · PO · Log Entry switch, shown under the header. */
  tabs?: React.ReactNode;
}): React.JSX.Element {
  const [sub, setSub] = useState<OpLogChangeStatus>('pending');
  const list = useOpLogTimeChangeRequests({ status: sub, limit: 200 });
  const decide = useDecideOpLogTimeChange();
  // A decision also shrinks the Approvals inbox (its Log Entry count and the
  // nav badge), which is a separate query.
  const qc = useQueryClient();
  const refreshInbox = (): void => {
    void qc.invalidateQueries({ queryKey: approvalsKeys.inbox() });
  };
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const active = SUB_TABS.find((t) => t.key === sub);
  const rows = list.data ?? [];
  // Waiting is a FIFO queue (oldest first). The history tabs read better with
  // the most recent decision on top.
  // Client-side search over the cards loaded (up to 200) — the JC, item,
  // operation, machine, reason and the people on each card.
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
              setRejectingId(null);
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
          setRejectingId(null);
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

      {list.isLoading ? (
        <div className="empty-state">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading requests…
        </div>
      ) : list.isError ? (
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          {list.error instanceof Error ? list.error.message : 'Could not load requests. Try again.'}
        </div>
      ) : ordered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✅</div>
          {active?.empty ?? 'Nothing here yet.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {decide.isError ? (
            <div style={{ color: 'var(--red2)', fontSize: 12 }}>{decide.error.message}</div>
          ) : null}
          {ordered.map((r) => (
            <RequestCard
              key={r.id}
              req={r}
              busy={decide.isPending}
              isRejecting={rejectingId === r.id}
              rejectReason={rejectReason}
              onRejectReason={setRejectReason}
              onStartReject={() => {
                setRejectingId(r.id);
                setRejectReason('');
              }}
              onCancelReject={() => setRejectingId(null)}
              onApprove={() =>
                decide.mutate({ id: r.id, decision: 'approve' }, { onSuccess: refreshInbox })
              }
              onReject={() =>
                decide.mutate(
                  { id: r.id, decision: 'reject', decisionReason: rejectReason.trim() },
                  {
                    onSuccess: () => {
                      refreshInbox();
                      setRejectingId(null);
                      setRejectReason('');
                    },
                  },
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CardProps {
  req: OpLogTimeChangeRequest;
  busy: boolean;
  isRejecting: boolean;
  rejectReason: string;
  onRejectReason: (v: string) => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onApprove: () => void;
  onReject: () => void;
}

// Top-bar colour by lifecycle: amber = waiting, green = approved, red = rejected.
const barColor = (status: OpLogChangeStatus): string =>
  status === 'approved' ? 'var(--green)' : status === 'rejected' ? 'var(--red)' : 'var(--amber)';

function RequestCard({
  req,
  busy,
  isRejecting,
  rejectReason,
  onRejectReason,
  onStartReject,
  onCancelReject,
  onApprove,
  onReject,
}: CardProps): React.JSX.Element {
  const isPending = req.status === 'pending';
  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ height: 3, background: barColor(req.status) }} />
      <div style={{ padding: '10px 12px' }}>
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'baseline',
            flexWrap: 'wrap',
            marginBottom: 8,
          }}
        >
          <span className="mono fw-700 cyan">{req.jobCardCode}</span>
          {/* WHAT was being made. The card used to show a job number and nothing
              else, and a job number says WHICH JOB, not WHICH PART — an approver
              cannot judge a retiming without knowing the part. `CODE/REV` where
              the card traces back to an SO line; the bare code otherwise. Null
              renders nothing at all, not a dash, so the row of chips stays
              clean when the item cannot be resolved. */}
          {/* POL — the line number printed on the CUSTOMER's own purchase
              order, immediately before the item code. Dropped when the card has
              no sales order behind it, like the item chips around it. */}
          {req.clientPoLineNo ? (
            <span className="mono" style={{ whiteSpace: 'nowrap' }}>
              POL{' '}
              <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{req.clientPoLineNo}</span>
            </span>
          ) : null}
          {req.itemCode ? (
            <span className="mono fw-700" style={{ whiteSpace: 'nowrap', color: 'var(--text)' }}>
              {itemCodeWithRev(req.itemCode, req.itemRevision, '')}
            </span>
          ) : null}
          {req.itemName ? (
            <span
              className="text3"
              style={{
                fontSize: 11,
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={req.itemName}
            >
              {req.itemName}
            </span>
          ) : null}
          <span className="mono">Op {opSrNo(req.opSeq)}</span>
          <span>{req.operation}</span>
          <span className="text3" style={{ fontSize: 11 }}>
            {LOG_TYPE_LABEL[req.logType] ?? req.logType}
          </span>
          {req.machineCode ? <span className="mono">{req.machineCode}</span> : null}
          {req.rejectQty > 0 ? (
            <span className="mono" style={{ color: 'var(--red2)' }}>
              {req.rejectQty} rejected
            </span>
          ) : null}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
            marginBottom: 8,
          }}
        >
          <Field label="Log Date / Time">
            <span className="mono">{when(req.prevLogDate, req.prevStartTime)}</span>
            <span className="text3"> → </span>
            <span className="mono" style={{ color: 'var(--amber2)', fontWeight: 700 }}>
              {when(req.requestedLogDate, req.requestedStartTime)}
            </span>
          </Field>
          <Field label="Completed">
            <span className="mono">{req.qty}</span>
          </Field>
          <Field label="Asked By">
            {req.requestedByName ?? '—'}
            <span className="text3" style={{ fontSize: 11 }}>
              {' '}
              · {istStamp(req.requestedAt)}
            </span>
          </Field>
        </div>

        {req.reason ? (
          <div className="text3" style={{ fontSize: 12, marginBottom: 8 }}>
            Reason: “{req.reason}”
          </div>
        ) : null}

        {/* The entry moved since this was asked for, so the "was" above no
            longer matches the row. Approving still writes the requested value.
            Only relevant while the request is still waiting. */}
        {isPending && req.isStale ? (
          <div style={{ color: 'var(--amber2)', fontSize: 11, marginBottom: 8 }}>
            ⚠ This entry has been changed since the request was raised — the “from” value above is
            out of date.
          </div>
        ) : null}

        {isPending ? (
          isRejecting ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="innovic-input"
                type="text"
                aria-label="Reason for rejecting"
                placeholder="Why is this rejected? (required)"
                value={rejectReason}
                onChange={(e) => onRejectReason(e.target.value)}
                style={{ flex: '1 1 220px', minWidth: 200 }}
              />
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={busy || !rejectReason.trim()}
                onClick={onReject}
              >
                Reject
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={onCancelReject}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={onApprove}
              >
                {busy ? (
                  <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                ) : (
                  <Check className="mr-1 inline h-3 w-3" />
                )}
                Approve
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={onStartReject}
              >
                <X className="mr-1 inline h-3 w-3" />
                Reject
              </button>
            </div>
          )
        ) : (
          <DecisionFooter req={req} />
        )}
      </div>
    </div>
  );
}

// Read-only outcome line for a request that has already been decided.
function DecisionFooter({ req }: { req: OpLogTimeChangeRequest }): React.JSX.Element {
  const approved = req.status === 'approved';
  return (
    <div style={{ fontSize: 12 }}>
      <span style={{ color: approved ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
        {approved ? '✅ Approved' : '⛔ Rejected'}
      </span>
      {req.decidedByName ? <span className="text3"> by {req.decidedByName}</span> : null}
      {req.decidedAt ? <span className="text3"> · {istStamp(req.decidedAt)}</span> : null}
      <span className="text3">
        {approved ? ' — new date/time applied to the entry.' : ' — entry left unchanged.'}
      </span>
      {req.decisionReason ? (
        <div className="text3" style={{ marginTop: 4 }}>
          Reason: “{req.decisionReason}”
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div className="text3" style={{ fontSize: 11, letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ fontSize: 12 }}>{children}</div>
    </div>
  );
}
