// One row of the per-order Planning line table (PL-4b level 2). Split out of
// routes/workflow.tsx (ADR-199 table standard) so the detail view stays under
// the 400-line rule. This is the interactive planning cascade — the "+ Plan" /
// "+ PR" / Allocate / Release actions and the plan/PR chips — NOT one of the two
// list surfaces, so it keeps its hand-built fixed-layout table unchanged.

import type { PlanningDetailResponse, PlanningLine } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { useExecutePlan } from '@/modules/plans/api';
import { allocateCap, lineFacts } from './reservation-modals';
import { PlanChip, PrChip } from './plan-chip';
import { lineStatusOf, type ModalState } from './planning-shared';

/** Fixed-layout column widths (percent, sum 100). The table is `table-layout:
 *  fixed` at 100% width so it can never grow a horizontal scrollbar; long
 *  text wraps inside its column instead. */
// ADR-180: Available = Physical − Reserved. Physical and the two Reserved
// figures sit in the Available cell's tooltip (and "n reserved here" under it)
// rather than three more columns — the planner needs them only when allocating.
export const LINE_COLS: { key: string; label: string; width: number; title?: string }[] = [
  { key: 'line', label: 'Ln', width: 3 },
  { key: 'item', label: 'Item Code', width: 11 },
  { key: 'name', label: 'Item Name', width: 11 },
  { key: 'orderQty', label: 'Order Qty', width: 5 },
  {
    key: 'available',
    label: 'Available',
    width: 6,
    title: 'Physical − Reserved: free stock.',
  },
  {
    key: 'balance',
    label: 'To Plan',
    width: 6,
    title:
      'Order − Planned − direct Job Cards: still to plan. The same number + Plan / + PR use. Hover a number for Balance (Order − Dispatched − Reserved).',
  },
  { key: 'planned', label: 'Plan Qty', width: 5 },
  { key: 'inProd', label: 'In Production', width: 5 },
  {
    key: 'dispatched',
    label: 'Dispatched',
    width: 6,
    title: 'Already shipped to the customer against this line',
  },
  { key: 'due', label: 'Due Date', width: 6 },
  { key: 'status', label: 'Plan Status', width: 7 },
  { key: 'plans', label: 'Plans', width: 19 },
  { key: 'action', label: 'Action', width: 10 },
];

/** A cell that may hold long text: wraps inside its fixed column instead of
 *  forcing the table wider (the shared `.innovic-table td` is nowrap). */
export const wrapCell: React.CSSProperties = { whiteSpace: 'normal', overflowWrap: 'anywhere' };

