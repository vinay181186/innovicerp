// The read-only parts of the Production Order fact block — identity line,
// Order, Quantity, Schedule and the first Material row — as the Edit page
// shows them (pro-routecard-create-edit-mockup.html, frame 2, approved
// 2026-10-06: "every cluster exactly as on the detail page, in the same
// place").
//
// Same labels, order, classes and hover texts as routes/detail.tsx, which is
// not touched this round. Kept here so Edit does not grow a third copy; when
// the detail page is next opened up it can render these too.

import type { ProductionOrderDetail } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { JC_STATUS_LABEL, JcStatusBadge } from '@/modules/job-cards/components/jc-status-badge';
import { ProgressBar } from '@/ui/data';
import { Cluster, ClusterFact, DocIdent, IdentCode, IdentSep } from '@/ui/forms';

type Po = ProductionOrderDetail;

/** WHICH order this is: the PRO, the item, the SO / JWSO line and customer. */
export function PoIdentLine({ po }: { po: Po }): React.JSX.Element {
  return (
    <DocIdent>
      <IdentCode>{po.code}</IdentCode>
      <IdentSep />
      {/* CODE/REV (ADR-177); bare code when the line has no revision. */}
      <IdentCode>{itemCodeWithRev(po.itemCodeText, po.itemRevision)}</IdentCode>
      {po.itemNameText ? <span>{po.itemNameText}</span> : null}
      {po.soCodeText ? (
        <>
          <IdentSep />
          {/* ADR-207 — the system SO No. then the SO's own office number. */}
          <IdentCode>{soNoWithInternal(po.soCodeText, po.soInternalNo)}</IdentCode>
          {/* Ln is OUR line number; POL is the CUSTOMER's PO line number. */}
          {po.lineNo ? <span>Ln {po.lineNo}</span> : null}
          {po.clientPoLineNo ? (
            <span>
              POL{' '}
              <b className="mono" style={{ color: 'var(--purple)' }}>
                {po.clientPoLineNo}
              </b>
            </span>
          ) : null}
        </>
      ) : null}
      {po.partyName ? (
        <>
          <IdentSep />
          <span>{po.partyName}</span>
        </>
      ) : null}
    </DocIdent>
  );
}

/** Order: when it was raised, by whom, from which Plan and Route Card. */
export function PoOrderCluster({ po }: { po: Po }): React.JSX.Element {
  const routeCardRev = `Route Card Rev ${po.routeCardRevision}`;
  return (
    <Cluster name="Order">
      <ClusterFact
        num
        label="Production Order Date"
        empty={!po.createdAt}
        value={fmtDate(po.createdAt)}
      />
      <ClusterFact
        className="po-one-line"
        label="Created By"
        empty={!po.createdByName}
        title={po.createdByName ?? undefined}
        value={po.createdByName ?? '—'}
      />
      <ClusterFact
        label="Plan No."
        value={
          <Link
            to="/plans/$id"
            params={{ id: po.planId }}
            className="mono fw-700"
            style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          >
            {po.planCodeText}
          </Link>
        }
      />
      <ClusterFact
        className="po-one-line"
        label="Route Card"
        title={`${po.routeCardCodeText} · ${routeCardRev}`}
        value={
          <>
            <Link
              to="/route-cards/$id"
              params={{ id: po.routeCardId }}
              className="mono fw-700"
              style={{ color: 'var(--cyan)', textDecoration: 'none' }}
            >
              {po.routeCardCodeText}
            </Link>{' '}
            <span className="text3" style={{ fontSize: 'var(--fs-xs)', fontWeight: 400 }}>
              {routeCardRev}
            </span>
          </>
        }
      />
    </Cluster>
  );
}

