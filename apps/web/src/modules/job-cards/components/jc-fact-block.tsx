// Job Card detail — the fact block (jobcard-detail-mockup.html, frame 1,
// approved 2026-10-06). One picture frame on the left; on the right the
// identity line and the gutter-named ClusterGrid, read in the order the work
// happens:
//
//   identity   JC No. · CODE/REV name · SO / JWSO No. (+ Internal SO No.) Ln POL · customer
//   ORDER      Production Order · Plan No. (Parent JC on a child) · Route Card + Route Card Rev · Drawing
//              JC Date · Due Date · Customer Dispatch Date · Priority
//   QUANTITY   Order Qty · Pending at Ops · At Vendor · Deviated (NC open)
//              In Progress · Rejected · Check · Completed (the result)
//   MATERIAL   RM Item · RM Qty per piece · RM Grade · RM Size
//              (JWSO card) Issued to JC · Returned to Store · Used · On JC
//   NOTES      Remarks (only when there are any)
//
// QUANTITIES — every piece count in the Quantity cluster is the SERVER's Job
// Card check (GET /flow-views/job-cards/:id/op-flow → jobCardCheck, the same
// figures the "Job Card check" line under the Op Qty Flow table prints). Nothing
// is summed here except In Progress, which is the visible sum of the cells
// before it (pending + in QC + at vendor + deviated, NC open), and "to go"
// (Order Qty − Completed, the old Pending tile). Order Qty is the card's own
// qty, as the old tile showed it.
//
// Staged edits (ADR-202) keep their amber "→ after" chip on the field they
// change: item code, drawing, order qty, due date, priority, remarks.
import type { DocumentEditChange, JobCardListItem, ProductionOrderListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import {
  PendingChangeChip,
  headerPendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import type { OpFlowResponse } from '@/modules/flow-views/types';
import { ProgressBar } from '@/ui/data';
import { Cluster, ClusterFact, ClusterGrid, DocIdent, IdentCode, IdentSep } from '@/ui/forms';
import { JcItemThumb } from './jc-item-thumb';
import type { JcDrawingRef } from './jc-view-summary';

type JobCardCheck = OpFlowResponse['jobCardCheck'];

/** A staged header edit for one field: the chip, and hover text naming the
 *  proposed value in full. Same shape as the Production Order page's. */
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

function withPending(value: string, p: { title: string } | null): string {
  return p ? `${value} · ${p.title}` : value;
}

/** The quiet mono figure after a value ("of PRO Qty 40", "+0 in QC"). */
function Sub({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="jc-sub">{children}</span>;
}

const DASH = '—';

export function JcFactBlock({
  jc,
  productionOrder,
  drawing,
  onOpenDrawing,
  pendingChanges,
  check,
  checkError,
}: {
  jc: JobCardListItem;
  /** The Production Order that built this card (walked up the parent chain on
   *  a rework / repair child); null on a hand-raised or pre-ADR-170 card. */
  productionOrder: ProductionOrderListItem | null;
  drawing: JcDrawingRef | null;
  onOpenDrawing: () => void;
  pendingChanges: readonly DocumentEditChange[];
  /** The server's Job Card check; undefined while it loads (cells show "—"). */
  check: JobCardCheck | undefined;
  /** The op-flow request failed — the cells say so instead of a dash. */
  checkError: boolean;
}): React.JSX.Element {
  const src = jc.sourceLink;
  const childJobCards = jc.childJobCards ?? [];
  const codeRev = itemCodeWithRev(jc.itemCode, jc.itemRevision);

  const pItem = pendingFor(pendingChanges, 'itemCode');
  const pDrawing = pendingFor(pendingChanges, 'drawingFilePath');
  const pQty = pendingFor(pendingChanges, 'orderQty');
  const pDue = pendingFor(pendingChanges, 'dueDate');
  const pPriority = pendingFor(pendingChanges, 'priority');
  const pRemarks = pendingFor(pendingChanges, 'remarks');

  // ── Quantity — the server's Job Card check ──
  const q = check;
  const inProgress = q ? q.pending + q.inQc + q.atVendor + q.deviatedOpen : null;
  const finished = q ? q.finished : null;
  const toGo = finished != null ? Math.max(0, jc.orderQty - finished) : null;
  const pct =
    finished != null && jc.orderQty > 0
      ? Math.min(100, Math.round((finished / jc.orderQty) * 100))
      : 0;
  const qtyEmpty = checkError ? 'Not loaded' : DASH;
  const inProgressParts = q
    ? [q.pending, q.atVendor, ...(q.inQc !== 0 ? [q.inQc] : []), q.deviatedOpen]
    : [];
  const inProgressTitle = q
    ? `In Progress = ${q.pending} pending at ops + ${q.atVendor} at vendor + ${q.inQc} in QC + ${q.deviatedOpen} deviated (NC open)`
    : undefined;
  const checkTitle = q
    ? `Job Card check: ${q.ordered} ordered = ${q.finished} finished + ${q.pending} pending + ${q.inQc} in QC + ${q.atVendor} at vendor + ${q.deviatedOpen} deviated (NC open) + ${q.rejected} rejected` +
      (q.unaccounted === 0 ? ' ✓' : ` — ${q.unaccounted} not accounted for`)
    : undefined;

  // ── Material ──
  const required =
    jc.rmQtyPerPiece != null ? Math.round(jc.rmQtyPerPiece * jc.orderQty * 10000) / 10000 : null;
  const actualSize = productionOrder?.actualSize ?? null;
  const cm = jc.customerMaterial;
  const cmTitle = cm
    ? `Customer Material on this Job Card (1 RM piece per part) · Needed ${cm.needed ?? DASH}. JWSO line totals — Accepted ${cm.received} · Issued ${cm.issued} · Returned to Customer ${cm.returned} · Register Balance ${cm.balance}`
    : undefined;

  const routeCardRev =
    jc.routeCardRevision != null ? `Route Card Rev ${jc.routeCardRevision}` : null;
  const showNotes = Boolean(jc.remarks) || Boolean(pRemarks);
  // On a rework / repair child the parent card takes Plan No.'s cell (the plan
  // belongs to the parent's order).
  const parentCell = Boolean(jc.parentJobCardId);

  return (
    <div className="jc-facts">
      <JcItemThumb
        imagePath={jc.itemImagePath}
        drawing={drawing}
        onOpenDrawing={onOpenDrawing}
        itemLabel={`${codeRev} ${jc.itemName}`}
      />
      <div className="jc-facts-main">
        {/* WHICH card this is — identity, not facts, so it heads the block. */}
        <DocIdent>
          <IdentCode>{jc.code}</IdentCode>
          <IdentSep />
          <IdentCode>{codeRev}</IdentCode>
          {jc.itemName ? (
            <span className="jc-ident-name" title={jc.itemName}>
              {jc.itemName}
            </span>
          ) : null}
          {pItem ? <span title={pItem.title}>{pItem.chip}</span> : null}
          {src ? (
            <>
              <IdentSep />
              {src.type === 'so' ? (
                // ADR-207 — the system SO No. then the SO's own office number.
                <Link
                  to="/sales-orders/$id"
                  params={{ id: src.salesOrderId }}
                  className="cl-ident-code jc-ident-link"
                >
                  {soNoWithInternal(src.code, src.internalSoNo)}
                </Link>
              ) : (
                <Link
                  to="/job-work-orders/$id"
                  params={{ id: src.jobWorkOrderId }}
                  className="cl-ident-code jc-ident-link"
                >
                  {src.code}
                </Link>
              )}
              {/* Ln is OUR order line number; POL is the line number on the
                  CUSTOMER's own PO. Never the same fact. */}
              <span>Ln {src.lineNo}</span>
              {jc.clientPoLineNo ? (
                <span>
                  POL <b className="jc-pol">{jc.clientPoLineNo}</b>
                </span>
              ) : null}
            </>
          ) : null}
          {jc.customerName ? (
            <>
              <IdentSep />
              <span className="jc-ident-name" title={jc.customerName}>
                {jc.customerName}
              </span>
            </>
          ) : null}
          {/* A parent card names the rework / repair children raised off it. */}
          {childJobCards.length > 0 ? (
            <>
              <IdentSep />
              <span>Child JC</span>
              {childJobCards.map((c) => (
                <Link
                  key={c.id}
                  to="/job-cards/$id"
                  params={{ id: c.id }}
                  className="cl-ident-code jc-ident-link"
                  title={`Open the ${c.recoveryKind === 'repair' ? 'repair' : 'rework'} job card`}
                >
                  {c.code}
                </Link>
              ))}
            </>
          ) : null}
        </DocIdent>

        <ClusterGrid>
          {/* ── ORDER: where the card came from and what it is made to ── */}
          <Cluster name="Order">
            <ClusterFact
              label="Production Order"
              empty={!jc.productionOrderId}
              value={
                jc.productionOrderId && jc.productionOrderCode ? (
                  <Link
                    to="/production-orders/$id"
                    params={{ id: jc.productionOrderId }}
                    className="jc-code-link"
                  >
                    {jc.productionOrderCode}
                  </Link>
                ) : (
                  DASH
                )
              }
            />
            {parentCell ? (
              <ClusterFact
                label="Parent JC"
                value={
                  jc.parentJobCardId ? (
                    <Link
                      to="/job-cards/$id"
                      params={{ id: jc.parentJobCardId }}
                      className="jc-code-link"
                      title="Open the parent job card"
                    >
                      {jc.parentJobCardCode ?? DASH}
                    </Link>
                  ) : (
                    DASH
                  )
                }
              />
            ) : (
              <ClusterFact
                label="Plan No."
                empty={!productionOrder}
                value={
                  productionOrder ? (
                    <Link
                      to="/plans/$id"
                      params={{ id: productionOrder.planId }}
                      className="jc-code-link"
                    >
                      {productionOrder.planCodeText}
                    </Link>
                  ) : (
                    DASH
                  )
                }
              />
            )}
            {/* The item's CURRENT route card + revision, as today (decision
                #12) — the card carries the code only, so the link opens the
                Route Cards list searched for it. */}
            {/* Not one-line: on a narrow screen the code + Route Card Rev drop
                under the label rather than the revision being cut off. */}
            <ClusterFact
              label="Route Card"
              title={
                jc.routeCardCode
                  ? `${jc.routeCardCode}${routeCardRev ? ` · ${routeCardRev}` : ''}`
                  : 'This item has no route card'
              }
              value={
                jc.routeCardCode ? (
                  <>
                    <Link
                      to="/route-cards"
                      search={{ search: jc.routeCardCode }}
                      className="jc-code-link"
                    >
                      {jc.routeCardCode}
                    </Link>
                    {routeCardRev ? <Sub> {routeCardRev}</Sub> : null}
                  </>
                ) : (
                  <span className="jc-none">None</span>
                )
              }
            />
            {/* WHICH drawing (SO line / JWSO line / this card's upload) — the
                label opens it. No drawing NUMBER: the card has none. */}
            <ClusterFact
              className={pDrawing ? 'jc-chip' : 'jc-one-line'}
              label="Drawing"
              empty={!drawing}
              title={
                drawing || pDrawing
                  ? withPending(drawing ? `${drawing.label} — ${drawing.fileName}` : DASH, pDrawing)
                  : undefined
              }
              value={
                drawing ? (
                  <button type="button" className="jc-link-btn" onClick={onOpenDrawing}>
                    {drawing.label}
                  </button>
                ) : (
                  DASH
                )
              }
              after={pDrawing?.chip}
            />
          </Cluster>
          <Cluster name={null}>
            <ClusterFact num label="JC Date" empty={!jc.jcDate} value={fmtDate(jc.jcDate)} />
            <ClusterFact
              num
              className={pDue ? 'jc-chip' : ''}
              label="Due Date"
              empty={!jc.dueDate}
              title={pDue ? withPending(fmtDate(jc.dueDate), pDue) : undefined}
              value={fmtDate(jc.dueDate)}
              after={pDue?.chip}
            />
            <ClusterFact
              num
              label="Customer Dispatch Date"
              empty={!jc.customerDispatchDate}
              value={fmtDate(jc.customerDispatchDate)}
            />
            <ClusterFact
              className={pPriority ? 'jc-chip' : ''}
              label="Priority"
              title={pPriority ? pPriority.title : undefined}
              value={
                <span className={`badge ${jc.priority === 'high' ? 'b-amber' : 'b-grey'}`}>
                  {jc.priority === 'high' ? '↑ High' : 'Normal'}
                </span>
              }
              after={pPriority?.chip}
            />
          </Cluster>

          {/* ── QUANTITY: how many, where they are, ending on Completed ── */}
          <Cluster name="Quantity">
            <ClusterFact
              num
              className={pQty ? 'jc-chip' : ''}
              label="Order Qty"
              title={withPending(
                productionOrder
                  ? `${jc.orderQty} on this Job Card · PRO Qty ${productionOrder.orderQty}`
                  : String(jc.orderQty),
                pQty,
              )}
              value={
                <>
                  {jc.orderQty}
                  {productionOrder ? <Sub> of PRO Qty {productionOrder.orderQty}</Sub> : null}
                </>
              }
              after={pQty?.chip}
            />
            <ClusterFact
              num
              label="Pending at Ops"
              empty={!q}
              title="Pieces waiting at an operation (Σ Pending over every op)"
              value={q ? q.pending : qtyEmpty}
            />
            <ClusterFact
              num
              label="At Vendor"
              empty={!q}
              title={
                q
                  ? `${q.atVendor} with the OSP vendor now · ${q.inQc} back from the vendor, waiting for incoming QC`
                  : undefined
              }
              value={
                q ? (
                  <>
                    {q.atVendor}
                    <Sub> +{q.inQc} in QC</Sub>
                  </>
                ) : (
                  qtyEmpty
                )
              }
            />
            <ClusterFact
              num
              className={q && q.deviatedOpen > 0 ? 'jc-amber' : ''}
              label="Deviated (NC open)"
              empty={!q}
              title="Failed inspection, NC still waiting for a decision"
              value={q ? q.deviatedOpen : qtyEmpty}
            />
          </Cluster>
          <Cluster name={null}>
            <ClusterFact
              num
              label="In Progress"
              empty={!q}
              title={inProgressTitle}
              value={
                inProgress != null ? (
                  <>
                    {inProgress}
                    <Sub> = {inProgressParts.join(' + ')}</Sub>
                  </>
                ) : (
                  qtyEmpty
                )
              }
            />
            <ClusterFact
              num
              className={q && q.rejected > 0 ? 'jc-red' : ''}
              label="Rejected"
              empty={!q}
              title="Final NC decision: scrap / make fresh, or failed rework / repair"
              value={q ? q.rejected : qtyEmpty}
            />
            <ClusterFact
              num
              label="Check"
              empty={!q}
              title={checkTitle}
              value={
                q && inProgress != null ? (
                  q.unaccounted === 0 ? (
                    <>
                      <span className="jc-yes">✓</span>
                      <Sub>
                        {' '}
                        {q.ordered} − {inProgress} − {q.rejected} = {q.finished}
                      </Sub>
                    </>
                  ) : (
                    <span className="jc-no">⚠ {q.unaccounted} not accounted for</span>
                  )
                ) : (
                  qtyEmpty
                )
              }
            />
            <ClusterFact
              num
              lead
              label="Completed"
              empty={finished == null}
              title="Through the last op (QC-accepted when it is QC) — Order Qty − Completed is still to go"
              value={
                finished != null ? (
                  <>
                    <ProgressBar
                      className="jc-bar"
                      value={pct}
                      color="var(--green)"
                      label="Job Card completed"
                    />
                    {finished}
                    <Sub> {toGo} to go</Sub>
                  </>
                ) : (
                  qtyEmpty
                )
              }
            />
          </Cluster>

          {/* ── MATERIAL: what it is cut from ── */}
          <Cluster name="Material">
            <ClusterFact
              num
              className="jc-one-line"
              label="RM Item"
              empty={!jc.rawMaterialItemCode}
              title={jc.rawMaterialItemCode ?? undefined}
              value={jc.rawMaterialItemCode ?? DASH}
            />
            <ClusterFact
              num
              label="RM Qty per piece"
              empty={jc.rmQtyPerPiece == null}
              title={
                required != null ? `RM Qty per piece × Order Qty = Required ${required}` : undefined
              }
              value={
                jc.rmQtyPerPiece != null ? (
                  <>
                    {jc.rmQtyPerPiece}
                    <Sub> Required {required}</Sub>
                  </>
                ) : (
                  DASH
                )
              }
            />
            <ClusterFact
              className="jc-one-line"
              label="RM Grade"
              empty={!jc.rawMaterialGradeText}
              title={jc.rawMaterialGradeText ?? undefined}
              value={jc.rawMaterialGradeText || DASH}
            />
            {/* Planned size, then (ADR-182) what the store ACTUALLY cut, from
                the Production Order. */}
            <ClusterFact
              className="jc-one-line"
              label="RM Size"
              empty={!jc.rawMaterialSizeText && !actualSize}
              title={
                jc.rawMaterialSizeText || actualSize
                  ? `${jc.rawMaterialSizeText || DASH}${actualSize ? ` · Actual Size ${actualSize}` : ''}`
                  : undefined
              }
              value={
                <>
                  {jc.rawMaterialSizeText || DASH}
                  {actualSize ? <Sub> Actual {actualSize}</Sub> : null}
                </>
              }
            />
          </Cluster>
          {/* JWSO card (R1, ADR-194 / ADR-203): the customer's material on THIS
              card — the old Customer Material strip, as a second Material row.
              The JWSO line's totals are on each cell's hover. */}
          {cm ? (
            <Cluster name={null}>
              <ClusterFact num label="Issued to JC" title={cmTitle} value={cm.issuedToJcQty} />
              <ClusterFact
                num
                label="Returned to Store"
                title={cmTitle}
                value={cm.returnedToStoreQty}
              />
              <ClusterFact num label="Used" title={cmTitle} value={cm.usedQty} />
              <ClusterFact
                num
                className={cm.onJcQty > 0 ? 'jc-green' : ''}
                label="On JC"
                title={cmTitle}
                value={cm.onJcQty}
              />
            </Cluster>
          ) : null}

          {/* ── NOTES: only when there are any, as today ── */}
          {showNotes ? (
            <Cluster name="Notes">
              <ClusterFact
                span={4}
                className={pRemarks ? 'jc-wide jc-chip' : 'jc-wide jc-one-line'}
                label="Remarks"
                empty={!jc.remarks}
                title={
                  jc.remarks || pRemarks ? withPending(jc.remarks || DASH, pRemarks) : undefined
                }
                value={jc.remarks || DASH}
                after={pRemarks?.chip}
              />
            </Cluster>
          ) : null}
        </ClusterGrid>
      </div>
    </div>
  );
}
