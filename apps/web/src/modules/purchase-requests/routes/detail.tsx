// PR detail page (UI-003-04).
//
// 2026-10-03 layout (the Plan screens method): one panel — the identity line
// (CODE/REV, SO line, POL, JC op, PO) then four one-line clusters with their
// names in a left gutter: Quantity (… ending on Pending), Schedule, Vendor
// (… ending on Est. Amount), Notes. Create / Edit use the same clusters.
//
// Styling follows the Sales Order detail screen (modules/sales-orders/routes/
// detail.tsx), which is the app-wide style reference: shared `.panel` /
// `.panel-hdr` / `.panel-body` chrome, `.form-label` fact strips, `.btn`
// actions, and colours taken only from the tokens in styles/tokens.css. The
// former page-local `.prd-*` stylesheet (a duplicated palette + type scale with
// ten hard-coded hexes) is gone — nothing here paints outside the theme.
//
// 2026-09-08 (ADR-152, PR→PO balance): the request detail strip carries Ordered
// and Balance beside Qty, an over-ordered PR (negative balance) shouts in red,
// and Create PO is offered while there is quantity left to order rather than
// only until the first PO exists. The Linked PO field and the View linked PO
// button are unchanged.
//
// Phase 2 adds "Close balance": a buyer who ordered 10 of 100 and knows the
// other 90 is not coming says so here. It is NOT an edit of the quantity (the
// request still says 100 was asked for) and NOT a rejection (what was ordered
// stands), so it needed a door of its own — the PR could previously be neither
// edited nor rejected once any PO existed, and the 90 sat in the "still to buy"
// list forever.

import { type DocumentEditChange, type PurchaseRequestDetail, opSrNo } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, FileText, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  headerPendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { DocumentHistory } from '@/components/shared/document-history';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { AssignTaskModal } from '@/modules/tasks/components/task-modals';
import { ConfirmDialog } from '@/ui/feedback';
import { Cluster, ClusterFact, ClusterGrid, DocIdent, IdentCode, IdentSep } from '@/ui/forms';
import { ActionMenu } from '@/ui/layout';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  useClosePurchaseRequestBalance,
  usePurchaseRequest,
  useSoftDeletePurchaseRequest,
} from '../api';
import { CloseBalanceModal } from '../components/close-balance-modal';
import { PrStatusBadge } from '../components/pr-status-badge';
import { prBalanceClosedText, prBalanceColor, prOrderBalance } from '../lib/pr-balance';
import { prConvertible, usePrApprovalOn } from '../lib/pr-convertible';
import { PR_TYPE_LABELS } from '../lib/pr-labels';

export const purchaseRequestDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-requests/$id',
  component: PurchaseRequestDetailPage,
});

