// Columns for level 2 of SO/JWSO Planning — the lines of ONE order, on the
// shared FIT table (ADR-199, TABLE_KEYS.planningLines). Replaces the hand-built
// fixed-layout sheet that lived in order-detail.tsx and the per-row component
// order-line-row.tsx (both deleted with this change).
//
// What changed, and why:
//   - EVERY row is one line now. The old sheet let a cell wrap over several
//     lines, so a line with two plans was four rows tall and the Available cell
//     carried a second "n reserved here" line that overflowed its 6% column.
//     The figures the planner only needs while allocating (POL, Reserved here,
//     Physical) moved into the ▸ panel (planning-line-expand.tsx).
//   - The Plans column holds the plan CODE and its status and nothing else; the
//     qty, ops count, vendor, Production Order / Job Card / PR links are in the
//     ▸ panel and every ACTION is in the row's ⋯ (planning-line-menu.ts).
//   - Numbers are right-aligned (owner decision 2026-09-26); the item code, the
//     item name and the Plans summary read left, as the owner approved for this
//     screen.
//
// ADR-180: Available = Physical − Reserved. Physical and the two Reserved
// figures stay in the Available cell's tooltip, as before.

import type { PlanningDetailResponse, PlanningLine } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';
import { planStatusOf, prStatusOf } from './plan-chip';
import { lineStatusOf } from './planning-shared';

/** The Plans cell as plain text — the cell's own `title` (so the hover shows
 *  every plan when the column is cut) and what Sort & Filter reads. */
export function plansCellText(line: PlanningLine): string {
  const parts = [
    ...line.plans.map((p) => `${p.code} ${planStatusOf(p).label}`),
    ...line.prs.map((pr) => `${pr.code} ${prStatusOf(pr).label}`),
  ];
  return parts.join(' · ');
}

