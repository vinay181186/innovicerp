// What the ▸ row reveals under one SO/JWSO Planning line (level 2, ADR-199
// fit table). Everything the old sheet crammed into its cells and could not
// fit on one line:
//   - POL (the CUSTOMER's PO line number) — it used to sit under the item code;
//   - Reserved here and Physical (ADR-180) — "n reserved here" used to be a
//     second line inside the Available cell, which overflowed its column;
//   - one chip per plan (code · type · qty · ops · vendor · status, with links
//     to its Production Order / purchase requests / Job Card);
//   - one chip per purchase request raised from a BUY line (ADR-171);
//   - the "In Production (no plan)" block — Job Cards raised straight from SO
//     Status, shown so planners see production that bypassed planning and do
//     not double-issue.
// Every ACTION is in a ⋯ menu (planning-line-menu.ts), never a button here:
// the line's own ⋯, and each item row's ⋯ (planChildMenu) for its plan.

import {
  docText,
  planJcs,
  planOwnJc,
  planPros,
  planRouteCards,
  rcText,
  type PlanningLine,
  type PlanningPlanSummary,
} from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { DataTable, type DataTableColumn, type RowMenuItem } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import type { RenderLink } from '@/ui/layout';
import { PrChip, planStatusOf } from './plan-chip';
import { DocCode, DocCodes, PendingText, RcCodes } from './planning-doc-cells';
import { hasPartRows } from './planning-line-menu';
import { lineStatusOf } from './planning-shared';

/** Make / Buy / OSP — the same three words the plan chip uses. */
function planTypeLabel(plan: PlanningPlanSummary): string {
  if (plan.planType === 'direct_purchase') return 'Buy';
  if (plan.planType === 'full_outsource') return 'OSP';
  return 'Make';
}

/** The purchase requests a plan has raised, as plain codes. The Route Card,
 *  Production Orders and Job Cards have their own columns now
 *  (planning-doc-cells.tsx); "Linked" keeps only the PRs. */
function planLinkedCodes(plan: PlanningPlanSummary): string[] {
  return [
    plan.dpPrCode,
    plan.foPrCode,
    plan.foMatPrCode,
    ...plan.ospPrs.map((pr) => pr.code),
  ].filter((c): c is string => Boolean(c));
}

/** ONE row of the per-item table. A part with no plan still gets a row — that
 *  is how an unplanned part stays visible. `part` is set only on the FIRST row
 *  of a part's group, so a part with two plans does not print its requirement
 *  twice and read as double. */
interface ItemRow {
  key: string;
  part: PlanningLine['bomChildren'][number] | null;
  partShort: boolean;
  plan: PlanningPlanSummary | null;
  /** ADR-307: the customer supplies this part — never planned, no ⋯ actions. */
  customer: boolean;
}

function buildItemRows(line: PlanningLine): ItemRow[] {
  const rows: ItemRow[] = [];
  const claimed = new Set<string>();
  for (const c of line.bomChildren) {
    claimed.add(c.childItemCode);
    const customer = c.bomType === 'party_supplied';
    const short = !customer && c.plannedQty < c.requiredQty;
    const forPart = line.plans.filter((p) => p.bomChildCode === c.childItemCode);
    if (forPart.length === 0) {
      rows.push({
        key: `part-${c.childItemCode}`,
        part: c,
        partShort: short,
        plan: null,
        customer,
      });
      continue;
    }
    forPart.forEach((plan, i) => {
      rows.push({ key: plan.id, part: i === 0 ? c : null, partShort: short, plan, customer });
    });
  }
  // Plans that answer to no part of this BOM: an ordinary line's plans, an
  // assembly plan (it carries no child code), or a child code the BOM no longer
  // lists. None may be dropped.
  for (const plan of line.plans) {
    if (plan.bomChildCode && claimed.has(plan.bomChildCode)) continue;
    rows.push({ key: plan.id, part: null, partShort: false, plan, customer: false });
  }
  return rows;
}

