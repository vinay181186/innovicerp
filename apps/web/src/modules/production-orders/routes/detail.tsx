// Production Order detail (ADR-170, ADR-182): the header facts, the live Job
// Card progress, and — for an open order whose JC is complete — the Close
// button.
//
// Close is BLOCKED until the JC is complete; the server says so through
// `canClose` / `closeBlockedReason`, and the page only repeats that answer.
// On close stock is credited ONCE with the JC's actually finished qty (48 of
// 50 → 48), which is why the confirm names that number before asking.
//
// ADR-182 adds SHORT CLOSE — stop the order at ANY stage. It is a different
// thing from "close short": nothing is credited or written off, the order and
// its Job Card are frozen, and the un-produced qty goes back to the plan. Once
// an order is short closed the Close form and the ledger's Reverse buttons go
// away, and a red panel says who stopped it, when and why.

import { isProductionOrderStopped } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { JcStatusBadge } from '@/modules/job-cards/components/jc-status-badge';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ActionMenu, DetailHeader } from '@/ui/layout';
import { useProductionOrder } from '../api';
import { PoCloseForm } from '../components/po-close-form';
import { PoCloseLedger } from '../components/po-close-ledger';
import { PoShortCloseModal } from '../components/po-short-close-modal';
import { PoStatusBadge } from '../components/po-status-badge';

export const productionOrderDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'production-orders/$id',
  component: ProductionOrderDetailPage,
});

function Fact({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="form-grp">
      <span className="form-label">{label}</span>
      <div className={mono ? 'mono fw-700' : undefined} style={{ color: 'var(--text)' }}>
        {children}
      </div>
    </div>
  );
}