export function planningLineColumns(
  source: PlanningDetailResponse['source'],
): DataTableColumn<PlanningLine>[] {
  return [
    {
      // Column 0 — always pinned, never dropped into ▸.
      id: 'line_no',
      header: 'Ln',
      kind: 'num',
      align: 'right',
      className: 'mono fw-700 text3',
      nowrap: true,
      render: (l) => l.lineNo,
      filterValue: (l) => l.lineNo,
    },
    {
      // `CODE/REV` — the customer's drawing revision from this line; a JW line
      // has none and keeps the bare code. The code is the main thing: strong
      // mono, darkest text.
      id: 'item_code',
      header: 'Item Code',
      kind: 'code',
      align: 'left',
      nowrap: true,
      render: (l) => (
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {itemCodeWithRev(l.itemCode, l.itemRevision, '')}
        </span>
      ),
      title: (l) => itemCodeWithRev(l.itemCode, l.itemRevision, ''),
      filterValue: (l) => itemCodeWithRev(l.itemCode, l.itemRevision, ''),
    },
    {
      id: 'item_name',
      header: 'Item Name',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      render: (l) => (
        <>
          {l.itemName ?? '—'}
          {/* ADR-171: Item Master "Source" — why the ⋯ offers Plan (make) or
              Raise PR (buy). */}
          <span
            className={`badge ${l.itemProcurementType === 'buy' ? 'b-amber' : 'b-grey'}`}
            style={{ fontSize: 11, padding: '0 6px', marginLeft: 6 }}
            title={
              l.itemProcurementType === 'buy'
                ? 'Bought-in item — raise a purchase request'
                : 'Made in-house — plan it'
            }
          >
            {l.itemProcurementType === 'buy' ? 'Buy' : 'Make'}
          </span>
          {l.itemProcurementType === 'buy' && source === 'jw' ? (
            <span className="text3" style={{ fontSize: 11, marginLeft: 4 }}>
              Customer material
            </span>
          ) : null}
        </>
      ),
      title: (l) => l.itemName ?? '',
      filterValue: (l) => l.itemName,
    },
    {
      id: 'order_qty',
      header: 'Order Qty',
      kind: 'num',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (l) => l.orderQty,
      filterValue: (l) => l.orderQty,
    },
    {
      // ADR-180: Physical never moves when stock is reserved — only a
      // dispatch / issue changes it. "n reserved here" is in the ▸ panel.
      id: 'available',
      header: 'Available',
      kind: 'num',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (l) => (
        <span style={{ color: l.availableQty > 0 ? 'var(--green)' : 'var(--text3)' }}>
          {l.availableQty}
        </span>
      ),
      title: (l) =>
        `Physical ${l.physicalQty} · Reserved (all lines) ${l.totalReservedQty} · Reserved (this line) ${l.reservedQty}`,
      filterValue: (l) => l.availableQty,
    },
    {
      id: 'to_plan',
      header: 'To Plan',
      kind: 'num',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (l) => (
        <span style={{ color: l.remaining > 0 ? 'var(--amber)' : 'var(--green)' }}>
          {l.remaining}
        </span>
      ),
      title: (l) => `Balance (Order − Dispatched − Reserved) ${l.balanceToPlan}`,
      filterValue: (l) => l.remaining,
    },
    {
      id: 'plan_qty',
      header: 'Plan Qty',
      kind: 'num',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (l) => <span style={{ color: 'var(--cyan)' }}>{l.totalPlanned}</span>,
      filterValue: (l) => l.totalPlanned,
    },
    {
      id: 'in_production',
      header: 'In Production',
      kind: 'num',
      align: 'right',
      className: 'mono',
      nowrap: true,
      render: (l) => (
        <span
          style={{ color: lineStatusOf(l).hasDirectJc ? 'var(--cyan)' : 'var(--text3)' }}
          title="Job Card(s) created directly from SO Status — counted as covered."
        >
          {l.directJcQty}
        </span>
      ),
      filterValue: (l) => l.directJcQty,
    },
    {
      id: 'dispatched',
      header: 'Dispatched',
      kind: 'num',
      align: 'right',
      className: 'mono',
      nowrap: true,
      render: (l) => (
        <span style={{ color: l.dispatchedQty > 0 ? 'var(--green)' : 'var(--text3)' }}>
          {l.dispatchedQty}
        </span>
      ),
      title: () => 'Already shipped to the customer against this line',
      filterValue: (l) => l.dispatchedQty,
    },
    {
      id: 'due_date',
      header: 'Due Date',
      kind: 'date',
      nowrap: true,
      render: (l) => <span className="mono">{fmtDate(l.dueDate)}</span>,
      filterValue: (l) => l.dueDate,
    },
    {
      // Label + percent on ONE line — the old cell stacked them.
      id: 'plan_status',
      header: 'Plan Status',
      kind: 'badge',
      nowrap: true,
      render: (l) => {
        const st = lineStatusOf(l);
        return (
          <span style={{ fontSize: 11, fontWeight: 700, color: st.color }}>
            {st.label} <span className="mono text3">· {st.pct}%</span>
          </span>
        );
      },
      title: (l) => {
        const st = lineStatusOf(l);
        return `${st.label} · ${st.pct}%`;
      },
      filterValue: (l) => lineStatusOf(l).label,
    },
    {
      // Pinned: the plan code is why a planner opens this screen, so it stays
      // on screen however narrow the sheet gets. Everything about a plan other
      // than its code + status is in the ▸ panel.
      id: 'plans',
      header: 'Plans',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      render: (l) => {
        if (l.plans.length === 0 && l.prs.length === 0) {
          return (
            <span className="text3" style={{ fontSize: 11 }}>
              —
            </span>
          );
        }
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {l.plans.map((p) => {
              const st = planStatusOf(p);
              return (
                <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span className="mono fw-700" style={{ color: 'var(--blue)' }}>
                    {p.code}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: st.color }}>{st.label}</span>
                </span>
              );
            })}
            {/* ADR-171: purchase requests raised from this BUY line. */}
            {l.prs.map((pr) => {
              const st = prStatusOf(pr);
              return (
                <span key={pr.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span className="mono fw-700" style={{ color: 'var(--blue)' }}>
                    {pr.code}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: st.color }}>{st.label}</span>
                </span>
              );
            })}
          </span>
        );
      },
      title: (l) => plansCellText(l),
      filterValue: (l) => plansCellText(l),
    },
  ];
}
