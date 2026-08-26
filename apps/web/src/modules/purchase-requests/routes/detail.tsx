// PR detail page (UI-003-04).
//
// Styling follows the Sales Order detail screen (modules/sales-orders/routes/
// detail.tsx), which is the app-wide style reference: shared `.panel` /
// `.panel-hdr` / `.panel-body` chrome, `.form-label` fact strips, `.btn`
// actions, and colours taken only from the tokens in styles/tokens.css. The
// former page-local `.prd-*` stylesheet (a duplicated palette + type scale with
// ten hard-coded hexes) is gone — nothing here paints outside the theme.

import type { PurchaseRequestDetail } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, FileText, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePurchaseRequest, useSoftDeletePurchaseRequest } from '../api';
import { PrStatusBadge } from '../components/pr-status-badge';

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
  // Create PO is a PURCHASE ORDER action that merely starts from this PR, so it
  // follows po_create — not pr_create. The page it opens
  // (/purchase-orders/from-pr) guards on po_create.entry, and a button gated on
  // a different key than its destination is the "button that only fails on
  // click" pattern this whole pass exists to remove.
  const canCreatePo = effectiveFormPerms(eff, 'po_create').entry;
  const softDelete = useSoftDeletePurchaseRequest();
  const [confirmDelete, setConfirmDelete] = useState(false);

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
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Purchase request not found'}
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
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  const onDelete = (): void => {
    softDelete.mutate(detail.id, {
      onSuccess: () => {
        void navigate({ to: '/purchase-requests', replace: true });
      },
    });
  };

  // Tier-driven, per department (Purchase). Raising the PO off this PR is an
  // entry right; changing the PR itself is an edit right.
  const canEdit = perms.edit;
  // Delete is not one of the four tier actions, so it is expressed as the pair
  // only L5 Department Admin and above hold: edit AND approve. L3 has edit
  // without approve; L4 has approve without edit.
  const canDelete = perms.edit && perms.approve;
  const linkedToPo = detail.poId !== null;

  // The SO this PR serves. Set by Planning (an OSP PR raised off a Job Card
  // carries its SO line); a hand-raised PR has no order behind it, so "—".
  const soNo = detail.soCode
    ? `${detail.soCode}${detail.soLineNo ? ` · Ln ${detail.soLineNo}` : ''}`
    : '—';
  const jcNo = detail.sourceJcCode
    ? `${detail.sourceJcCode}${detail.sourceJcOpSeq ? ` · Op ${detail.sourceJcOpSeq}` : ''}`
    : '—';
  const vendorCode = detail.vendorCode ?? detail.vendorCodeText ?? '—';
  const itemCode = detail.itemCode ?? detail.itemCodeText ?? '—';

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
              {detail.itemName ?? detail.itemCodeText ?? 'Untitled item'}
              <PrStatusBadge status={detail.status} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <AssignTaskButton
              linkedRef={{
                type: 'purchase_request',
                id: detail.id,
                display: `PR ${detail.code}`,
                navPage: `/purchase-requests/${detail.id}`,
              }}
              suggestedTitle={`Follow up on PR ${detail.code}`}
            />
            {(detail.status === 'open' || detail.status === 'approved') &&
            !linkedToPo &&
            canCreatePo ? (
              <Link
                to="/purchase-orders/from-pr"
                search={{ prId: detail.id }}
                className="btn btn-primary btn-sm"
              >
                <FileText size={13} /> Create PO
              </Link>
            ) : null}
            {linkedToPo && detail.poId ? (
              // Once a PO exists this PR is locked — surface the PO to view
              // instead of Create PO, and hide Edit below.
              <Link
                to="/purchase-orders/$id"
                params={{ id: detail.poId }}
                className="btn btn-primary btn-sm"
              >
                <FileText size={13} /> View linked PO
              </Link>
            ) : null}
            {canEdit && !linkedToPo ? (
              <Link
                to="/purchase-requests/$id/edit"
                params={{ id: detail.id }}
                className="btn btn-ghost btn-sm"
              >
                <Pencil size={13} /> Edit
              </Link>
            ) : null}
            {canDelete ? (
              confirmDelete ? (
                <>
                  <span className="text3" style={{ fontSize: 12, alignSelf: 'center' }}>
                    Delete?
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={onDelete}
                    disabled={softDelete.isPending}
                  >
                    {softDelete.isPending ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setConfirmDelete(false)}
                    disabled={softDelete.isPending}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => setConfirmDelete(true)}
                  disabled={linkedToPo}
                  title={linkedToPo ? 'PR has a linked PO — cancel instead of delete' : undefined}
                >
                  <Trash2 size={13} /> Delete
                </button>
              )
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          {softDelete.isError ? (
            <div
              style={{
                color: 'var(--red)',
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
                : 'Failed to delete purchase request.'}
            </div>
          ) : null}
          {/* The six facts a buyer scans for, in the SO detail strip idiom. */}
          <div style={STRIP}>
            <Fact label="SO No." title={soNo} value={<span className="mono">{soNo}</span>} />
            <Fact
              label="Item Code"
              title={itemCode}
              value={<span className="mono">{itemCode}</span>}
            />
            <Fact label="Item Name" title={detail.itemName ?? '—'} value={detail.itemName ?? '—'} />
            <Fact
              label="Vendor"
              value={
                <>
                  <span className="mono">{vendorCode}</span>
                  <div>{detail.vendorName ?? '—'}</div>
                  {detail.vendorAddress ? (
                    <div className="text2" style={{ fontWeight: 400, fontSize: 12 }}>
                      {detail.vendorAddress}
                    </div>
                  ) : (
                    <div className="text3" style={{ fontWeight: 400, fontSize: 12 }}>
                      No address on the vendor master
                    </div>
                  )}
                </>
              }
            />
            <Fact label="Source JC" title={jcNo} value={<span className="mono">{jcNo}</span>} />
            <Fact
              label="PR Date"
              title={detail.prDate}
              value={<span className="mono">{detail.prDate}</span>}
            />
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title" style={{ color: 'var(--blue)', textTransform: 'uppercase' }}>
            Request detail
          </div>
        </div>
        <div className="panel-body">
          <OtherDetail detail={detail} />
        </div>
      </div>

      <RelatedDocsPanel module="purchase-requests" id={detail.id} />
    </div>
  );
}