/** One line per PRO, in the PRO column's order, so each Job Card sits beside
 *  its own Production Order ("Pending" where that PRO has no live JC yet);
 *  the plan's own Job Card (made without a PRO) follows. */
function PlanJcCell({ plan }: { plan: PlanningPlanSummary }): JSX.Element {
  const own = planOwnJc(plan);
  if (plan.productionOrders.length === 0 && !own) return <PendingText />;
  return (
    <>
      {plan.productionOrders.map((po) => (
        <div key={po.id}>
          {po.jcCode ? (
            <DocCode doc={{ code: po.jcCode, id: po.jobCardId }} kind="jc" />
          ) : (
            <PendingText />
          )}
        </div>
      ))}
      {own ? (
        <div>
          <DocCode doc={own} kind="jc" />
        </div>
      ) : null}
    </>
  );
}

/** A part's own code when the row belongs to one, else the plan's own item
 *  (`itemCode ?? itemCodeText`, live over snapshot — the house pattern). */
function itemCodeOf(r: ItemRow): string {
  return r.part?.childItemCode ?? r.plan?.itemCode ?? r.plan?.itemCodeText ?? '—';
}
function itemNameOf(r: ItemRow): string {
  const name = r.part ? r.part.childItemName : (r.plan?.itemName ?? r.plan?.itemNameText);
  return name && name !== itemCodeOf(r) ? name : '';
}

/** A plan cell; empty on a part with no plan yet (Plan No. says so in words). */
function planCell(
  r: ItemRow,
  draw: (plan: PlanningPlanSummary) => React.ReactNode,
): React.ReactNode {
  return r.plan ? draw(r.plan) : null;
}

/** The per-item table's columns. The three part columns only on a line that
 *  has BOM parts; Item Name only when some name differs from its code. */
