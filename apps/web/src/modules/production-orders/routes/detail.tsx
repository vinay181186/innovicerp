// Production Order detail (ADR-170): the header facts, the live Job Card
// progress, and — for an open order whose JC is complete — the Close button.
//
// Close is BLOCKED until the JC is complete; the server says so through
// `canClose` / `closeBlockedReason`, and the page only repeats that answer.
// On close stock is credited ONCE with the JC's actually finished qty (48 of
// 50 → 48), which is why the confirm names that number before asking.

import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { JcStatusBadge } from '@/modules/job-cards/components/jc-status-badge';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useProductionOrder } from '../api';
import { PoCloseForm } from '../components/po-close-form';
import { PoCloseLedger } from '../components/po-close-ledger';
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
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Production Order not found'}
          </div>
        </div>
      </div>
    );
  }

  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  // ADR-179: close is progressive. It stays available while the order is not
  // fully closed and the server still allows it (`canClose`).
  const notClosed = data.status !== 'closed';
  const showCloseForm = notClosed && perms.edit && data.canClose;
  const pct =
    data.orderQty > 0 ? Math.min(100, Math.round((data.jcFinishedQty / data.orderQty) * 100)) : 0;

  return (
    <div>
      <Link to="/production-orders" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Production Orders
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ fontSize: 16, color: 'var(--text)', fontWeight: 700 }}
            >
              {data.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}
            >
              🏭 Production Order
              <PoStatusBadge status={data.status} />
            </div>
          </div>
        </div>

        <div className="panel-body">
          {notClosed && !data.canClose && data.closeBlockedReason ? (
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
            <Fact label="Plan">
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
                  {data.lineNo ? <span className="text3"> / line {data.lineNo}</span> : null}
                </>
              ) : (
                '—'
              )}
            </Fact>
            <Fact label="Customer">{data.partyName ?? '—'}</Fact>
            <Fact label="Customer Dispatch Date" mono>
              {data.targetDate}
            </Fact>

            {/* POL — the line number printed on the CUSTOMER's own purchase
                order. NOT our SO line number ("/ line n" above); on live data
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
            <Fact label="Order Qty" mono>
              {data.orderQty}
            </Fact>
            {/* Raw material the order is cut from — read off its plan (same
                labels as Plan detail). */}
            <Fact label="RM grade">{data.rawMaterialGradeText ?? '—'}</Fact>
            <Fact label="RM size">{data.rawMaterialSizeText ?? '—'}</Fact>

            <Fact label="Route card">
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
                · Rev {data.routeCardRevision}
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
                · {data.createdAt.slice(0, 10)}
              </span>
            </Fact>
            <Fact label="Remarks">{data.remarks ?? '—'}</Fact>
          </div>
        </div>
      </div>

      {/* JC progress — read live off the Job Card on every load, never stored. */}
      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-hdr">
          <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            ▭ Job Card progress
            {data.jcComputedStatus ? (
              <JcStatusBadge status={data.jcComputedStatus} />
            ) : (
              <span className="badge b-grey">no job card</span>
            )}
          </div>
          <div className="mono fw-700" style={{ fontSize: 14, color: 'var(--text)' }}>
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
            title={`${pct}% finished`}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: pct >= 100 ? 'var(--green)' : 'var(--cyan)',
              }}
            />
          </div>
          <div className="text3" style={{ fontSize: 11, marginTop: 6 }}>
            Finished qty is the output of the Job Card&apos;s last operation (QC-accepted where the
            last op is QC). This is the qty Close will credit to stock.
            {data.jcClosedAt ? (
              <>
                {' '}
                JC closed on <span className="mono">{data.jcClosedAt.slice(0, 10)}</span>.
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Close (progressive) — credit finished pieces as they come off the JC. */}
      {showCloseForm ? (
        <div className="panel" style={{ marginTop: 12, borderLeft: '3px solid var(--cyan)' }}>
          <div className="panel-hdr">
            <div className="panel-title">🔒 Close Production Order</div>
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
            <div className="panel-title">📒 Close ledger ({data.closes.length})</div>
            <div className="mono fw-700" style={{ fontSize: 13, color: 'var(--text)' }}>
              {data.creditedQty ?? 0} <span className="text3">/ {data.orderQty} credited</span>
            </div>
          </div>
          <div className="panel-body">
            <PoCloseLedger po={data} canReverse={perms.edit} />
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
              <Fact label="Credited qty" mono>
                {data.creditedQty ?? '—'}
              </Fact>
              <Fact label="Lost qty" mono>
                {data.lostQty ?? '—'}
              </Fact>
              <Fact label="Closed on" mono>
                {data.closedAt ? data.closedAt.slice(0, 10) : '—'}
              </Fact>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
