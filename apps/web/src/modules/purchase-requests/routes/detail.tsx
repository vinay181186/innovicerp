// PR detail page (UI-003-04).
//
// Compact layout: the six facts a buyer actually scans for — SO No, Item Code,
// Item Name, Vendor, Source JC, PR Date — get their own boxes at the top, and
// everything else sits in ONE card below instead of a loose 3-column grid with
// a full row of dead space between each pair.
//
// Styles are scoped under `.prd-` and live in this file, matching the compact
// Create-PO screen. NOTE: that palette/type scale is now duplicated across two
// files — if a third screen adopts it, lift these into tokens.css rather than
// copying again.

import type { PurchaseRequestDetail } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, FileText, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePurchaseRequest, useSoftDeletePurchaseRequest } from '../api';
import { PrStatusBadge } from '../components/pr-status-badge';

export const purchaseRequestDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-requests/$id',
  component: PurchaseRequestDetailPage,
});

const CSS = `
/* Negative margin MUST equal #content's padding (20px, 12px under 768px in
   innovic-theme.css) or the page gains a horizontal scrollbar. Sides and bottom
   only — a negative top would ride over the breadcrumb trail. */
.prd-page{ background:#eef1f6; margin:0 -20px -20px; padding:14px 26px 26px;
  min-height:100%; box-sizing:border-box;
  font-family:'Public Sans',var(--bfont),sans-serif; color:#1c2333; }
@media (max-width:768px){ .prd-page{ margin:0 -12px -12px; padding:12px; } }
.prd-wrap{ max-width:1180px; margin:0 auto; }
.prd-num{ font-family:'JetBrains Mono',var(--mono),monospace; }

.prd-card{ background:#fff; border:1px solid #e4e7ee; border-radius:12px;
  padding:14px 16px; margin-bottom:12px; }
.prd-hdr{ display:flex; align-items:flex-start; justify-content:space-between; gap:12px;
  flex-wrap:wrap; }
.prd-code{ font-family:'JetBrains Mono',var(--mono),monospace; font-size:16px; font-weight:700;
  color:#2054a8; line-height:1.3; }
.prd-sub{ display:flex; align-items:center; gap:9px; margin-top:2px;
  font-size:13.5px; font-weight:600; color:#1c2333; }
.prd-acts{ display:flex; gap:6px; flex-wrap:wrap; }

/* The six scanned facts — a box each. Vendor is wider: it stacks code, name
   and postal address. */
.prd-key{ display:grid; gap:10px; margin-bottom:12px;
  grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.3fr) minmax(0,2fr)
                        minmax(0,1.1fr) minmax(0,.9fr); }
@media (max-width:1100px){ .prd-key{ grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media (max-width:640px){ .prd-key{ grid-template-columns:repeat(2,minmax(0,1fr)); } }
.prd-box{ background:#fff; border:1px solid #e4e7ee; border-radius:9px; padding:8px 11px;
  min-width:0; }
.prd-box-l{ font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em;
  color:#8b93a2; line-height:1.5; margin-bottom:1px; }
.prd-box-v{ font-size:13px; font-weight:600; color:#1c2333; line-height:1.45;
  overflow-wrap:anywhere; }
.prd-box-sub{ font-size:11.5px; font-weight:400; color:#5a6376; line-height:1.45;
  overflow-wrap:anywhere; }
.prd-muted{ color:#8b93a2; font-weight:400; }

/* Everything else — one card, tight pairs, no dead rows. */
.prd-grid{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:11px 18px; }
@media (max-width:900px){ .prd-grid{ grid-template-columns:repeat(2,minmax(0,1fr)); } }
.prd-pair{ min-width:0; }
.prd-pair-l{ font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em;
  color:#8b93a2; line-height:1.5; }
.prd-pair-v{ font-size:13px; font-weight:600; color:#1c2333; line-height:1.45;
  overflow-wrap:anywhere; }
.prd-full{ grid-column:1/-1; }
.prd-sect{ font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em;
  color:#8b93a2; margin-bottom:9px; }
.prd-rule{ border:0; border-top:1px solid #eef1f6; margin:12px 0; }

.prd-msg{ border-radius:7px; padding:8px 12px; font-size:12.5px; margin-bottom:10px;
  background:#fdecea; border:1px solid #f5c2bc; color:#a4291c; }
`;