function partColumns(hasParts: boolean, showName: boolean): DataTableColumn<ItemRow>[] {
  const cols: DataTableColumn<ItemRow>[] = [
    {
      id: 'item_code',
      header: 'Item Code',
      kind: 'code',
      className: 'td-code',
      render: (r) => <span style={{ color: 'var(--text)' }}>{itemCodeOf(r)}</span>,
      filterValue: (r) => itemCodeOf(r),
    },
  ];
  if (showName) {
    cols.push({
      id: 'item_name',
      header: 'Item Name',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      render: (r) => itemNameOf(r),
      title: (r) => itemNameOf(r),
      filterValue: (r) => itemNameOf(r),
    });
  }
  if (hasParts) {
    // A part's requirement is printed on its FIRST row only, so a part with
    // two plans does not read as double.
    cols.push(
      {
        id: 'qty_per_set',
        header: 'Qty per Set',
        kind: 'num',
        render: (r) => (r.part ? r.part.qtyPerSet : ''),
        filterValue: (r) => r.part?.qtyPerSet ?? null,
      },
      {
        id: 'required',
        header: 'Required',
        kind: 'num',
        className: 'fw-700',
        render: (r) => (r.part ? r.part.requiredQty : ''),
        filterValue: (r) => r.part?.requiredQty ?? null,
      },
      {
        id: 'planned',
        header: 'Planned',
        kind: 'num',
        className: 'fw-700',
        render: (r) =>
          r.part ? (
            <span style={r.partShort ? { color: 'var(--amber2)' } : undefined}>
              {r.part.plannedQty}
              {r.partShort ? ' ⚠' : ''}
            </span>
          ) : (
            ''
          ),
        title: (r) =>
          r.part && r.partShort
            ? `${r.part.requiredQty - r.part.plannedQty} of ${r.part.requiredQty} still to plan for this part`
            : '',
        filterValue: (r) => r.part?.plannedQty ?? null,
      },
    );
  }
  cols.push(
    {
      id: 'plan_no',
      header: 'Plan No.',
      kind: 'code',
      className: 'td-code',
      render: (r) =>
        r.plan ? r.plan.code : r.customer ? '—' : <span className="text3">No plan yet</span>,
      filterValue: (r) => r.plan?.code ?? (r.customer ? '' : 'No plan yet'),
    },
    {
      id: 'type',
      header: 'Type',
      kind: 'badge',
      render: (r) =>
        r.customer && !r.plan ? (
          <span className="text3">Customer supplies</span>
        ) : (
          planCell(r, planTypeLabel)
        ),
      filterValue: (r) => (r.plan ? planTypeLabel(r.plan) : r.customer ? 'Customer supplies' : ''),
    },
    {
      id: 'plan_qty',
      header: 'Plan Qty',
      kind: 'num',
      className: 'fw-700',
      render: (r) => planCell(r, (p) => p.planQty),
      filterValue: (r) => r.plan?.planQty ?? null,
    },
    {
      id: 'planned_start',
      header: 'Planned Start',
      kind: 'date',
      className: 'mono',
      render: (r) => planCell(r, (p) => fmtDate(p.plannedStartDate)),
      filterValue: (r) => r.plan?.plannedStartDate ?? null,
    },
    {
      id: 'planned_end',
      header: 'Planned End',
      kind: 'date',
      className: 'mono',
      render: (r) => planCell(r, (p) => fmtDate(p.plannedEndDate)),
      filterValue: (r) => r.plan?.plannedEndDate ?? null,
    },
    {
      id: 'plan_status',
      header: 'Plan Status',
      kind: 'badge',
      render: (r) =>
        planCell(r, (p) => {
          const st = planStatusOf(p);
          return <span style={{ color: st.color, fontWeight: 700 }}>{st.label}</span>;
        }),
      filterValue: (r) => (r.plan ? planStatusOf(r.plan).label : ''),
    },
    {
      id: 'rc_no',
      header: 'RC No.',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      render: (r) => planCell(r, (p) => <RcCodes rcs={planRouteCards(p)} />),
      title: (r) => (r.plan ? rcText(planRouteCards(r.plan)) : ''),
      filterValue: (r) => (r.plan ? rcText(planRouteCards(r.plan)) : ''),
    },
    {
      id: 'pro_no',
      header: 'PRO No.',
      kind: 'text',
      align: 'left',
      render: (r) => planCell(r, (p) => <DocCodes docs={planPros(p)} kind="pro" stacked />),
      title: (r) => (r.plan ? docText(planPros(r.plan)) : ''),
      filterValue: (r) => (r.plan ? docText(planPros(r.plan)) : ''),
    },
    {
      id: 'jc_no',
      header: 'JC No.',
      kind: 'text',
      align: 'left',
      render: (r) => planCell(r, (p) => <PlanJcCell plan={p} />),
      title: (r) => (r.plan ? docText(planJcs(r.plan)) : ''),
      filterValue: (r) => (r.plan ? docText(planJcs(r.plan)) : ''),
    },
    {
      id: 'linked',
      header: 'Linked',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      className: 'mono',
      render: (r) => {
        if (!r.plan) return null;
        const linked = planLinkedCodes(r.plan);
        return linked.length > 0 ? linked.join(', ') : '—';
      },
      title: (r) => (r.plan ? planLinkedCodes(r.plan).join(', ') : ''),
      filterValue: (r) => (r.plan ? planLinkedCodes(r.plan).join(', ') : ''),
    },
  );
  return cols;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <span>
      <span className="mono text3" style={{ fontSize: 'var(--fs-xs)' }}>
        {label}
      </span>{' '}
      {children}
    </span>
  );
}

