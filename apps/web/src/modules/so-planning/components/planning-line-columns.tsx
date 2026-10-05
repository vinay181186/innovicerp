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

import {
  planningLineStatus,
  type PlanningLineState,
  type PlanningDetailResponse,
  type PlanningLine,
} from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';
import { planChildItemOf, planStatusOf, prStatusOf } from './plan-chip';
import { lineStatusOf } from './planning-shared';

/** The Plan Status ▾ tick list. A `badge` column filters on DISTINCT values, so
 *  it must offer the five states and not the on-screen label, which carries the
 *  pending qty ("Partly Planned (450 pending)") and would give one tick box per
 *  line. */
const PLANNING_STATE_LABEL: Record<PlanningLineState, string> = {
  unplanned: 'Unplanned',
  partly_planned: 'Partly Planned',
  in_planning: 'In Planning',
  in_production_no_plan: 'In Production (no plan)',
  fully_planned: 'Fully Planned',
};

/** The Plans cell as plain text — the cell's own `title` (so the hover shows
 *  every plan when the column is cut) and what Sort & Filter reads. */
export function plansCellText(line: PlanningLine): string {
  const parts = [
    // PRs first, then plans — the same order the ▸ panel uses, so the cell and
    // the panel never read differently.
    ...line.prs.map((pr) => `${pr.code} ${prStatusOf(pr).label}`),
    // ADR-216: the BOM CHILD part a plan is for goes in the text too, or the
    // row reads "PLN-0008 · PLN-0009" with no way to tell the two apart and
    // Sort & Filter cannot find a part by its code at all. The part's NAME
    // rides along as well: it is the one place the collapsed row can carry it
    // (the cell itself stays compact), so a planner can search "WHEEL".
    ...line.plans.map((p) => {
      const child = planChildItemOf(p);
      return [p.code, child?.code, child?.name, planStatusOf(p).label]
        .filter((s): s is string => !!s)
        .join(' ');
    }),
    ...(line.directJcQty > 0
      ? [`${line.directJcCodes.join(', ') || 'Job Card'} In Production (no plan)`]
      : []),
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
      // The badge explains why the ⋯ offers Plan (make) or Raise PR (buy), and
      // this column clips — so the tooltip has to carry it, or a long item name
      // hides the one word that explains the row.
      title: (l) =>
        [
          l.itemName ?? '',
          l.itemProcurementType === 'buy' ? 'Buy' : 'Make',
          l.itemProcurementType === 'buy' && source === 'jw' ? 'Customer material' : '',
        ]
          .filter(Boolean)
          .join(' · '),
      filterValue: (l) =>
        `${l.itemName ?? ''} ${l.itemProcurementType === 'buy' ? 'Buy' : 'Make'}`.trim(),
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
      // Carries the old COLUMN-header tooltip too ("Physical − Reserved: free
      // stock"), because a DataTable header takes no title.
      title: (l) =>
        `Physical − Reserved: free stock. Physical ${l.physicalQty} · Reserved (all lines) ${l.totalReservedQty} · Reserved (this line) ${l.reservedQty}`,
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
      // Same: the old header tooltip defined the column, and it was the only
      // place on the sheet that explained the number the screen is built around.
      title: (l) =>
        `Order − Planned − direct Job Cards: still to plan. The same number Plan / Raise PR use. Balance (Order − Dispatched − Reserved) ${l.balanceToPlan}`,
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
        <span style={{ color: l.directJcQty > 0 ? 'var(--cyan)' : 'var(--text3)' }}>
          {l.directJcQty}
        </span>
      ),
      // Only a line that HAS one gets the explanation; a bare 0 gets no tooltip.
      title: (l) =>
        l.directJcQty > 0
          ? `Job Card(s) created directly from SO Status — counted as covered.${l.directJcCodes.length > 0 ? ` ${l.directJcCodes.join(', ')}` : ''}`
          : '',
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
      // The tick list must offer the five STATES, not one entry per pending qty:
      // the label reads "Partly Planned (450 pending)", so filtering on it gave
      // a distinct option for every line on the order.
      filterValue: (l) => PLANNING_STATE_LABEL[planningLineStatus(l).state],
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
        // A line can be covered by a Job Card raised straight off the SO, with
        // no plan at all. Showing "—" there would say nothing covers a line
        // that is on the floor right now, so the Job Card stands in for it.
        if (l.plans.length === 0 && l.prs.length === 0 && l.directJcQty <= 0) {
          return (
            <span className="text3" style={{ fontSize: 11 }}>
              —
            </span>
          );
        }
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {/* ADR-171: purchase requests raised from this BUY line. Same order
                as the ▸ panel. */}
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
            {l.plans.map((p) => {
              const st = planStatusOf(p);
              // ADR-216: a plan on a BOM parent's line is for a CHILD part, so
              // the code of that part goes beside the plan number — bare, never
              // CODE/REV (that revision belongs to the customer's drawing on
              // the PARENT line). Code only: the cell is fitted, and the part
              // name is in the ▸ panel and the cell's tooltip.
              const child = planChildItemOf(p);
              return (
                <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span className="mono fw-700" style={{ color: 'var(--blue)' }}>
                    {p.code}
                  </span>
                  {child ? (
                    <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                      {child.code}
                    </span>
                  ) : null}
                  <span style={{ fontSize: 11, fontWeight: 700, color: st.color }}>{st.label}</span>
                </span>
              );
            })}
            {l.directJcQty > 0 ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span className="mono fw-700" style={{ color: 'var(--cyan)' }}>
                  {l.directJcCodes.join(', ') || 'Job Card'}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)' }}>
                  In Production (no plan)
                </span>
              </span>
            ) : null}
          </span>
        );
      },
      title: (l) => plansCellText(l),
      filterValue: (l) => plansCellText(l),
    },
  ];
}
