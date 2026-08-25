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

import type { PurchaseRequestListItem } from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { PrStatusBadge } from './pr-status-badge';

/** Accent bar: amber waiting on a decision, blue approved, green turned into a
 *  PO, grey cancelled — the same meaning the status badge carries. */
function accentFor(status: PurchaseRequestListItem['status']): string {
  if (status === 'approved') return 'var(--blue)';
  if (status === 'po_created') return 'var(--green)';
  if (status === 'cancelled') return 'var(--text3)';
  return 'var(--amber)';
}

/** One cell of the card's metric strip — big number over a small caps label,
 *  identical to the SO/WO, JWSO and Dispatch cards. */
function QtyBox({
  label,
  value,
  color,
  bordered,
}: {
  label: string;
  value: React.ReactNode;
  color?: string | undefined;
  bordered?: boolean | undefined;
}): React.JSX.Element {
  return (
    <div
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
          fontSize: 9,
          color: 'var(--text3)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </div>
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
        {pr.soLineNo ? <span className="text3"> · L{pr.soLineNo}</span> : null}
      </span>
    );
  }
  if (pr.sourceJcCode) {
    return (
      <span style={{ color: 'var(--cyan)' }}>
        {pr.sourceJcCode}
        {pr.sourceJcOpSeq ? <span className="text3"> · op {pr.sourceJcOpSeq}</span> : null}
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
  const openDetail = (): void => {
    void navigate({ to: '/purchase-requests/$id', params: { id: pr.id } });
  };

  return (
    <div
      className="panel"
      style={{ display: 'flex', overflow: 'hidden', padding: 0, marginBottom: 10 }}
    >
      <div style={{ width: 4, flexShrink: 0, background: accentFor(pr.status) }} />
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
          <span style={{ fontSize: 12 }}>
            <span className="mono" style={{ color: 'var(--purple)' }}>
              {pr.itemCode ?? pr.itemCodeText ?? '—'}
            </span>{' '}
            <span className="fw-700">{pr.itemName ?? ''}</span>
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--amber)' }}>
            {pr.vendorName ?? pr.vendorCodeText ?? '—'}
          </span>
          <PrStatusBadge status={pr.status} />
          {/* Type tag — only when it is NOT a plain buy, so a normal PR row stays
              as clean as it was. SVC becomes a Service PO (sends the item out on
              a DC); OSP is the system-raised outsource PR. */}
          {pr.prType === 'service' ? (
            <span className="badge b-teal">SVC</span>
          ) : pr.prType === 'jw_osp' ? (
            <span className="badge b-amber">OSP</span>
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
                  className="btn btn-sm btn-success"
                  style={{ fontSize: 10 }}
                  disabled={approving}
                  onClick={() => onApprove(pr)}
                >
                  ✓ Approve
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  style={{ fontSize: 10 }}
                  disabled={rejecting}
                  onClick={() => onReject(pr)}
                >
                  ✕ Reject
                </button>
              </>
            ) : null}
            {canEntry && (pr.status === 'open' || pr.status === 'approved') ? (
              <Link
                to="/purchase-orders/from-pr"
                search={{ prId: pr.id }}
                className="btn btn-sm btn-success"
                style={{ fontSize: 10 }}
              >
                📝 PO
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
            <QtyBox label="Qty" value={pr.qty} />
            {priceHidden ? null : (
              <QtyBox
                label="Est. Cost"
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
            <span className="text2">{pr.prDate}</span>
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
              Req <span className="text2">{pr.requiredDate ?? '—'}</span>
            </span>
            {pr.approvedAt ? (
              <>
                <span>·</span>
                <span style={{ color: 'var(--blue)' }}>✔ {pr.approvedAt.slice(0, 10)}</span>
              </>
            ) : null}
            {pr.poCreatedAt ? (
              <>
                <span>·</span>
                <span style={{ color: 'var(--green)' }}>📝 {pr.poCreatedAt.slice(0, 10)}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