export function OrderLineRow({
  so,
  line,
  perms,
  setModal,
  executePlan,
  onViewJc,
}: {
  so: PlanningDetailResponse;
  line: PlanningLine;
  perms: { view: boolean; entry: boolean; edit: boolean };
  setModal: (m: ModalState) => void;
  executePlan: ReturnType<typeof useExecutePlan>;
  onViewJc: (jcId: string) => void;
}): JSX.Element {
  const status = lineStatusOf(line);
  return (
    <tr>
      <td className="mono fw-700 text3">{line.lineNo}</td>
      {/* `CODE/REV` — the customer's drawing revision from this
        line; a JW line has none and keeps the bare code. The
        code is the main thing: strong mono, darkest text. */}
      <td style={wrapCell}>
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {itemCodeWithRev(line.itemCode, line.itemRevision, '')}
        </span>
        {line.clientPoLineNo ? (
          <div className="mono" style={{ fontSize: 11, color: 'var(--purple)' }}>
            POL {line.clientPoLineNo}
          </div>
        ) : null}
        {/* ADR-171: Item Master "Source" — why the Action cell
          offers + Plan (make) or + PR (buy). */}
        <div style={{ marginTop: 2 }}>
          <span
            className={`badge ${line.itemProcurementType === 'buy' ? 'b-amber' : 'b-grey'}`}
            style={{ fontSize: 11, padding: '0 6px' }}
            title={
              line.itemProcurementType === 'buy'
                ? 'Bought-in item — raise a purchase request'
                : 'Made in-house — plan it'
            }
          >
            {line.itemProcurementType === 'buy' ? 'Buy' : 'Make'}
          </span>
        </div>
      </td>
      <td style={wrapCell} title={line.itemName ?? undefined}>
        {line.itemName ?? '—'}
      </td>
      <td className="mono fw-700">{line.orderQty}</td>
      {/* ADR-180: Physical never moves when stock is reserved —
        only a dispatch/issue changes it. */}
      <td
        className="mono fw-700"
        style={{ color: line.availableQty > 0 ? 'var(--green)' : 'var(--text3)' }}
        title={`Physical ${line.physicalQty} · Reserved (all lines) ${line.totalReservedQty} · Reserved (this line) ${line.reservedQty}`}
      >
        {line.availableQty}
        {line.reservedQty > 0 ? (
          <div className="mono" style={{ fontSize: 11, fontWeight: 400, color: 'var(--purple)' }}>
            {line.reservedQty} reserved here
          </div>
        ) : null}
      </td>
      <td
        className="mono fw-700"
        style={{ color: line.remaining > 0 ? 'var(--amber)' : 'var(--green)' }}
        title={`Balance (Order − Dispatched − Reserved) ${line.balanceToPlan}`}
      >
        {line.remaining}
      </td>
      <td className="mono fw-700" style={{ color: 'var(--cyan)' }}>
        {line.totalPlanned}
      </td>
      <td className="mono" style={{ color: status.hasDirectJc ? 'var(--cyan)' : 'var(--text3)' }}>
        {line.directJcQty}
      </td>
      <td
        className="mono"
        style={{ color: line.dispatchedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
      >
        {line.dispatchedQty}
      </td>
      <td className="mono">{fmtDate(line.dueDate)}</td>
      <td style={wrapCell}>
        <span style={{ fontSize: 11, fontWeight: 700, color: status.color }}>{status.label}</span>
        <div className="mono text3" style={{ fontSize: 11 }}>
          {status.pct}%
        </div>
      </td>
      <td style={wrapCell}>
        {line.plans.length === 0 && line.prs.length === 0 && !status.hasDirectJc ? (
          <span className="text3" style={{ fontSize: 11 }}>
            —
          </span>
        ) : null}
        {/* ADR-171: purchase requests raised from this BUY line. */}
        {line.prs.map((pr) => (
          <PrChip key={pr.id} pr={pr} />
        ))}
        {line.plans.map((p) => (
          <PlanChip
            key={p.id}
            plan={p}
            canEdit={perms.edit}
            onEdit={() => setModal({ kind: 'edit', planId: p.id })}
            onExecute={() => executePlan.mutate(p.id)}
            isExecuting={executePlan.isPending && executePlan.variables === p.id}
            executeError={
              executePlan.isError && executePlan.variables === p.id
                ? executePlan.error instanceof Error
                  ? executePlan.error.message
                  : 'Could not create the Job Card / PR. Try again.'
                : null
            }
            onViewJc={() => {
              // Open the Job Card page (not Operation Entry).
              if (p.jcId) onViewJc(p.jcId);
            }}
          />
        ))}
        {/* Plan-less Job Cards created from SO Status — shown so
          planners see production that bypassed planning and
          don't double-issue. */}
        {status.hasDirectJc ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 6,
              padding: '3px 8px',
              margin: '2px 0',
              background: 'var(--cyan3)',
              border: '1px solid var(--cyan2)',
              borderRadius: 6,
              fontSize: 11,
            }}
            title="Job Card(s) created directly from SO Status — counted as covered."
          >
            <span>🏭</span>
            <span style={{ fontWeight: 700, color: 'var(--cyan)' }}>In Production (no plan)</span>
            <span className="text2">{line.directJcQty} pcs</span>
            <span className="mono text3" style={{ fontSize: 11 }}>
              {line.directJcCodes.join(', ')}
            </span>
          </div>
        ) : null}
      </td>
      <td style={wrapCell}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {line.hasEquipmentBom && perms.entry ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{
                color: 'var(--cyan)',
                fontWeight: 700,
                whiteSpace: 'normal',
              }}
              onClick={() => setModal({ kind: 'equip-bom', soLineId: line.soLineId })}
            >
              📦 Equipment BOM ({line.bomPartsCount})
            </button>
          ) : null}
          {line.hasAssemblyBom && perms.entry ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{
                color: 'var(--cyan)',
                fontWeight: 700,
                whiteSpace: 'normal',
              }}
              onClick={() => setModal({ kind: 'assembly-bom', soLineId: line.soLineId })}
            >
              📦 BOM Planning ({line.bomPartsCount})
            </button>
          ) : null}
          {/* ADR-171: a BUY line is purchased, not planned. SO
            lines get + PR; a JWSO line is the customer's own
            material and is never bought in. */}
          {line.itemProcurementType === 'buy' ? (
            so.source === 'jw' ? (
              <span className="text3" style={{ fontSize: 11 }}>
                Buy item — Customer material
              </span>
            ) : line.remaining > 0 && perms.entry ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ fontWeight: 700 }}
                onClick={() => setModal({ kind: 'raise-pr', soLineId: line.soLineId })}
              >
                + PR {line.remaining}
              </button>
            ) : null
          ) : !line.hasEquipmentBom && line.remaining > 0 && perms.entry ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ fontWeight: 700 }}
              onClick={() => setModal({ kind: 'create', soLineId: line.soLineId })}
            >
              + Plan {line.remaining}
            </button>
          ) : null}
          {/* ADR-180: book free stock to this line (Allocate) or
            give a booking back (Release). Neither moves
            Physical stock. */}
          {perms.entry && line.itemId ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--amber2)', fontWeight: 700 }}
              disabled={allocateCap(lineFacts(so.soCode, line)) <= 0}
              title={
                allocateCap(lineFacts(so.soCode, line)) > 0
                  ? `Allocate up to ${allocateCap(lineFacts(so.soCode, line))} pcs of free stock to this line`
                  : 'Nothing can be allocated to this line right now'
              }
              onClick={() => setModal({ kind: 'allocate', soLineId: line.soLineId })}
            >
              Allocate
            </button>
          ) : null}
          {perms.entry && line.reservedQty > 0 ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--purple)', fontWeight: 700 }}
              title={`Give back some or all of the ${line.reservedQty} pcs reserved to this line`}
              onClick={() => setModal({ kind: 'release', soLineId: line.soLineId })}
            >
              Release
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
