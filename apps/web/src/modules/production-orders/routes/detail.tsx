// Production Order detail (ADR-170, ADR-182): the order's facts, the live Job
// Card progress, and — while the order is open — Close Qty.
//
// Close is BLOCKED until the JC has finished pieces; the server says so through
// `canClose` / `closeBlockedReason`, and the page only repeats that answer.
// On close stock is credited ONCE with the JC's actually finished qty (48 of
// 50 → 48), which is why the close form names that number before asking.
//
// ADR-182 adds SHORT CLOSE — stop the order at ANY stage. It is a different
// thing from "close short": nothing is credited or written off, the order and
// its Job Card are frozen, and the un-produced qty goes back to the plan. Once
// an order is short closed Close Qty and the ledger's Reverse close go away,
// and a one-line banner says who stopped it, when and why.
//
// Layout (owner-approved mock-up pro-routecard-detail-mockup.html, 2026-10-06):
// the page fits one 1440×810 screen with no page scroll. Header with the next
// step as its primary button → identity line → one ClusterGrid read in the
// order the work happens (Order → Quantity → Schedule → Material) → ONE tabbed
// panel (Close Ledger | History) that takes the height left and scrolls inside.
// What moved: the Close form opens as a dialog from Close Qty…; Job Card
// Progress became the JC Finished cell; the Short Closed / Closed panels became
// a one-line banner where the Close button sits; "Cannot close yet" became the
// button's disabled reason.

import type { DocumentEditChange } from '@innovic/shared';
import { isProductionOrderStopped } from '@innovic/shared';
import { useIsMutating } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { DocumentHistory } from '@/components/shared/document-history';
import { useDocumentHistory } from '@/modules/activity-log/api';
import { usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  headerPendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { JC_STATUS_LABEL, JcStatusBadge } from '@/modules/job-cards/components/jc-status-badge';
import { authenticatedRoute } from '@/routes/_authenticated';
import { EmptyState, Panel, ProgressBar } from '@/ui/data';
import { Modal } from '@/ui/feedback';
import { Cluster, ClusterFact, ClusterGrid, DocIdent, IdentCode, IdentSep } from '@/ui/forms';
import { ActionMenu, DetailHeader } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
import { CLOSE_PRODUCTION_ORDER_MUTATION_KEY, useProductionOrder } from '../api';
import { PoCloseForm } from '../components/po-close-form';
import { PoCloseLedger } from '../components/po-close-ledger';
import { PoShortCloseModal } from '../components/po-short-close-modal';
import { PoStatusBadge } from '../components/po-status-badge';
import '../components/po-detail.css';

export const productionOrderDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'production-orders/$id',
  component: ProductionOrderDetailPage,
});

/** A staged header edit (ADR-202 Phase 3) waiting for approval, for one field:
 *  the amber "→ after" chip, and a hover text naming the proposed value in
 *  full. The chip is never cut short; a cell too narrow for it wraps. */
function pendingFor(
  changes: readonly DocumentEditChange[],
  field: string,
): { chip: React.ReactNode; title: string } | null {
  const c = headerPendingChange(changes, field);
  if (!c) return null;
  const after = c.after === null || c.after === '' ? '—' : String(c.after);
  return {
    chip: <PendingChangeChip after={c.after} />,
    title: `Waiting for approval: → ${after}`,
  };
}

/** Cell hover text: the value, then the pending change if there is one. */
function withPending(value: string, p: { title: string } | null): string {
  return p ? `${value} · ${p.title}` : value;
}

type TabKey = 'ledger' | 'history';

