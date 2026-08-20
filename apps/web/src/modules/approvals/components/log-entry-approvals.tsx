// Log Entry tab of Settings → Approvals (ADR-130).
//
// Date/time corrections on op entries. Sub-tabbed into Waiting / Approved /
// Rejected so a decision does not vanish the moment it is made — the row keeps
// its full trail (who decided, when, and the reject reason). While a request
// sits in Waiting the entry is UNTOUCHED: the shop floor, the JC feed and every
// report still read the original values, so nothing here can move a production
// number until someone presses Approve.
//
// Qty is shown but is never part of the ask: op_log's qty columns are frozen
// by a DB trigger (ADR-127), so a correction cannot smuggle one in.

import type { OpLogChangeStatus, OpLogTimeChangeRequest } from '@innovic/shared';
import { Check, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { useDecideOpLogTimeChange, useOpLogTimeChangeRequests } from '@/modules/op-entry/api';

const hhmm = (t: string | null): string => (t ? t.slice(0, 5) : '');
const when = (date: string, time: string | null): string =>
  time ? `${date} ${hhmm(time)}` : date;

const istStamp = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

const SUB_TABS: Array<{ key: OpLogChangeStatus; label: string; empty: string }> = [
  { key: 'pending', label: 'Waiting', empty: 'Nothing waiting for approval.' },
  { key: 'approved', label: 'Approved', empty: 'No approved corrections yet.' },
  { key: 'rejected', label: 'Rejected', empty: 'No rejected corrections yet.' },
];

export function LogEntryApprovals(): React.JSX.Element {
  const [sub, setSub] = useState<OpLogChangeStatus>('pending');
  const list = useOpLogTimeChangeRequests({ status: sub, limit: 200 });
  const decide = useDecideOpLogTimeChange();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const active = SUB_TABS.find((t) => t.key === sub);
  const rows = list.data ?? [];
  // Waiting is a FIFO queue (oldest first). The history tabs read better with
  // the most recent decision on top.
  const ordered = sub === 'pending' ? rows : [...rows].reverse();

  return (
    <div>
      {/* Sub-tabs: Waiting / Approved / Rejected. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {SUB_TABS.map((t) => {
          const isActive = sub === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setSub(t.key);
                setRejectingId(null);
              }}
              style={{
                background: 'none',
                border: `1px solid ${isActive ? 'var(--cyan)' : 'var(--border)'}`,
                color: isActive ? 'var(--cyan)' : 'var(--text2)',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: isActive ? 700 : 500,
                padding: '5px 12px',
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {list.isLoading ? (
        <div className="empty-state">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading requests…
        </div>
      ) : list.isError ? (
        <div className="empty-state" style={{ color: 'var(--red)' }}>
          {list.error instanceof Error ? list.error.message : 'Failed to load requests'}
        </div>
      ) : ordered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✅</div>
          {active?.empty ?? 'Nothing here yet.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {decide.isError ? (
            <div style={{ color: 'var(--red)', fontSize: 12 }}>{decide.error.message}</div>
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
              onApprove={() => decide.mutate({ id: r.id, decision: 'approve' })}
              onReject={() =>
                decide.mutate(
                  { id: r.id, decision: 'reject', decisionReason: rejectReason.trim() },
                  {
                    onSuccess: () => {
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
          <span className="mono">Op{req.opSeq}</span>
          <span>{req.operation}</span>
          <span className="text3" style={{ fontSize: 11, textTransform: 'uppercase' }}>
            {req.logType}
          </span>
          {req.machineCode ? <span className="mono">{req.machineCode}</span> : null}
          <span className="mono">{req.qty} pcs</span>
          {req.rejectQty > 0 ? (
            <span className="mono" style={{ color: 'var(--red)' }}>
              {req.rejectQty} rej
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
          <Field label="DATE / TIME">
            <span className="mono">{when(req.prevLogDate, req.prevStartTime)}</span>
            <span className="text3"> → </span>
            <span className="mono" style={{ color: 'var(--amber)', fontWeight: 700 }}>
              {when(req.requestedLogDate, req.requestedStartTime)}
            </span>
          </Field>
          <Field label="QTY">
            <span className="mono">{req.qty}</span>
            <span className="text3" style={{ fontSize: 10 }}>
              {' '}
              — cannot be changed
            </span>
          </Field>
          <Field label="ASKED BY">
            {req.requestedByName ?? '—'}
            <span className="text3" style={{ fontSize: 10 }}>
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
          <div style={{ color: 'var(--amber)', fontSize: 11, marginBottom: 8 }}>
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
      <div className="text3" style={{ fontSize: 9, letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ fontSize: 12 }}>{children}</div>
    </div>
  );
}
