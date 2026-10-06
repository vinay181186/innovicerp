// Edit Job Card — the fact block. The detail page's block (jc-fact-block.tsx,
// jobcard-detail-mockup.html frame 1) cell for cell, in the same order, with
// the five header fields this page edits turned into inputs IN their cells:
//
//   identity   JC No. · [Item Code ★] name · SO / JWSO No. Ln POL · customer
//   ORDER      Production Order · Plan No. (Parent JC) · Route Card · Drawing
//              JC Date · [Due Date] · Customer Dispatch Date · [Priority]
//   QUANTITY   [Order Qty ★] · Pending at Ops · At Vendor · Deviated (NC open)
//              In Progress · Rejected · Check · Completed (the result)
//   MATERIAL   RM Item · RM Qty per piece · RM Grade · RM Size
//              (JWSO card) Issued to JC · Returned to Store · Used · On JC
//   NOTES      [Remarks] — always drawn here, because it can be typed into
//
// Mirrors jc-fact-block.tsx rather than editing it (that file is the detail
// page's and stays untouched). Everything read-only reads exactly what the
// detail page reads. The controls themselves are owned by the form
// (jc-status-content.tsx) and arrive as `fields`, so validation, state and the
// save payload live in one place.
//
// Pitfall 4 (an editable field inside an account must recompute it): Order
// Qty is typed here, so "to go" (Order Qty − Completed) and RM "Required"
// (RM Qty per piece × Order Qty) follow the TYPED qty. The server's Job Card
// check figures (Pending at Ops … Check) describe the SAVED card and cannot be
// recomputed in the browser — while the typed qty differs, Check says so.
//
// Staged edits (ADR-202) keep their orange "→ after" chip in the cell of the
// field they change: item code, drawing, order qty, due date, priority, remarks.
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
import { cx } from '@/ui/forms/class-names';
import { JcItemThumb } from './jc-item-thumb';
import type { JcDrawingRef } from './jc-view-summary';

type JobCardCheck = OpFlowResponse['jobCardCheck'];

const DASH = '—';

/** A staged header edit for one field: the chip, and hover text naming the
 *  proposed value in full. Same as jc-fact-block.tsx's (private there). */
function pendingFor(
  changes: readonly DocumentEditChange[],
  field: string,
): { chip: React.ReactNode; title: string } | null {
  const c = headerPendingChange(changes, field);
  if (!c) return null;
  const after = c.after === null || c.after === '' ? DASH : String(c.after);
  return {
    chip: <PendingChangeChip after={c.after} />,
    title: `Waiting for approval: → ${after}`,
  };
}

function withPending(value: string, p: { title: string } | null): string {
  return p ? `${value} · ${p.title}` : value;
}