function ProductionOrderDetailPage(): React.JSX.Element {
  const { id } = productionOrderDetailRoute.useParams();
  const { data, isLoading, isError, error } = useProductionOrder(id);
  const [shortCloseOpen, setShortCloseOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>('ledger');
  const closeWhyId = useId();

  // Tier-driven (Production). Close is an EDIT on the order, not an entry.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'prodorder_create');

  // ADR-202 Phase 3 — staged header edits waiting for approval. Their per-field
  // changes drive the inline amber chips next to each editable fact below.
  const pendingEdit = usePendingEditForDoc('ProductionOrder', id);
  const pendingChanges = (pendingEdit.data?.rows ?? []).flatMap((r) => r.changes);

  // The History tab's count. Same arguments as <DocumentHistory> below, so it
  // is the same query — one request, not two.
  const history = useDocumentHistory({
    entity: 'ProductionOrder',
    entityId: data?.id,
    refId: data?.code,
  });

  // A close POST in flight. While it is, the Close dialog cannot be dismissed
  // and Close Qty… cannot be pressed: dismissing would unmount the form
  // mid-save (its error lost) and reopening would re-seed the qty from the
  // stale ceiling and allow a second POST — a double credit.
  const closing = useIsMutating({ mutationKey: CLOSE_PRODUCTION_ORDER_MUTATION_KEY }) > 0;

  // Whether Close is on offer at all — the same answer `showCloseForm` gives
  // below, worked out here (before the early returns) so the dialog's open
  // flag can follow it. ADR-182: never on a stopped order; ADR-179: not once
  // fully closed, and only while the server allows it (`canClose`).
  const closeOffered =
    !!data &&
    !isProductionOrderStopped(data.status) &&
    data.status !== 'closed' &&
    perms.edit &&
    data.canClose;
  // A refetch that takes Close away (someone else closed it, or credited the
  // last pieces) also forgets the dialog was open, so it can never reopen by
  // itself when Close comes back. Not while a save is in flight — that save
  // owns the dialog until it answers.
  useEffect(() => {
    if (!closeOffered && !closing) setCloseOpen(false);
  }, [closeOffered, closing]);

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
  // `closeOffered` (above) is that rule plus `perms.edit`, read before the
  // early returns so the dialog's open flag can follow it.
  const showCloseForm = closeOffered;
  // The server's reason Close is off — shown to everyone, as before; the
  // disabled button only to those who could otherwise press it.
  const closeBlockedReason =
    !stopped && notClosed && !data.canClose && data.closeBlockedReason
      ? data.closeBlockedReason
      : null;
  // Short Close is offered at ANY stage except an order already stopped — the
  // ask is "at any stage". Same `edit` right as Close.
  const showShortCloseButton = !stopped && perms.edit;
  // ADR-202 Phase 3 — header edit (with approval) is offered only while the
  // order is still open or partly closed; a closed / short-closed order is
  // frozen. Same `edit` right as Close. The server re-checks both.
  const canEdit = perms.edit && (data.status === 'open' || data.status === 'partially_closed');
  const pct =
    data.orderQty > 0 ? Math.min(100, Math.round((data.jcFinishedQty / data.orderQty) * 100)) : 0;
  const credited = data.creditedQty ?? 0;

  const pTarget = pendingFor(pendingChanges, 'targetDate');
  const pSize = pendingFor(pendingChanges, 'actualSize');
  const pRmAvail = pendingFor(pendingChanges, 'rawMaterialAvailable');
  const pRemarks = pendingFor(pendingChanges, 'remarks');

  const routeCardRev = `Route Card Rev ${data.routeCardRevision}`;
  // What the Job Card Progress panel said beside its bar, now the cell's hover
  // text (the badge may be cut short in a narrow cell, so it names it too).
  const jcFinishedTitle =
    (data.jcComputedStatus ? `JC Status: ${JC_STATUS_LABEL[data.jcComputedStatus]}. ` : '') +
    "Finished qty = output of the Job Card's last op (QC-accepted if it is QC). Close credits this qty to stock." +
    (data.jcClosedAt ? ` JC closed on ${fmtDate(data.jcClosedAt)}.` : '');

  // The texts the Short Closed / Closed panels carried, now one line each.
  const shortClosedText = `Short Closed on ${fmtDate(data.shortClosedAt)} by ${
    data.shortClosedByName ?? '—'
  } — ${data.shortCloseReason ?? '—'} · ${credited} credited stay in stock; ${Math.max(
    0,
    data.orderQty - credited,
  )} Pending went back to Plan ${data.planCodeText}.`;
  const closedText = `✓ Closed — stock credited · Credited Qty ${
    data.creditedQty ?? '—'
  } · Lost Qty ${data.lostQty ?? '—'} · Close Date ${fmtDate(data.closedAt)}`;

  // Where Close Qty… sits: the button, or — once the order is stopped or fully
  // closed — the one-line banner that replaces it.
  const closeSlot = stopped ? (
    <span className="po-banner" title={shortClosedText}>
      {shortClosedText}
    </span>
  ) : !notClosed ? (
    <span className="po-banner is-closed" title={closedText}>
      {closedText}
    </span>
  ) : (
    <>
      {closeBlockedReason ? (
        <span
          id={closeWhyId}
          className="po-close-why"
          title={`Cannot close yet — ${closeBlockedReason}`}
        >
          🔒 Cannot close yet — {closeBlockedReason}
        </span>
      ) : null}
      {perms.edit ? (
        // The wrapper carries the tooltip: a disabled button gets no hover.
        <span title={closeBlockedReason ?? undefined}>
          <button
            type="button"
            className="btn btn-success btn-sm"
            disabled={!data.canClose || closing}
            aria-describedby={closeBlockedReason ? closeWhyId : undefined}
            onClick={() => setCloseOpen(true)}
          >
            Close Qty…
          </button>
        </span>
      ) : null}
    </>
  );

  return (
    <div className="page-fill po-detail">
      <DetailHeader
        backLabel="Back"
        backTo="/production-orders"
        renderLink={(p) => <Link {...p} />}
        code={data.code}
        // One header line, as the mock-up draws it: code · document name ·
        // status. Passed as `badges` because DetailHeader's `name` takes a
        // second line, and that line is height this page does not have.
        badges={
          <>
            <span className="panel-title">Production Order</span>
            <PoStatusBadge status={data.status} />
          </>
        }
        actions={
          <>
            {/* Hidden only when the Job Card row is gone (no live status). */}
            {data.jcComputedStatus ? (
              <Link
                to="/job-cards/$id"
                params={{ id: data.jobCardId }}
                className="btn btn-ghost btn-sm"
                title={`Open Job Card ${data.jcCodeText}`}
              >
                Open Job Card {data.jcCodeText}
              </Link>
            ) : null}
            {canEdit ? (
              <Link
                to="/production-orders/$id/edit"
                params={{ id: data.id }}
                className="btn btn-ghost btn-sm"
                title="Edit this Production Order (Remarks, PRO Target Date, Actual Size, Raw Material Available)"
              >
                Edit
              </Link>
            ) : null}
            <ActionMenu
              label="⋯"
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
            {closeSlot}
          </>
        }
      >
        {/* WHICH order this is: the PRO, the item it makes, the SO / JWSO line
            it serves and the customer. Identity, not facts, so it heads the
            body instead of taking grid cells. */}
        <DocIdent>
          <IdentCode>{data.code}</IdentCode>
          <IdentSep />
          {/* CODE/REV (ADR-177); bare code when the line has no revision. */}
          <IdentCode>{itemCodeWithRev(data.itemCodeText, data.itemRevision)}</IdentCode>
          {data.itemNameText ? <span>{data.itemNameText}</span> : null}
          {data.soCodeText ? (
            <>
              <IdentSep />
              {/* ADR-207 — the system SO No. then the SO's own office number. */}
              <IdentCode>{soNoWithInternal(data.soCodeText, data.soInternalNo)}</IdentCode>
              {/* Ln is OUR sales-order line number. POL is the line number
                  printed on the CUSTOMER's own purchase order — on live data
                  our line 11 is the customer's line 20. Never the same fact. */}
              {data.lineNo ? <span>Ln {data.lineNo}</span> : null}
              {data.clientPoLineNo ? (
                <span>
                  POL{' '}
                  <b className="mono" style={{ color: 'var(--purple)' }}>
                    {data.clientPoLineNo}
                  </b>
                </span>
              ) : null}
            </>
          ) : null}
          {data.partyName ? (
            <>
              <IdentSep />
              <span>{data.partyName}</span>
            </>
          ) : null}
        </DocIdent>

        <ClusterGrid>
          {/* When it was raised, by whom, from which Plan and Route Card. */}
          <Cluster name="Order">
            <ClusterFact
              num
              label="Production Order Date"
              empty={!data.createdAt}
              value={fmtDate(data.createdAt)}
            />
            <ClusterFact
              className="po-one-line"
              label="Created By"
              empty={!data.createdByName}
              title={data.createdByName ?? undefined}
              value={data.createdByName ?? '—'}
            />
            <ClusterFact
              label="Plan No."
              value={
                <Link
                  to="/plans/$id"
                  params={{ id: data.planId }}
                  className="mono fw-700"
                  style={{ color: 'var(--cyan)', textDecoration: 'none' }}
                >
                  {data.planCodeText}
                </Link>
              }
            />
            <ClusterFact
              className="po-one-line"
              label="Route Card"
              title={`${data.routeCardCodeText} · ${routeCardRev}`}
              value={
                <>
                  <Link
                    to="/route-cards/$id"
                    params={{ id: data.routeCardId }}
                    className="mono fw-700"
                    style={{ color: 'var(--cyan)', textDecoration: 'none' }}
                  >
                    {data.routeCardCodeText}
                  </Link>{' '}
                  <span className="text3" style={{ fontSize: 'var(--fs-xs)', fontWeight: 400 }}>
                    {routeCardRev}
                  </span>
                </>
              }
            />
          </Cluster>

          {/* How much — the ladder (what the customer ordered, what the plan
              covers, what THIS order is for, what its Job Card has finished),
              then the close account that ends on Pending. `PRO Qty` not a bare
              `Order Qty` — three quantities sit together here (NAMING.md). */}
          <Cluster name="Quantity">
            <ClusterFact
              num
              label="SO Qty"
              empty={data.soQty == null}
              title="The SO / JWSO line's ordered qty"
              value={data.soQty ?? '—'}
            />
            <ClusterFact
              num
              label="Plan Qty"
              empty={data.planQty == null}
              title="What the plan covers"
              value={data.planQty ?? '—'}
            />
            <ClusterFact
              num
              label="PRO Qty"
              title="Pieces THIS Production Order is for"
              value={data.orderQty}
            />
            {/* JC progress — read live off the Job Card on every load, never
                stored. Was the Job Card Progress panel. */}
            <ClusterFact
              num
              label="JC Finished"
              title={jcFinishedTitle}
              empty={!data.jcComputedStatus}
              value={
                data.jcComputedStatus ? (
                  <>
                    <ProgressBar
                      className="po-bar"
                      value={pct}
                      color={pct >= 100 ? 'var(--green)' : 'var(--cyan)'}
                      label="Job Card completed"
                    />
                    {data.jcFinishedQty}
                  </>
                ) : (
                  '—'
                )
              }
              after={
                data.jcComputedStatus ? (
                  <JcStatusBadge status={data.jcComputedStatus} />
                ) : (
                  <span className="badge b-grey">No Job Card</span>
                )
              }
            />
          </Cluster>
          <Cluster name={null}>
            <ClusterFact
              num
              label="Credited Qty"
              title="Pieces already closed into stock"
              value={credited}
            />
            <ClusterFact
              num
              label="Lost Qty"
              empty={data.lostQty == null}
              title="Pieces written off on a short close"
              value={data.lostQty ?? '—'}
            />
            <ClusterFact
              num
              className="po-act"
              label="Available to Close"
              title="Finished on the Job Card and not yet credited — what Close Qty… acts on"
              value={data.availableToClose}
            />
            <ClusterFact
              num
              lead
              label="Pending"
              title="Pieces still to be closed"
              value={data.remainingQty}
            />
          </Cluster>

          {/* The dates in the order they happen: the plan's window, our own
              target, then the date the CUSTOMER expects it (the SO / JWSO
              line's due date — that is what `Customer Dispatch Date` means on
              a Production Order, owner decision 2026-09-30). */}
          <Cluster name="Schedule">
            <ClusterFact
              num
              label="Plan Start Date"
              empty={!data.plannedStartDate}
              value={fmtDate(data.plannedStartDate)}
            />
            <ClusterFact
              num
              label="Plan End Date"
              empty={!data.plannedEndDate}
              value={fmtDate(data.plannedEndDate)}
            />
            <ClusterFact
              num
              className={pTarget ? 'po-chip' : ''}
              label="PRO Target Date"
              empty={!data.targetDate}
              title={pTarget ? withPending(fmtDate(data.targetDate), pTarget) : undefined}
              value={fmtDate(data.targetDate)}
              after={pTarget?.chip}
            />
            <ClusterFact
              num
              label="Customer Dispatch Date"
              empty={!data.lineDueDate}
              value={fmtDate(data.lineDueDate)}
            />
          </Cluster>

          {/* Material — the RM item is WHAT the store issues; grade and size
              are read live off the plan (same labels as Plan detail). Actual
              Size and Raw Material Available are the shop floor's own answers
              typed on Create (ADR-182) — the size really cut, not the planned
              one. */}
          <Cluster name="Material">
            <ClusterFact
              num
              label="RM Item"
              empty={!data.rawMaterialItemCode}
              title={data.rawMaterialItemCode ?? undefined}
              value={data.rawMaterialItemCode ?? '—'}
            />
            <ClusterFact
              className="po-one-line"
              label="RM Grade"
              empty={!data.rawMaterialGradeText}
              title={data.rawMaterialGradeText ?? undefined}
              value={data.rawMaterialGradeText ?? '—'}
            />
            <ClusterFact
              className="po-one-line"
              label="RM Size"
              empty={!data.rawMaterialSizeText}
              title={data.rawMaterialSizeText ?? undefined}
              value={data.rawMaterialSizeText ?? '—'}
            />
            <ClusterFact
              num
              label="RM Qty / piece"
              empty={data.rmQtyPerPiece == null}
              value={data.rmQtyPerPiece ?? '—'}
            />
          </Cluster>
          <Cluster name={null}>
            <ClusterFact
              className={pSize ? 'po-chip' : 'po-one-line'}
              label="Actual Size"
              empty={!data.actualSize}
              title={
                data.actualSize || pSize ? withPending(data.actualSize ?? '—', pSize) : undefined
              }
              value={data.actualSize ?? '—'}
              after={pSize?.chip}
            />
            <ClusterFact
              className={pRmAvail ? 'po-chip' : ''}
              label="Raw Material Available"
              title={
                pRmAvail
                  ? withPending(data.rawMaterialAvailable ? '✓ Yes' : '✗ No', pRmAvail)
                  : undefined
              }
              value={
                data.rawMaterialAvailable ? (
                  <span style={{ color: 'var(--green2)' }}>✓ Yes</span>
                ) : (
                  <span style={{ color: 'var(--red2)' }}>✗ No</span>
                )
              }
              after={pRmAvail?.chip}
            />
            <ClusterFact
              span={2}
              className={pRemarks ? 'po-wide po-chip' : 'po-wide po-one-line'}
              label="Remarks"
              empty={!data.remarks}
              title={
                data.remarks || pRemarks ? withPending(data.remarks ?? '—', pRemarks) : undefined
              }
              value={data.remarks ?? '—'}
              after={pRemarks?.chip}
            />
          </Cluster>
        </ClusterGrid>
      </DetailHeader>

      {/* The one panel that takes the height left on screen. Its table is the
          page's only scrollbar. */}
      <div className="po-tabs">
        <TabStrip
          label="Production Order lists"
          activeKey={tab}
          onChange={(k) => setTab(k === 'history' ? 'history' : 'ledger')}
          tabs={[
            { key: 'ledger', label: 'Close Ledger', count: data.closes.length },
            { key: 'history', label: 'History', count: history.data?.rows.length ?? null },
          ]}
        />
        <span className="po-tabs-meta">
          <b>
            {credited} / {data.orderQty}
          </b>{' '}
          credited
        </span>
      </div>
      <Panel fill bodyPadding="none">
        {tab === 'ledger' ? (
          data.closes.length === 0 ? (
            <EmptyState>No closes yet.</EmptyState>
          ) : (
            // Close ledger — every partial close + reversal, newest first.
            // ADR-182 — nothing may be reversed on a stopped order either.
            <PoCloseLedger po={data} canReverse={perms.edit && !stopped} fill />
          )
        ) : (
          // ADR-197 — every action on this order: create, partial closes,
          // reversals, short close — who, when, qty, reason.
          <DocumentHistory entity="ProductionOrder" entityId={data.id} refId={data.code} />
        )}
      </Panel>

      {/* Close (progressive, ADR-179) — today's form, unchanged, in a dialog.
          Closes itself on success; the order refetches underneath. Kept open
          while its save is in flight even if a refetch takes Close away, and
          with no ×, no Escape and no click-outside until the save answers
          (Modal: no `onClose` = no way to dismiss). */}
      {closeOpen && (showCloseForm || closing) ? (
        <Modal
          title={`Close Qty ${data.code}`}
          size="md"
          {...(closing ? {} : { onClose: () => setCloseOpen(false) })}
          closeOnOverlayClick={false}
        >
          <PoCloseForm po={data} onClosed={() => setCloseOpen(false)} />
        </Modal>
      ) : null}

      {shortCloseOpen ? (
        <PoShortCloseModal
          id={data.id}
          code={data.code}
          jcCode={data.jcCodeText}
          orderQty={data.orderQty}
          creditedQty={credited}
          onClose={() => setShortCloseOpen(false)}
        />
      ) : null}
    </div>
  );
}
