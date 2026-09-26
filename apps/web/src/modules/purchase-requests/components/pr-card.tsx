// One Purchase Request = one SO-Master-style card. Replaces the 11-column
// table (PR No. | Dates | SO/JC | Operation | Item | Vendor | Qty | Est. Cost |
// Req. Date | Status | Actions), which was `white-space: nowrap` on every cell
// with three free-text columns, so the page scrolled sideways and the PR No.
// slid out of view. Same bands as sales-orders/routes/list.tsx and the Dispatch
// port: accent bar + identity band, then metric strip + meta line.
//
// Nothing about the data or the actions changed — every column the table showed
// is still on the card, and Approve / Reject / 📝 PO / Assign Task call the same
// handlers they always did.
//
// The one gate that DID change: Approve / Reject and 📝 PO used to share a
// single `canWrite` flag, so an L3 Editor could approve and an L4 Approver got
// buttons they may not press. They are now two independent tier rights —
// `canApprove` (L4+) for the sign-off pair, `canEntry` (L2+) for raising the PO.
//
// 2026-09-08 (ADR-152, PR→PO balance): the card carries Ordered and Balance
// beside Qty, the accent bar and the new progress pill read the BALANCE instead
// of the yes/no "has a PO", and 📝 PO stays available while quantity is left to
// order. Before this, one PO for 10 of 100 closed the request on screen and the
// other 90 could never be bought. The linked PO code is untouched.
//
// Phase 2: a SHORT-CLOSED request (the buyer stopped expecting the rest) reads
// grey and says so — "Balance closed — 90 of 100 not ordered" — instead of
// borrowing the green "Fully ordered" wording, which would claim the whole
// quantity was bought. All of that comes out of pr-balance.ts; the card has no
// rule of its own.

import { type PurchaseRequestListItem, opSrNo } from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import {
  type PrOrderBalance,
  prBalanceClosedText,
  prBalanceColor,
  prOrderBalance,
} from '../lib/pr-balance';
import { PrStatusBadge } from './pr-status-badge';
import { PR_TYPE_LABELS } from '../lib/pr-labels';

/** Accent bar: how much of this request is actually on order (ADR-152) — amber
 *  none of it yet, blue part of it, green all of it, red over-ordered, grey
 *  cancelled. It used to read `status === 'po_created' → green`, which painted
 *  a PR "done" after a PO for 10 of 100. */
function accentFor(pr: PurchaseRequestListItem, bal: PrOrderBalance): string {
  if (pr.status === 'cancelled') return 'var(--text3)';
  return prBalanceColor(bal.state);
}

/** One cell of the card's metric strip — big number over a small caps label,
 *  identical to the SO/WO, JWSO and Dispatch cards. */
function QtyBox({
  label,
  value,
  color,
  bordered,
  note,
  noteColor,
  title,
}: {
  label: string;
  value: React.ReactNode;
  color?: string | undefined;
  bordered?: boolean | undefined;
  /** Small line under the label — the Pending box carries the ordering
   *  progress here (R5 PU-P48) instead of a third badge in the title band. */
  note?: string | undefined;
  noteColor?: string | undefined;
  title?: string | undefined;
}): React.JSX.Element {
  return (
    <div
      title={title}
      style={{
        padding: '4px 12px',
        textAlign: 'center',
        minWidth: 58,
        borderLeft: bordered ? '1px solid var(--border)' : undefined,
      }}
    >
      <div
        className="mono fw-700"
        style={{ fontSize: 15, color: color ?? 'var(--text)', lineHeight: 1.2 }}
      >
        {value}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: 'var(--text3)',
        }}
      >
        {label}
      </div>
      {note ? (
        <div style={{ fontSize: 11, fontWeight: 600, color: noteColor ?? 'var(--text3)' }}>
          {note}
        </div>
      ) : null}
    </div>
  );
}

/** The SO / JC this PR came from — a PR is raised off either an SO line or a
 *  JC op, so show whichever it has. */