function ProductionOrderDetailPage(): React.JSX.Element {
  const { id } = productionOrderDetailRoute.useParams();
  const { data, isLoading, isError, error } = useProductionOrder(id);
  const [shortCloseOpen, setShortCloseOpen] = useState(false);

  // Tier-driven (Production). Close is an EDIT on the order, not an entry.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'prodorder_create');

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading Production Order…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/production-orders" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Production Order not found.'}
          </div>
        </div>
      </div>
    );
  }

  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Production Orders. Ask an admin.
      </div>
    );
  }

  // ADR-182 — a short-closed order is dead: no close, no reversal, and no work
  // on its Job Card. Everything this page offers hangs off that one answer,
  // read from the shared enum helper so the screen and the server agree on
  // what "stopped" means.
  const stopped = isProductionOrderStopped(data.status);
  // ADR-179: close is progressive. It stays available while the order is not
  // fully closed and the server still allows it (`canClose`).
  const notClosed = data.status !== 'closed';
  const showCloseForm = !stopped && notClosed && perms.edit && data.canClose;
  // Short Close is offered at ANY stage except an order already stopped — the
  // ask is "at any stage". Same `edit` right as Close.
  const showShortCloseButton = !stopped && perms.edit;
  const pct =
    data.orderQty > 0 ? Math.min(100, Math.round((data.jcFinishedQty / data.orderQty) * 100)) : 0;

  return (
    <div>
      {/* DetailHeader layout: Back link, code + status, one shortcut to the
          order's Job Card, and Short Close in the Actions menu (red, last). */}
      <DetailHeader
        backLabel="Back"
        backTo="/production-orders"
        renderLink={(p) => <Link {...p} />}
        code={data.code}
        name="Production Order"
        badges={<PoStatusBadge status={data.status} />}
        actions={
          <>
            <Link
              to="/job-cards/$id"
              params={{ id: data.jobCardId }}
              className="btn btn-ghost btn-sm"
              title={`Open Job Card ${data.jcCodeText}`}
            >
              Open Job Card
            </Link>
            <ActionMenu
              items={[
                {
                  label: 'Short Close',
                  danger: true,
                  hidden: !showShortCloseButton,
                  title:
                    'Stop this Production Order — its Job Card is frozen and the un-produced qty goes back to the plan',
                  onClick: () => setShortCloseOpen(true),
                },
              ]}
            />
          </>
        }
      >
        {!stopped && notClosed && !data.canClose && data.closeBlockedReason ? (
          <div
            className="text3"
            style={{
              fontSize: 12,
              padding: '6px 10px',
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              marginBottom: 10,
            }}
          >
            🔒 Cannot close yet — {data.closeBlockedReason}
          </div>
        ) : null}

        <div className="form-grid form-grid-4">
          <Fact label="Plan No.">
            <Link
              to="/plans/$id"
              params={{ id: data.planId }}
              className="mono fw-700"
              style={{ color: 'var(--cyan)', textDecoration: 'none' }}
            >
              {data.planCodeText}
            </Link>
          </Fact>
          <Fact label="SO / JWSO No." mono>
            {data.soCodeText ? (
              <>
                {data.soCodeText}
                {data.lineNo ? <span className="text3"> · Ln {data.lineNo}</span> : null}
              </>
            ) : (
              '—'
            )}
          </Fact>
          <Fact label="Customer">{data.partyName ?? '—'}</Fact>
          <Fact label="Customer Dispatch Date" mono>
            {fmtDate(data.targetDate)}
          </Fact>

          {/* POL — the line number printed on the CUSTOMER's own purchase
                order. NOT our SO line number ("Ln n" above); on live data
                our line 11 is the customer's line 20. Sits before the item
                code, as on every other document. */}
          <Fact label="POL" mono>
            <span className="fw-700" style={{ color: 'var(--purple)' }}>
              {data.clientPoLineNo ?? '—'}
            </span>
          </Fact>
          <Fact label="Item Code" mono>
            {/* CODE/REV (ADR-177); bare code when the line has no revision. */}
            {itemCodeWithRev(data.itemCodeText, data.itemRevision)}
          </Fact>
          <div className="form-grp form-span-2">
            <span className="form-label">Item Name</span>
            <div className="fw-700" style={{ color: 'var(--text)' }}>
              {data.itemNameText ?? '—'}
            </div>
          </div>
          {/* The Production Order's own qty (the list calls it Order Qty).
                Was mislabelled "Plan Qty" — the plan's qty can be larger when
                several orders cover one plan (ADR-182). */}
          <Fact label="Order Qty" mono>
            {data.orderQty}
          </Fact>
          {/* Raw material the order is cut from — read off its plan (same
                labels as Plan detail). */}
          <Fact label="RM Grade">{data.rawMaterialGradeText ?? '—'}</Fact>
          <Fact label="RM Size">{data.rawMaterialSizeText ?? '—'}</Fact>
          {/* ADR-182 — the shop floor's confirmation at Create, and the size
                the store really cut (RM size above is the planned one). */}
          <Fact label="Raw Material Available">
            {data.rawMaterialAvailable ? (
              <span style={{ color: 'var(--green2)' }}>✓ Yes</span>
            ) : (
              <span style={{ color: 'var(--red2)' }}>✗ No</span>
            )}
          </Fact>
          <Fact label="Actual Size" mono>
            {data.actualSize ?? '—'}
          </Fact>

          <Fact label="Route Card">
            <Link
              to="/route-cards/$id"
              params={{ id: data.routeCardId }}
              className="mono fw-700"
              style={{ color: 'var(--cyan)', textDecoration: 'none' }}
            >
              {data.routeCardCodeText}
            </Link>
            <span className="text3" style={{ fontSize: 11 }}>
              {' '}
              · Route Card Rev {data.routeCardRevision}
            </span>
          </Fact>
          <Fact label="JC No.">
            <Link
              to="/job-cards/$id"
              params={{ id: data.jobCardId }}
              className="mono fw-700"
              style={{ color: 'var(--cyan)', textDecoration: 'none' }}
            >
              {data.jcCodeText}
            </Link>
          </Fact>
          <Fact label="Created By">
            {data.createdByName ?? '—'}
            <span className="text3 mono" style={{ fontSize: 11 }}>
              {' '}
              · {fmtDate(data.createdAt)}
            </span>
          </Fact>
          <Fact label="Remarks">{data.remarks ?? '—'}</Fact>
        </div>
      </DetailHeader>

      {/* ADR-182 — the order was stopped. High on the page, because it changes
          what every panel under it means. Grey, like its Short Closed badge. */}
      {stopped ? (
        <div className="panel" style={{ marginTop: 12, borderLeft: '3px solid var(--text3)' }}>
          <div className="panel-hdr">
            <div className="panel-title">
              Short Closed on {fmtDate(data.shortClosedAt)} by {data.shortClosedByName ?? '—'} —{' '}
              {data.shortCloseReason ?? '—'}
            </div>
          </div>
          <div className="panel-body">
            <div className="text2" style={{ fontSize: 12, lineHeight: 1.6 }}>
              {data.creditedQty ?? 0} credited stay in stock;{' '}
              {Math.max(0, data.orderQty - (data.creditedQty ?? 0))} Pending went back to Plan{' '}
              <span className="mono fw-700">{data.planCodeText}</span>.
            </div>
          </div>
        </div>
      ) : null}

      {/* JC progress — read live off the Job Card on every load, never stored. */}
      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-hdr">
          <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Job Card Progress
            {data.jcComputedStatus ? (
              <JcStatusBadge status={data.jcComputedStatus} />
            ) : (
              <span className="badge b-grey">No Job Card</span>
            )}
          </div>
          <div
            className="mono fw-700"
            style={{ fontSize: 14, color: 'var(--text)', cursor: 'help' }}
            title="Finished qty = output of the Job Card's last op (QC-accepted if it is QC). Close credits this qty to stock."
          >
            {data.jcFinishedQty} <span className="text3">/ {data.orderQty}</span>
          </div>
        </div>
        <div className="panel-body">
          <div
            style={{
              height: 8,
              background: 'var(--bg4)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
            title={`${pct}% completed`}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: pct >= 100 ? 'var(--green)' : 'var(--cyan)',
              }}
            />
          </div>
          {data.jcClosedAt ? (
            <div className="text3" style={{ fontSize: 11, marginTop: 6 }}>
              JC closed on <span className="mono">{fmtDate(data.jcClosedAt)}</span>.
            </div>
          ) : null}
        </div>
      </div>

      {/* Close (progressive) — credit finished pieces as they come off the JC. */}
      {showCloseForm ? (
        <div className="panel" style={{ marginTop: 12, borderLeft: '3px solid var(--cyan)' }}>
          <div className="panel-hdr">
            <div className="panel-title">Close Production Order</div>
          </div>
          <div className="panel-body">
            <PoCloseForm po={data} />
          </div>
        </div>
      ) : null}

      {/* Close ledger — every partial close + reversal, newest first. */}
      {data.closes.length > 0 ? (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-hdr">
            <div className="panel-title">Close Ledger ({data.closes.length})</div>
            <div className="mono fw-700" style={{ fontSize: 13, color: 'var(--text)' }}>
              {data.creditedQty ?? 0} <span className="text3">/ {data.orderQty} credited</span>
            </div>
          </div>
          <div className="panel-body">
            {/* ADR-182 — nothing may be reversed on a stopped order either. */}
            <PoCloseLedger po={data} canReverse={perms.edit && !stopped} />
          </div>
        </div>
      ) : null}

      {data.status === 'closed' ? (
        <div className="panel" style={{ marginTop: 12, borderLeft: '3px solid var(--green)' }}>
          <div className="panel-hdr">
            <div className="panel-title">✓ Closed — stock credited</div>
          </div>
          <div className="panel-body">
            <div className="form-grid form-grid-3">
              <Fact label="Credited Qty" mono>
                {data.creditedQty ?? '—'}
              </Fact>
              <Fact label="Lost Qty" mono>
                {data.lostQty ?? '—'}
              </Fact>
              <Fact label="Close Date" mono>
                {fmtDate(data.closedAt)}
              </Fact>
            </div>
          </div>
        </div>
      ) : null}

      {shortCloseOpen ? (
        <PoShortCloseModal
          id={data.id}
          code={data.code}
          jcCode={data.jcCodeText}
          orderQty={data.orderQty}
          creditedQty={data.creditedQty ?? 0}
          onClose={() => setShortCloseOpen(false)}
        />
      ) : null}
    </div>
  );
}