function PurchaseRequestDetailPage(): React.JSX.Element {
  const { id } = purchaseRequestDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = usePurchaseRequest(id);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'pr_create');
  // ADR-202 — the edit(s) staged against this PR and still waiting for a
  // decision. Their per-field changes drive the inline amber chips next to the
  // record fields below. Flattened across requests (usually one).
  const pendingEdit = usePendingEditForDoc('PurchaseRequest', detail?.id);
  const pendingChanges = (pendingEdit.data?.rows ?? []).flatMap((r) => r.changes);
  // Create PO is a PURCHASE ORDER action that merely starts from this PR, so it
  // follows po_create — not pr_create. The page it opens
  // (/purchase-orders/from-pr) guards on po_create.entry, and a button gated on
  // a different key than its destination is the "button that only fails on
  // click" pattern this whole pass exists to remove.
  const canCreatePo = effectiveFormPerms(eff, 'po_create').entry;
  const prApprovalOn = usePrApprovalOn();
  const softDelete = useSoftDeletePurchaseRequest();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // ADR-197 — why the PR goes to Trash (required; lands on its History).
  const [deleteReason, setDeleteReason] = useState('');
  // Short-closing the remainder is a SIGN-OFF, not data entry, so it rides the
  // same `pr_create` + approve right the Approve / Reject pair on the PR list
  // uses — and the same right the API gate (`requireFormAccess(user,
  // 'pr_create', 'approve')`) checks, so the button cannot appear to someone
  // the server then refuses.
  const closeBalanceMut = useClosePurchaseRequestBalance();
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading purchase request…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/purchase-requests" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'PR not found. Refresh the page.'}
          </div>
        </div>
      </div>
    );
  }

  // "Hide page" (Access Control → Config): once access has loaded, a user
  // whose VIEW was removed for this page sees the no-access panel, not the
  // page. `eff` is undefined only while access is still loading — don't block
  // then, or every legitimate user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Purchase Requests. Ask an admin.
      </div>
    );
  }

  // Returns the promise so the ConfirmDialog shows its pending state and keeps
  // a failure inside the dialog instead of closing it.
  const onDelete = async (): Promise<void> => {
    const reason = deleteReason.trim();
    // Thrown, not returned: the ConfirmDialog shows it and stays open.
    if (!reason) throw new Error('Enter a reason to move this PR to Trash.');
    await softDelete.mutateAsync({ id: detail.id, reason });
    void navigate({ to: '/purchase-requests', replace: true });
  };

  // Tier-driven, per department (Purchase). Raising the PO off this PR is an
  // entry right; changing the PR itself is an edit right.
  const canEdit = perms.edit;
  // Delete is not one of the four tier actions, so it is expressed as the pair
  // only L5 Department Admin and above hold: edit AND approve. L3 has edit
  // without approve; L4 has approve without edit.
  const canDelete = perms.edit && perms.approve;
  const linkedToPo = detail.poId !== null;
  // What is still to order. A PR for 100 with a PO for 10 has 90 left, so
  // "has a PO" is no longer the test for whether another PO may be raised.
  const bal = prOrderBalance(detail);
  // ADR-189: while PR approval is on, the PR must be Approved before a PO.
  const canOrder = prConvertible(detail, prApprovalOn) && bal.balance > 0 && canCreatePo;
  // Offered only when there is something to close: part of it bought, part of
  // it still outstanding, nothing closed yet, request not cancelled. A PR with
  // NOTHING ordered is a Reject, not a close — the API refuses it by name, so
  // the button must not be there to press.
  const canCloseBalance =
    perms.approve &&
    detail.status !== 'cancelled' &&
    !bal.closed &&
    bal.ordered > 0 &&
    bal.balance > 0;

  const onCloseBalance = (reason: string): void => {
    setCloseError(null);
    closeBalanceMut.mutate(
      { id: detail.id, reason },
      {
        onSuccess: () => setCloseOpen(false),
        onError: (e) =>
          setCloseError(e instanceof Error ? e.message : 'Could not short close PR. Try again.'),
      },
    );
  };

  // CODE/REV. The revision is the customer's drawing revision on the SO line
  // this request was raised against, so it only appears when there is one; a
  // hand-raised PR shows the bare code.
  const itemCode = itemCodeWithRev(detail.itemCode ?? detail.itemCodeText, detail.itemRevision);

  return (
    <div>
      <Link to="/purchase-requests" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Purchase Requests
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div style={{ minWidth: 0 }}>
            <div
              className="td-code"
              style={{ color: 'var(--blue)', fontSize: 16, fontWeight: 700 }}
            >
              {detail.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {/* Falls back to CODE/REV, never the bare snapshot code — the
                  revision travels with the code everywhere else on this page. */}
              {detail.itemName ??
                itemCodeWithRev(
                  detail.itemCode ?? detail.itemCodeText,
                  detail.itemRevision,
                  'Untitled item',
                )}
              <PrStatusBadge status={detail.status} />
              {detail.prType ? (
                <span className="badge b-grey">{PR_TYPE_LABELS[detail.prType]}</span>
              ) : null}
            </div>
          </div>
          {/* ONE primary next step + an Actions menu for the rest. The step is
              Create PO while quantity is LEFT (whatever POs already exist — the
              old `!linkedToPo` test removed it after a PO for 10 of 100), else
              View linked PO once the PR is fully ordered. Cancelled PRs stay
              unorderable. */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {canOrder ? (
              <Link
                to="/purchase-orders/from-pr"
                search={{ prId: detail.id }}
                className="btn btn-primary"
              >
                <FileText size={13} /> Create PO
              </Link>
            ) : linkedToPo && detail.poId ? (
              <Link
                to="/purchase-orders/$id"
                params={{ id: detail.poId }}
                className="btn btn-primary"
              >
                <FileText size={13} /> View linked PO
              </Link>
            ) : null}
            <ActionMenu
              items={[
                {
                  // Once a PO exists this PR is locked — surface the PO to view,
                  // and hide Edit below.
                  label: 'View linked PO',
                  hidden: !(canOrder && linkedToPo && detail.poId),
                  onClick: () => {
                    if (detail.poId)
                      void navigate({ to: '/purchase-orders/$id', params: { id: detail.poId } });
                  },
                },
                {
                  label: 'Short Close',
                  hidden: !canCloseBalance,
                  title: `Stop expecting the pending ${bal.balance} of ${bal.qty}`,
                  onClick: () => {
                    setCloseError(null);
                    setCloseOpen(true);
                  },
                },
                { label: 'Assign Task', onClick: () => setAssignOpen(true) },
                {
                  label: 'Edit',
                  hidden: !(canEdit && !linkedToPo),
                  onClick: () =>
                    void navigate({ to: '/purchase-requests/$id/edit', params: { id: detail.id } }),
                },
                {
                  label: 'Delete',
                  danger: true,
                  hidden: !canDelete,
                  disabled: linkedToPo,
                  title: linkedToPo ? 'PR has a linked PO — cancel instead of delete' : undefined,
                  onClick: () => {
                    setDeleteReason('');
                    setConfirmDelete(true);
                  },
                },
              ]}
            />
          </div>
        </div>
        {canDelete && confirmDelete && !linkedToPo ? (
          <ConfirmDialog
            title={`Move PR ${detail.code} to Trash?`}
            message={
              <>
                You can restore it from Trash.
                <textarea
                  className="innovic-input"
                  aria-label="Reason"
                  placeholder="Reason (required)"
                  rows={2}
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: 8 }}
                />
              </>
            }
            confirmLabel="Move to Trash"
            pendingLabel="Moving…"
            tone="danger"
            onCancel={() => setConfirmDelete(false)}
            onConfirm={onDelete}
          />
        ) : null}
        {assignOpen ? (
          <AssignTaskModal
            linkedRef={{
              type: 'purchase_request',
              id: detail.id,
              display: `PR ${detail.code}`,
              navPage: `/purchase-requests/${detail.id}`,
            }}
            suggestedTitle={`Follow up on PR ${detail.code}`}
            onClose={() => setAssignOpen(false)}
          />
        ) : null}
        <div className="panel-body">
          {softDelete.isError ? (
            <div
              style={{
                color: 'var(--red2)',
                background: 'var(--red3)',
                border: '1px solid var(--sig-critical-bd)',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {softDelete.error instanceof Error
                ? softDelete.error.message
                : 'Could not delete PR. Try again.'}
            </div>
          ) : null}
          {/* WHICH item, order line and job this PR serves — identity, not facts
              about the PR, so it heads the panel instead of taking grid cells.
              Parts with nothing behind them (a hand-raised PR has no SO, JC or
              PO) are left out rather than shown as a row of dashes. */}
          <DocIdent>
            <IdentCode>{itemCode}</IdentCode>
            <Chip changes={pendingChanges} field="itemCodeText" />
            {detail.itemName ? <span>{detail.itemName}</span> : null}
            <Chip changes={pendingChanges} field="itemName" />
            {detail.soCode ? (
              <>
                <IdentSep />
                <span>
                  SO <IdentCode>{soNoWithInternal(detail.soCode, detail.soInternalNo)}</IdentCode>
                  {detail.soLineNo ? ` · Ln ${detail.soLineNo}` : ''}
                </span>
              </>
            ) : null}
            {/* POL = the CUSTOMER's own PO line number off the SO line behind
                this PR. Not our SO line number — the two rarely match. */}
            {detail.clientPoLineNo ? (
              <>
                <IdentSep />
                <span>
                  POL{' '}
                  <b className="mono" style={{ color: 'var(--purple)' }}>
                    {detail.clientPoLineNo}
                  </b>
                </span>
              </>
            ) : null}
            {detail.sourceJcCode ? (
              <>
                <IdentSep />
                <span>
                  JC <IdentCode>{detail.sourceJcCode}</IdentCode>
                  {detail.sourceJcOpSeq ? ` · Op ${opSrNo(detail.sourceJcOpSeq)}` : ''}
                </span>
              </>
            ) : null}
            {detail.poCode ? (
              <>
                <IdentSep />
                <span>
                  PO <IdentCode>{detail.poCode}</IdentCode>
                </span>
              </>
            ) : null}
          </DocIdent>
          <PrFacts detail={detail} pendingChanges={pendingChanges} />
        </div>
      </div>

      <RelatedDocsPanel module="purchase-requests" id={detail.id} />

      {/* ADR-197 — who did what to this PR, with before → after and reasons. */}
      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-hdr">
          <div className="panel-title">History</div>
        </div>
        <DocumentHistory entity="PurchaseRequest" entityId={detail.id} refId={detail.code} />
      </div>

      {closeOpen ? (
        <CloseBalanceModal
          code={detail.code}
          bal={bal}
          pending={closeBalanceMut.isPending}
          errorText={closeError}
          onCancel={() => {
            setCloseError(null);
            setCloseOpen(false);
          }}
          onSubmit={onCloseBalance}
        />
      ) : null}
    </div>
  );
}

/** The PR's facts: four clusters, one line each, in the order the request is
 *  worked — how much (ending on what is still to order), when, from whom at
 *  what estimate (ending on the amount), and anything else. Create and Edit
 *  lay their fields on the same four clusters. PR Type is a header chip, so it
 *  is not repeated here. */
function PrFacts(props: {
  detail: PurchaseRequestDetail;
  pendingChanges: readonly DocumentEditChange[];
}): React.JSX.Element {
  const { detail, pendingChanges } = props;
  // Money hidden for L1 Viewers: the API nulls estCost, so the cost fields are
  // dropped entirely (not shown as '—').
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = detail.priceVisible === false;
  const estCostNum = Number(detail.estCost ?? 0);
  const qtyNum = Number(detail.qty);
  const total = estCostNum * qtyNum;
  const bal = prOrderBalance(detail);
  const vendorCode = detail.vendorCode ?? detail.vendorCodeText ?? null;
  const vendorText = [vendorCode, detail.vendorName].filter(Boolean).join(' — ');
  return (
    <>
      {/* A negative balance means MORE has been ordered than was requested. It is
          never normal, so it is said out loud here instead of being clamped to
          zero and hidden — somebody has to open the POs and fix one. */}
      {bal.state === 'over' ? (
        <div
          style={{
            color: 'var(--red2)',
            background: 'var(--red3)',
            border: '1px solid var(--sig-critical-bd)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            margin: '8px 0',
            fontWeight: 600,
          }}
        >
          ⚠ Over-ordered — {bal.ordered} of {bal.qty} is already on purchase orders,{' '}
          {Math.abs(bal.balance)} more than this request asked for. Check the linked POs.
        </div>
      ) : null}
      {/* Deliberately finished, NOT fully ordered. Grey, not green: nobody
          should read this as "we bought it all". The reason is on the face of
          the page because in six months "why did we not buy the other 90?" is
          the only question anyone asks. */}
      {bal.closed ? (
        <div
          style={{
            color: 'var(--text2)',
            background: 'var(--bg3)',
            border: '1px solid var(--border2)',
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 12,
            margin: '8px 0',
          }}
        >
          <div className="fw-700">🚫 {prBalanceClosedText(bal)}</div>
          <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
            <span className="form-label">Reason</span> {bal.closedReason ?? '—'}
          </div>
          {bal.closedAt ? (
            <div className="text3" style={{ marginTop: 2 }}>
              Closed on <span className="mono">{fmtDate(bal.closedAt)}</span>. The {bal.ordered}{' '}
              already on purchase orders still stands.
            </div>
          ) : null}
        </div>
      ) : null}
      <ClusterGrid>
        {/* An account that adds up: PR Qty − On PO − Short closed = Pending.
            Pending is the number that decides whether another PO is needed. */}
        <Cluster name="Quantity">
          <ClusterFact
            label="PR Qty"
            num
            value={String(detail.qty)}
            after={<Chip changes={pendingChanges} field="qty" />}
          />
          <ClusterFact
            label="On PO"
            num
            title="On live purchase orders (cancelled POs not counted)"
            value={String(bal.ordered)}
          />
          <ClusterFact
            label="Short closed"
            num
            empty={!bal.closed}
            title={bal.closed ? prBalanceClosedText(bal) : 'Nothing short closed'}
            value={bal.closed ? String(bal.closedQty) : '—'}
          />
          <ClusterFact
            label="Pending"
            num
            lead
            title={
              bal.closed
                ? prBalanceClosedText(bal)
                : `${bal.label} — ${bal.balance} of ${bal.qty} still to order`
            }
            value={
              <span style={{ color: prBalanceColor(bal.state) }}>
                {bal.balance < 0 ? `⚠ ${bal.balance}` : String(bal.balance)}
                {/* Short closed: the banner above already says so. */}
                {bal.closed ? null : (
                  <span className="text3" style={{ fontWeight: 400, fontFamily: 'var(--bfont)' }}>
                    {' '}
                    · {bal.label}
                  </span>
                )}
              </span>
            }
          />
        </Cluster>

        {/* The dates in the order they happen, ending on when it is needed. */}
        <Cluster name="Schedule">
          <ClusterFact
            label="PR Date"
            num
            value={fmtDate(detail.prDate)}
            after={<Chip changes={pendingChanges} field="prDate" />}
          />
          <ClusterFact
            label="Approved At"
            num
            empty={!detail.approvedAt}
            value={fmtDateTime(detail.approvedAt)}
          />
          <ClusterFact
            label="PO Created At"
            num
            empty={!detail.poCreatedAt}
            value={fmtDateTime(detail.poCreatedAt)}
          />
          <ClusterFact
            label="Due Date"
            num
            empty={!detail.requiredDate}
            value={fmtDate(detail.requiredDate)}
            after={<Chip changes={pendingChanges} field="requiredDate" />}
          />
        </Cluster>

        {/* Who supplies it and the estimate: rate × qty, ending on the amount.
            The vendor's address is on hover — it belongs on the PO, not here. */}
        <Cluster name="Vendor">
          <ClusterFact
            label="Vendor"
            span={priceHidden ? 4 : 2}
            empty={!vendorText}
            title={
              vendorText
                ? `${vendorText}\n${detail.vendorAddress ?? 'No address on the vendor master'}`
                : undefined
            }
            value={vendorText || '—'}
            after={<Chip changes={pendingChanges} field="vendor" />}
          />
          {priceHidden ? null : (
            <>
              <ClusterFact
                label="Est. Rate (₹)"
                num
                empty={!(estCostNum > 0)}
                value={estCostNum > 0 ? inr(estCostNum) : '—'}
                after={<Chip changes={pendingChanges} field="estCost" />}
              />
              <ClusterFact
                label="Est. Amount"
                num
                lead
                empty={!(total > 0)}
                value={total > 0 ? inr(total) : '—'}
              />
            </>
          )}
        </Cluster>

        <Cluster name="Notes">
          <ClusterFact
            label="Operation"
            empty={!detail.operation}
            title={detail.operation ?? undefined}
            value={detail.operation ?? '—'}
            after={<Chip changes={pendingChanges} field="operation" />}
          />
          <ClusterFact
            label="Remarks"
            span={3}
            wrap
            empty={!detail.remarks}
            value={detail.remarks ?? '—'}
            after={<Chip changes={pendingChanges} field="remarks" />}
          />
        </Cluster>
      </ClusterGrid>
    </>
  );
}

const inr = (n: number): string =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** ADR-202 — the amber "→ after" chip for a record field with a staged edit
 *  waiting for approval. Matched on the PR edit diff's field key. Renders
 *  nothing when no edit is pending for that field. */
function Chip(props: {
  changes: readonly DocumentEditChange[];
  field: string;
}): React.JSX.Element | null {
  const c = headerPendingChange(props.changes, props.field);
  return c ? <PendingChangeChip after={c.after} /> : null;
}