/** Fact strip layout — the same wrap/gap the SO detail screen uses. */
const STRIP: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  gap: '10px 24px',
};

function OtherDetail(props: { detail: PurchaseRequestDetail }): React.JSX.Element {
  const { detail } = props;
  // Money hidden for L1 Viewers: the API nulls estCost, so the cost fields are
  // dropped entirely (not shown as '—').
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = detail.priceVisible === false;
  const estCostNum = Number(detail.estCost ?? 0);
  const qtyNum = Number(detail.qty);
  const total = estCostNum * qtyNum;
  return (
    <>
      <div style={STRIP}>
        <Fact label="Qty" value={<span className="mono">{String(detail.qty)}</span>} />
        {priceHidden ? null : (
          <>
            <Fact
              label="Est. Cost / pc"
              value={<span className="mono">{estCostNum > 0 ? inr(estCostNum) : '—'}</span>}
            />
            <Fact
              label="Total Est."
              value={<span className="mono">{total > 0 ? inr(total) : '—'}</span>}
            />
          </>
        )}
        <Fact
          label="Required Date"
          value={<span className="mono">{detail.requiredDate ?? '—'}</span>}
        />
        <Fact label="Operation" value={detail.operation ?? '—'} />
        <Fact label="PR Type" value={detail.prType ?? '—'} />
        <Fact label="Linked PO" value={<span className="mono">{detail.poCode ?? '—'}</span>} />
        <Fact label="Status" value={detail.status} />
        <Fact
          label="Approved At"
          value={<span className="mono">{detail.approvedAt ?? '—'}</span>}
        />
        <Fact
          label="PO Created At"
          value={<span className="mono">{detail.poCreatedAt ?? '—'}</span>}
        />
      </div>
      <div className="divider" />
      <div style={{ minWidth: 0 }}>
        <span className="form-label">Remarks</span>
        <div style={{ whiteSpace: 'pre-wrap' }}>{detail.remarks ?? '—'}</div>
      </div>
    </>
  );
}

const inr = (n: number): string =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Fact(props: { label: string; value: React.ReactNode; title?: string }): React.JSX.Element {
  return (
    <div style={{ minWidth: 0 }} title={props.title}>
      <span className="form-label">{props.label}</span>
      <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{props.value}</div>
    </div>
  );
}