/** Quantity: the ladder, then the close account that ends on Pending. */
export function PoQuantityClusters({ po }: { po: Po }): React.JSX.Element {
  const pct =
    po.orderQty > 0 ? Math.min(100, Math.round((po.jcFinishedQty / po.orderQty) * 100)) : 0;
  const credited = po.creditedQty ?? 0;
  const jcFinishedTitle =
    (po.jcComputedStatus ? `JC Status: ${JC_STATUS_LABEL[po.jcComputedStatus]}. ` : '') +
    "Finished qty = output of the Job Card's last op (QC-accepted if it is QC). Close credits this qty to stock." +
    (po.jcClosedAt ? ` JC closed on ${fmtDate(po.jcClosedAt)}.` : '');
  return (
    <>
      <Cluster name="Quantity">
        <ClusterFact
          num
          label="SO Qty"
          empty={po.soQty == null}
          title="The SO / JWSO line's ordered qty"
          value={po.soQty ?? '—'}
        />
        <ClusterFact
          num
          label="Plan Qty"
          empty={po.planQty == null}
          title="What the plan covers"
          value={po.planQty ?? '—'}
        />
        <ClusterFact
          num
          label="PRO Qty"
          title="Pieces THIS Production Order is for"
          value={po.orderQty}
        />
        <ClusterFact
          num
          label="JC Finished"
          title={jcFinishedTitle}
          empty={!po.jcComputedStatus}
          value={
            po.jcComputedStatus ? (
              <>
                <ProgressBar
                  className="po-bar"
                  value={pct}
                  color={pct >= 100 ? 'var(--green)' : 'var(--cyan)'}
                  label="Job Card completed"
                />
                {po.jcFinishedQty}
              </>
            ) : (
              '—'
            )
          }
          after={
            po.jcComputedStatus ? (
              <JcStatusBadge status={po.jcComputedStatus} />
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
          empty={po.lostQty == null}
          title="Pieces written off on a short close"
          value={po.lostQty ?? '—'}
        />
        <ClusterFact
          num
          className="po-act"
          label="Available to Close"
          title="Finished on the Job Card and not yet credited — what Close Qty… acts on"
          value={po.availableToClose}
        />
        <ClusterFact
          num
          lead
          label="Pending"
          title="Pieces still to be closed"
          value={po.remainingQty}
        />
      </Cluster>
    </>
  );
}

/** Schedule: the plan's window, our own target, then the customer's date.
 *  `target` is the third cell — a value on the detail page, the input on Edit. */
export function PoScheduleCluster({
  po,
  target,
}: {
  po: Po;
  target: React.ReactNode;
}): React.JSX.Element {
  return (
    <Cluster name="Schedule">
      <ClusterFact
        num
        label="Plan Start Date"
        empty={!po.plannedStartDate}
        value={fmtDate(po.plannedStartDate)}
      />
      <ClusterFact
        num
        label="Plan End Date"
        empty={!po.plannedEndDate}
        value={fmtDate(po.plannedEndDate)}
      />
      {target}
      <ClusterFact
        num
        label="Customer Dispatch Date"
        empty={!po.lineDueDate}
        value={fmtDate(po.lineDueDate)}
      />
    </Cluster>
  );
}

/** Material, first row: the RM item, grade and size read live off the plan. */
export function PoMaterialCluster({ po }: { po: Po }): React.JSX.Element {
  return (
    <Cluster name="Material">
      <ClusterFact
        num
        label="RM Item"
        empty={!po.rawMaterialItemCode}
        title={po.rawMaterialItemCode ?? undefined}
        value={po.rawMaterialItemCode ?? '—'}
      />
      <ClusterFact
        className="po-one-line"
        label="RM Grade"
        empty={!po.rawMaterialGradeText}
        title={po.rawMaterialGradeText ?? undefined}
        value={po.rawMaterialGradeText ?? '—'}
      />
      <ClusterFact
        className="po-one-line"
        label="RM Size"
        empty={!po.rawMaterialSizeText}
        title={po.rawMaterialSizeText ?? undefined}
        value={po.rawMaterialSizeText ?? '—'}
      />
      <ClusterFact
        num
        label="RM Qty / piece"
        empty={po.rmQtyPerPiece == null}
        value={po.rmQtyPerPiece ?? '—'}
      />
    </Cluster>
  );
}