function Sub({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="jc-sub">{children}</span>;
}

/** One editable cell: the detail page's `.cl-fact` (label left, hairline on
 *  the left) with the CONTROL where the value sits. The pending chip is its
 *  own child after the control, never inside it (cluster-grid pitfall 2). */
function JcEditCell({
  label,
  htmlFor,
  required = false,
  span = 1,
  wide = false,
  title,
  pending,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  span?: 1 | 4;
  wide?: boolean;
  /** Hover text for the cell (a pending change is added after it). */
  title?: string | undefined;
  pending: { chip: React.ReactNode; title: string } | null;
  children: React.ReactNode;
}): React.JSX.Element {
  const hover = title ? withPending(title, pending) : pending?.title;
  return (
    <div
      className={cx(
        'cl-fact',
        'jc-in',
        span > 1 ? `cl-span-${span}` : undefined,
        wide && 'jc-in-wide',
      )}
      title={hover}
    >
      <label className="cl-fact-k" htmlFor={htmlFor}>
        {label}
        {required ? <span className="req">★</span> : null}
      </label>
      <span className="jc-in-ctl">{children}</span>
      {pending ? <span className="cl-fact-after">{pending.chip}</span> : null}
    </div>
  );
}

/** The Order Qty caps the server enforces on a Job Card edit, stated in the
 *  cell, and the first one the typed qty breaks — in the server's own words.
 *  Mirrors apps/api/src/modules/job-cards/service.ts (updateJobCardTx), in the
 *  order it checks them; no rule here that the server does not have:
 *    1. L2238-2246 — a Production Order's card keeps the ORDER's qty: a CHANGE
 *       of qty to anything but the PRO Qty is refused (unchanged still saves).
 *    2. L2247-2251 — never below the most any operation has completed
 *       (MAX v_jc_op_status.completed_qty over the card's ops).
 *    3. L2252-2268 — on a change, never below the customer material still
 *       issued to the card (issued − returned to store).
 *  `error` is null while the typed qty is not a whole number above 0 (the
 *  shared validation speaks for that) or breaks no rule. */
export interface JcEditQtyRule {
  /** Quiet sub-text for the cell, e.g. "= PRO Qty 40 (fixed)" / "min 6 — completed". */
  caption: string | null;
  /** The server's refusal for the typed qty, or null. */
  error: string | null;
}

export function jcEditQtyRule({
  jcCode,
  savedQty,
  typedQty,
  proCode,
  proQty,
  completedQty,
  issuedNetQty,
}: {
  jcCode: string;
  /** The card's saved Order Qty (the server's head.orderQty). */
  savedQty: number;
  typedQty: number;
  /** The card's OWN Production Order (jc.productionOrderId), null when none. */
  proCode: string | null;
  proQty: number | null;
  completedQty: number;
  issuedNetQty: number;
}): JcEditQtyRule {
  const parts: string[] = [];
  if (proQty != null) parts.push(`= PRO Qty ${proQty} (fixed)`);
  const floor = Math.max(completedQty, issuedNetQty);
  if (floor > 0) {
    parts.push(
      `min ${floor} — ${completedQty >= issuedNetQty ? 'completed' : 'customer material issued'}`,
    );
  }
  const caption = parts.length > 0 ? parts.join(' · ') : null;

  if (!Number.isInteger(typedQty) || typedQty <= 0) return { caption, error: null };
  const changed = typedQty !== savedQty;
  // service.ts L2244 (same words)
  if (proQty != null && changed && typedQty !== proQty) {
    return {
      caption,
      error: `${jcCode} belongs to Production Order ${proCode ?? ''} — its JC Qty is the order's qty (${proQty}).`,
    };
  }
  // service.ts L2249 (same words)
  if (typedQty < completedQty) {
    return {
      caption,
      error: `JC Qty (${typedQty}) cannot be less than what is already completed on ${jcCode} (${completedQty}).`,
    };
  }
  // service.ts L2264-2265 (same words)
  if (changed && typedQty < issuedNetQty) {
    return {
      caption,
      error:
        `JC Qty (${typedQty}) cannot be less than the customer material issued to ${jcCode} ` +
        `(${issuedNetQty}, after returns to store). Return the spare pieces to store first.`,
    };
  }
  return { caption, error: null };
}

export interface JcEditFields {
  /** Item Code picker (id `jc-edit-item`). */
  item: React.ReactNode;
  /** Due Date input (id `jc-edit-due`). */
  dueDate: React.ReactNode;
  /** Priority select (id `jc-edit-priority`). */
  priority: React.ReactNode;
  /** Order Qty input (id `jc-edit-qty`). */
  orderQty: React.ReactNode;
  /** Remarks box (id `jc-edit-remarks`). */
  remarks: React.ReactNode;
}

export function JcEditFactBlock({
  jc,
  productionOrder,
  drawing,
  onOpenDrawing,
  pendingChanges,
  check,
  checkError,
  typedOrderQty,
  itemName,
  qtyRule,
  fields,
}: {
  jc: JobCardListItem;
  productionOrder: ProductionOrderListItem | null;
  drawing: JcDrawingRef | null;
  onOpenDrawing: () => void;
  pendingChanges: readonly DocumentEditChange[];
  /** The server's Job Card check for the SAVED card; undefined while loading. */
  check: JobCardCheck | undefined;
  checkError: boolean;
  /** Order Qty as typed; NaN / 0 while the box is blank. */
  typedOrderQty: number;
  /** Name of the item now in the Item Code box ('' when not known yet). */
  itemName: string;
  /** The server's Order Qty caps for this card, and the one the typed qty
   *  breaks (jcEditQtyRule). */
  qtyRule: JcEditQtyRule;
  fields: JcEditFields;
}): React.JSX.Element {
  const src = jc.sourceLink;
  const childJobCards = jc.childJobCards ?? [];

  const pItem = pendingFor(pendingChanges, 'itemCode');
  const pDrawing = pendingFor(pendingChanges, 'drawingFilePath');
  const pQty = pendingFor(pendingChanges, 'orderQty');
  const pDue = pendingFor(pendingChanges, 'dueDate');
  const pPriority = pendingFor(pendingChanges, 'priority');
  const pRemarks = pendingFor(pendingChanges, 'remarks');

  // The qty the account uses: the typed one once it is a real number.
  const qtyOk = Number.isFinite(typedOrderQty) && typedOrderQty > 0;
  const qty = qtyOk ? typedOrderQty : jc.orderQty;
  const qtyChanged = qtyOk && typedOrderQty !== jc.orderQty;

  // ── Quantity — the server's Job Card check (as the detail page) ──
  const q = check;
  const inProgress = q ? q.pending + q.inQc + q.atVendor + q.deviatedOpen : null;
  const finished = q ? q.finished : null;
  const toGo = finished != null ? Math.max(0, qty - finished) : null;
  const pct = finished != null && qty > 0 ? Math.min(100, Math.round((finished / qty) * 100)) : 0;
  const qtyEmpty = checkError ? 'Not loaded' : DASH;
  const inProgressParts = q
    ? [q.pending, q.atVendor, ...(q.inQc !== 0 ? [q.inQc] : []), q.deviatedOpen]
    : [];
  const checkTitle = q
    ? `Job Card check: ${q.ordered} ordered = ${q.finished} finished + ${q.pending} pending + ${q.inQc} in QC + ${q.atVendor} at vendor + ${q.deviatedOpen} deviated (NC open) + ${q.rejected} rejected` +
      (q.unaccounted === 0 ? ' ✓' : ` — ${q.unaccounted} not accounted for`) +
      (qtyChanged
        ? ` · These figures are for the saved Order Qty ${jc.orderQty}; Save to recount.`
        : '')
    : undefined;

  // ── Material ──
  const required =
    jc.rmQtyPerPiece != null ? Math.round(jc.rmQtyPerPiece * qty * 10000) / 10000 : null;
  const actualSize = productionOrder?.actualSize ?? null;
  const cm = jc.customerMaterial;
  const cmTitle = cm
    ? `Customer Material on this Job Card (1 RM piece per part) · Needed ${cm.needed ?? DASH}. JWSO line totals — Accepted ${cm.received} · Issued ${cm.issued} · Returned to Customer ${cm.returned} · Register Balance ${cm.balance}`
    : undefined;
  const routeCardRev =
    jc.routeCardRevision != null ? `Route Card Rev ${jc.routeCardRevision}` : null;
  const parentCell = Boolean(jc.parentJobCardId);

  return (
    <div className="jc-facts">
      <JcItemThumb
        imagePath={jc.itemImagePath}
        drawing={drawing}
        onOpenDrawing={onOpenDrawing}
        itemLabel={`${itemCodeWithRev(jc.itemCode, jc.itemRevision)} ${jc.itemName}`}
      />
      <div className="jc-facts-main">
        <DocIdent>
          <IdentCode>{jc.code}</IdentCode>
          <IdentSep />
          <label className="jc-id-lb" htmlFor="jc-edit-item">
            Item Code<span className="req">★</span>
          </label>
          <span className="jc-id-item">{fields.item}</span>
          {/* CODE/REV — the revision belongs to the SO line's drawing, so it
              stays beside whichever code is picked. */}
          {jc.itemRevision ? <span className="jc-id-rev">/{jc.itemRevision}</span> : null}
          {itemName ? (
            <span className="jc-ident-name" title={itemName}>
              {itemName}
            </span>
          ) : null}
          {pItem ? <span title={pItem.title}>{pItem.chip}</span> : null}
          {src ? (
            <>
              <IdentSep />
              {src.type === 'so' ? (
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
                >
                  {c.code}
                </Link>
              ))}
            </>
          ) : null}
        </DocIdent>

        <ClusterGrid>
          {/* ── ORDER ── */}
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
            {/* Not editable here — carried through unchanged on Save. */}
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
            <JcEditCell label="Due Date" htmlFor="jc-edit-due" pending={pDue}>
              {fields.dueDate}
            </JcEditCell>
            <ClusterFact
              num
              label="Customer Dispatch Date"
              empty={!jc.customerDispatchDate}
              value={fmtDate(jc.customerDispatchDate)}
            />
            <JcEditCell label="Priority" htmlFor="jc-edit-priority" pending={pPriority}>
              {fields.priority}
            </JcEditCell>
          </Cluster>

          {/* ── QUANTITY ── */}
          <Cluster name="Quantity">
            <JcEditCell
              label="Order Qty"
              htmlFor="jc-edit-qty"
              required
              title={
                [
                  productionOrder
                    ? `Order Qty on this Job Card · PRO Qty ${productionOrder.orderQty}`
                    : null,
                  qtyRule.caption,
                  qtyRule.error,
                ]
                  .filter(Boolean)
                  .join(' · ') || undefined
              }
              pending={pQty}
            >
              {fields.orderQty}
              {/* The server's caps, quiet; red when the typed qty breaks one
                  (Save is then off with the server's own words). */}
              {qtyRule.caption ? (
                <span className={cx('jc-sub', qtyRule.error && 'jc-no')}>{qtyRule.caption}</span>
              ) : productionOrder ? (
                <Sub>of PRO Qty {productionOrder.orderQty}</Sub>
              ) : null}
            </JcEditCell>
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
              value={q ? q.rejected : qtyEmpty}
            />
            <ClusterFact
              num
              label="Check"
              empty={!q}
              title={checkTitle}
              value={
                q && inProgress != null ? (
                  qtyChanged ? (
                    <Sub>after Save</Sub>
                  ) : q.unaccounted === 0 ? (
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

          {/* ── MATERIAL (read-only: carried through unchanged on Save) ── */}
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

          {/* ── NOTES — always drawn on Edit: Remarks can be typed into ── */}
          <Cluster name="Notes">
            <JcEditCell label="Remarks" htmlFor="jc-edit-remarks" span={4} wide pending={pRemarks}>
              {fields.remarks}
            </JcEditCell>
          </Cluster>
        </ClusterGrid>
      </div>
    </div>
  );
}