export interface PlanningLineExpandProps {
  line: PlanningLine;
  /** The ⋯ of one item row — `planChildMenu` (planning-line-menu.ts). A part
   *  with no plan yet passes `null`. Used only on a line WITH BOM parts; an
   *  ordinary line's plans keep their items on the line's own ⋯. */
  rowMenu?: ((plan: PlanningPlanSummary | null, partShort: boolean) => RowMenuItem[]) | undefined;
  renderLink?: RenderLink | undefined;
}

export function PlanningLineExpand({
  line,
  rowMenu,
  renderLink,
}: PlanningLineExpandProps): JSX.Element {
  const status = lineStatusOf(line);
  const itemRows = buildItemRows(line);
  const hasParts = hasPartRows(line);
  const showMenu = hasParts && rowMenu !== undefined;
  // A column of dashes is worse than no column: on data where the item's name
  // IS its code (and it is, on several masters) every cell would repeat the
  // code. Show the column only when some row actually adds something.
  const showName = itemRows.some((r) => itemNameOf(r) !== '');
  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'var(--sp-4)',
          fontSize: 'var(--fs-sm)',
          marginBottom: 'var(--sp-2)',
        }}
      >
        {/* POL is the CUSTOMER's own line number — an extra value beside our
            "Ln", never a substitute for it. */}
        <Fact label="POL">
          <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
            {line.clientPoLineNo ?? '—'}
          </span>
        </Fact>
        {line.reservedQty > 0 ? (
          <Fact label="Reserved here">
            <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
              {line.reservedQty}
            </span>
          </Fact>
        ) : null}
        <Fact label="Physical">
          <span className="mono fw-700" style={{ color: 'var(--cyan)' }}>
            {line.physicalQty}
          </span>
        </Fact>
      </div>

      {line.plans.length === 0 && line.prs.length === 0 && !status.hasDirectJc ? (
        <div className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
          No plans or purchase requests on this line yet.
        </div>
      ) : null}

      {/* ADR-216 — one row per item. A plan and the part it is for are the same
          subject, so they are one row, not a parts table above a run of chips.
          The part columns appear only on a line that HAS parts; an ordinary
          line gets the same table listing its plans. The shared FIT table
          (ADR-199) in its nested `compact` density, as BOM Master's part list:
          columns that do not fit leave the screen by name, never a side
          scroll, and every header gets its ▾ (ADR-200). */}
      {itemRows.length > 0 ? (
        <DataTable<ItemRow>
          tableKey={TABLE_KEYS.planningParts}
          columns={partColumns(hasParts, showName)}
          rows={itemRows}
          rowKey={(r) => r.key}
          density="compact"
          sortFilter
          defaultPinned={['plan_no']}
          rowClassName={(r) => (r.partShort ? 'row-pending' : undefined)}
          {...(showMenu && rowMenu
            ? {
                // ADR-307: a customer part offers no Plan / Raise PR action.
                rowMenu: (r: ItemRow) => (r.customer ? [] : rowMenu(r.plan, r.partShort)),
                rowMenuLabel: (r: ItemRow) => `Actions for ${r.plan?.code ?? itemCodeOf(r)}`,
                renderLink,
              }
            : {})}
          emptyText="No plans yet."
        />
      ) : null}

      {line.prs.map((pr) => (
        <PrChip key={pr.id} pr={pr} />
      ))}

      {status.hasDirectJc ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 6,
            padding: '3px 8px',
            margin: 'var(--sp-0) 0',
            background: 'var(--cyan3)',
            border: '1px solid var(--cyan2)',
            borderRadius: 'var(--radius)',
            fontSize: 'var(--fs-xs)',
          }}
          title="Job Card(s) created directly from SO Status — counted as covered."
        >
          <span>🏭</span>
          <span style={{ fontWeight: 700, color: 'var(--cyan)' }}>In Production (no plan)</span>
          <span className="text2">{line.directJcQty} pcs</span>
          <span className="mono text3" style={{ fontSize: 'var(--fs-xs)' }}>
            {line.directJcCodes.join(', ')}
          </span>
        </div>
      ) : null}
    </div>
  );
}