function PurchaseRequestDetailPage(): React.JSX.Element {
  const { id } = purchaseRequestDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = usePurchaseRequest(id);
  const { data: me } = useSession();
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

  const onDelete = (): void => {
    softDelete.mutate(detail.id, {
      onSuccess: () => {
        void navigate({ to: '/purchase-requests', replace: true });
      },
    });
  };

  const canEdit = me?.role === 'admin' || me?.role === 'manager';
  const isAdmin = me?.role === 'admin';
  const linkedToPo = detail.poId !== null;

  const soNo = detail.soCode
    ? `${detail.soCode}${detail.soLineNo ? ` · Ln ${detail.soLineNo}` : ''}`
    : '—';
  const jcNo = detail.sourceJcCode
    ? `${detail.sourceJcCode}${detail.sourceJcOpSeq ? ` · Op ${detail.sourceJcOpSeq}` : ''}`
    : '—';
  const vendorCode = detail.vendorCode ?? detail.vendorCodeText ?? '—';

  return (
    <div className="prd-page">
      <style>{CSS}</style>
      <div className="prd-wrap">
        <Link to="/purchase-requests" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
          <ArrowLeft size={14} /> Back to Purchase Requests
        </Link>

        {/* Header — identity + actions on one line. */}
        <div className="prd-card">
          <div className="prd-hdr">
            <div style={{ minWidth: 0 }}>
              <div className="prd-code">{detail.code}</div>
              <div className="prd-sub">
                {detail.itemName ?? detail.itemCodeText ?? 'Untitled item'}
                <PrStatusBadge status={detail.status} />
              </div>
            </div>
            <div className="prd-acts">
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
              canWrite(me?.role) ? (
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
              {isAdmin ? (
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
        </div>

        {softDelete.isError ? (
          <div className="prd-msg">
            {softDelete.error instanceof Error
              ? softDelete.error.message
              : 'Failed to delete purchase request.'}
          </div>
        ) : null}

        {/* The six scanned facts, one box each. */}
        <div className="prd-key">
          <Box label="SO No." value={soNo} mono />
          <Box label="Item Code" value={detail.itemCode ?? detail.itemCodeText ?? '—'} mono />
          <Box label="Item Name" value={detail.itemName ?? '—'} />
          <div className="prd-box">
            <div className="prd-box-l">Vendor</div>
            <div className="prd-box-v prd-num">{vendorCode}</div>
            <div className="prd-box-sub" style={{ fontWeight: 600, color: '#1c2333' }}>
              {detail.vendorName ?? '—'}
            </div>
            {detail.vendorAddress ? (
              <div className="prd-box-sub">{detail.vendorAddress}</div>
            ) : (
              <div className="prd-box-sub prd-muted">No address on the vendor master</div>
            )}
          </div>
          <Box label="Source JC" value={jcNo} mono />
          <Box label="PR Date" value={detail.prDate} mono />
        </div>

        {/* Everything else — one card. */}
        <div className="prd-card">
          <div className="prd-sect">Request Detail</div>
          <OtherDetail detail={detail} />
        </div>

        <RelatedDocsPanel module="purchase-requests" id={detail.id} />
      </div>
    </div>
  );
}

function canWrite(role: string | undefined): boolean {
  return role === 'admin' || role === 'manager';
}

function OtherDetail(props: { detail: PurchaseRequestDetail }): React.JSX.Element {
  const { detail } = props;
  // Money hidden for L1 Viewers: the API nulls estCost, so the cost fields are
  // dropped entirely (not shown as '—').
  const priceHidden = detail.estCost == null;
  const estCostNum = Number(detail.estCost ?? 0);
  const qtyNum = Number(detail.qty);
  const total = estCostNum * qtyNum;
  return (
    <>
      <div className="prd-grid">
        <Pair label="Qty" value={String(detail.qty)} mono />
        {priceHidden ? null : (
          <>
            <Pair label="Est. Cost / pc" value={estCostNum > 0 ? inr(estCostNum) : '—'} mono />
            <Pair label="Total Est." value={total > 0 ? inr(total) : '—'} mono />
          </>
        )}
        <Pair label="Required Date" value={detail.requiredDate ?? '—'} mono />
        <Pair label="Operation" value={detail.operation ?? '—'} />
        <Pair label="PR Type" value={detail.prType ?? '—'} />
        <Pair label="Linked PO" value={detail.poCode ?? '—'} mono />
        <Pair label="Status" value={detail.status} />
        <Pair label="Approved At" value={detail.approvedAt ?? '—'} mono />
        <Pair label="PO Created At" value={detail.poCreatedAt ?? '—'} mono />
      </div>
      <hr className="prd-rule" />
      <div className="prd-pair prd-full">
        <div className="prd-pair-l">Remarks</div>
        <div className="prd-pair-v" style={{ whiteSpace: 'pre-wrap', fontWeight: 400 }}>
          {detail.remarks ?? '—'}
        </div>
      </div>
    </>
  );
}

const inr = (n: number): string =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Box(props: { label: string; value: string; mono?: boolean }): React.JSX.Element {
  return (
    <div className="prd-box">
      <div className="prd-box-l">{props.label}</div>
      <div className={`prd-box-v${props.mono ? ' prd-num' : ''}`} title={props.value}>
        {props.value}
      </div>
    </div>
  );
}

function Pair(props: { label: string; value: string; mono?: boolean }): React.JSX.Element {
  return (
    <div className="prd-pair">
      <div className="prd-pair-l">{props.label}</div>
      <div className={`prd-pair-v${props.mono ? ' prd-num' : ''}`}>{props.value}</div>
    </div>
  );
}