function SourceRef({ pr }: { pr: PurchaseRequestListItem }): React.JSX.Element {
  if (pr.soCode) {
    return (
      <span style={{ color: 'var(--cyan)' }}>
        {pr.soCode}
        {pr.soLineNo ? <span className="text3"> · Ln {pr.soLineNo}</span> : null}
      </span>
    );
  }
  if (pr.sourceJcCode) {
    return (
      <span style={{ color: 'var(--cyan)' }}>
        {pr.sourceJcCode}
        {pr.sourceJcOpSeq ? <span className="text3"> · Op {opSrNo(pr.sourceJcOpSeq)}</span> : null}
      </span>
    );
  }
  return <span className="text3">—</span>;
}

export function PrCard({
  pr,
  canApprove,
  canEntry,
  approving,
  rejecting,
  onApprove,
  onReject,
}: {
  pr: PurchaseRequestListItem;
  /** L4 Approver and above — signing a PR off is NOT an edit right. */
  canApprove: boolean;
  /** L2 Data Entry and above — raising the PO off this PR is an entry right. */
  canEntry: boolean;
  approving: boolean;
  rejecting: boolean;
  onApprove: (pr: PurchaseRequestListItem) => void;
  onReject: (pr: PurchaseRequestListItem) => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  // Money hidden for L1 Viewers: estCost comes back null → drop the field.
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = pr.priceVisible === false;
  const estCost = Number(pr.estCost ?? 0);
  // How much is on a live purchase order and how much is still to buy. This is
  // what the card now says instead of the old yes/no "has a PO".
  const bal = prOrderBalance(pr);
  const openDetail = (): void => {
    void navigate({ to: '/purchase-requests/$id', params: { id: pr.id } });
  };

  return (
    <div
      className="panel"
      style={{ display: 'flex', overflow: 'hidden', padding: 0, marginBottom: 10 }}
    >
      <div style={{ width: 4, flexShrink: 0, background: accentFor(pr, bal) }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* ── Band 1: identity + item + vendor + status — actions ── */}
        <div
          onClick={openDetail}
          title="Open this purchase request"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            padding: '10px 14px',
            cursor: 'pointer',
          }}
        >
          <Link
            to="/purchase-requests/$id"
            params={{ id: pr.id }}
            className="td-code"
            style={{ color: 'var(--blue)', fontWeight: 800, fontSize: 13 }}
            onClick={(e) => e.stopPropagation()}
          >
            {pr.code}
          </Link>
          {/* POL — the CUSTOMER's own PO line number off the SO line behind this
              request. Same purple mono chip the Job Card list uses; absent when
              the PR has no sales order behind it (a stock buy). */}
          {pr.clientPoLineNo ? (
            <span className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>
              POL{' '}
              <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{pr.clientPoLineNo}</span>
            </span>
          ) : null}
          <span style={{ fontSize: 12 }}>
            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
              {/* CODE/REV — the customer's drawing revision off the SO line this
                  request was raised against. A PR with no SO behind it has no
                  revision and keeps the bare code. */}
              {itemCodeWithRev(pr.itemCode ?? pr.itemCodeText, pr.itemRevision)}
            </span>{' '}
            <span className="fw-700">{pr.itemName ?? ''}</span>
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--amber2)' }}>
            {pr.vendorName ?? pr.vendorCodeText ?? '—'}
          </span>
          <PrStatusBadge status={pr.status} />
          {/* How far the ORDERING has got, which the status alone cannot say:
              a `po_created` PR may still have 90 of 100 to buy. It now sits
              under the Pending box below (R5 PU-P48) — status + type are the
              only badges here. */}
          {/* Type tag — only when it is NOT a plain buy, so a normal PR row stays
              as clean as it was. Service becomes a Service PO (sends the item out
              on a DC); Outsource is the system-raised outsource PR. */}
          {pr.prType === 'service' ? (
            <span className="badge b-teal">{PR_TYPE_LABELS[pr.prType]}</span>
          ) : pr.prType === 'jw_osp' ? (
            <span className="badge b-amber">{PR_TYPE_LABELS[pr.prType]}</span>
          ) : null}
          <span style={{ flex: 1 }} />
          {/* Row actions do something OTHER than open the PR, so the card's
              click must not fire underneath them.
              `flexWrap` + `minWidth: 0`: every `.btn` is `white-space: nowrap`,
              so on an open PR this cluster is 4 un-shrinkable buttons (~330px).
              Without these it can neither shrink nor break, and `.panel`'s
              `overflow: hidden` clips the tail buttons on a narrow card. */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              alignItems: 'center',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              minWidth: 0,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {canApprove && pr.status === 'open' ? (
              <>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={approving}
                  onClick={() => onApprove(pr)}
                >
                  ✓ Approve
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={rejecting}
                  onClick={() => onReject(pr)}
                >
                  ✕ Reject
                </button>
              </>
            ) : null}
            {/* Raise a PO for what is LEFT. The old gate was
                `status === 'open' || 'approved'`, so the first partial PO flipped
                the PR to `po_created` and took the button away with 90 of 100
                still unordered (ADR-152). Cancelled PRs are never orderable. */}
            {canEntry && pr.status !== 'cancelled' && bal.balance > 0 ? (
              <Link
                to="/purchase-orders/from-pr"
                search={{ prId: pr.id }}
                className="btn btn-sm btn-primary"
              >
                Create PO
              </Link>
            ) : null}
            {pr.status === 'po_created' && pr.poId && pr.poCode ? (
              <Link
                to="/purchase-orders/$id"
                params={{ id: pr.poId }}
                className="mono cyan"
                style={{ fontSize: 11, textDecoration: 'underline dotted' }}
              >
                {pr.poCode}
              </Link>
            ) : null}
            {pr.status !== 'cancelled' && pr.status !== 'po_created' ? (
              <AssignTaskButton
                linkedRef={{
                  type: 'purchase_request',
                  id: pr.id,
                  display: `PR ${pr.code}`,
                  navPage: `/purchase-requests/${pr.id}`,
                }}
                suggestedTitle={
                  pr.status === 'open' ? `Review & approve ${pr.code}` : `Convert ${pr.code} to PO`
                }
                label=""
              />
            ) : null}
          </div>
        </div>

        {/* ── Band 2: metric boxes + meta line ── */}
        <div
          onClick={openDetail}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            padding: '0 14px 10px',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6 }}>
            <QtyBox label="PR Qty" value={pr.qty} />
            <QtyBox label="On PO" value={bal.ordered} bordered />
            {/* Negative = more ordered than requested. Red and flagged, never
                clamped to 0 — somebody has to go and look at it. */}
            <QtyBox
              label="Pending"
              value={bal.balance < 0 ? `⚠ ${bal.balance}` : bal.balance}
              color={prBalanceColor(bal.state)}
              bordered
              note={bal.ordered > 0 ? bal.label : undefined}
              noteColor={prBalanceColor(bal.state)}
              title={
                bal.closed
                  ? `${prBalanceClosedText(bal)}${bal.closedReason ? ` — ${bal.closedReason}` : ''}`
                  : `${bal.ordered} of ${bal.qty} ordered · ${bal.balance} pending`
              }
            />
            {priceHidden ? null : (
              <QtyBox
                label="Est. Rate (₹)"
                value={estCost > 0 ? `₹${estCost.toFixed(2)}` : '—'}
                bordered
              />
            )}
          </div>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--text3)',
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span className="text2">{fmtDate(pr.prDate)}</span>
            <span>·</span>
            <SourceRef pr={pr} />
            {pr.operation ? (
              <>
                <span>·</span>
                <span className="text2">{pr.operation}</span>
              </>
            ) : null}
            <span>·</span>
            <span>
              Due Date <span className="text2">{fmtDate(pr.requiredDate)}</span>
            </span>
            {pr.approvedAt ? (
              <>
                <span>·</span>
                <span style={{ color: 'var(--blue)' }}>Approved {fmtDate(pr.approvedAt)}</span>
              </>
            ) : null}
            {pr.poCreatedAt ? (
              <>
                <span>·</span>
                <span style={{ color: 'var(--green2)' }}>PO {fmtDate(pr.poCreatedAt)}</span>
              </>
            ) : null}
            {bal.closed ? (
              <>
                <span>·</span>
                <span
                  className="text3"
                  title={bal.closedReason ?? undefined}
                  style={{
                    maxWidth: 220,
                    display: 'inline-block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  🚫 {prBalanceClosedText(bal)}
                  {bal.closedReason ? ` — ${bal.closedReason}` : ''}
                </span>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
