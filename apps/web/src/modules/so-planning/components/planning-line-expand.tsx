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

import type { PlanningLine, PlanningPlanSummary } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { RowMenu, type RowMenuItem } from '@/ui/data';
import type { RenderLink } from '@/ui/layout';
import { PrChip, planStatusOf } from './plan-chip';
import { hasPartRows } from './planning-line-menu';
import { lineStatusOf } from './planning-shared';

/** Make / Buy / OSP — the same three words the plan chip uses. */
function planTypeLabel(plan: PlanningPlanSummary): string {
  if (plan.planType === 'direct_purchase') return 'Buy';
  if (plan.planType === 'full_outsource') return 'OSP';
  return 'Make';
}

/** The documents a plan has produced, as plain codes. They were loose links
 *  inside the old chip; in a table they are one cell. */
function planLinkedCodes(plan: PlanningPlanSummary): string[] {
  return [
    plan.productionOrderCode,
    plan.jcCode,
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
}

function buildItemRows(line: PlanningLine): ItemRow[] {
  const rows: ItemRow[] = [];
  const claimed = new Set<string>();
  for (const c of line.bomChildren) {
    claimed.add(c.childItemCode);
    const short = c.plannedQty < c.requiredQty;
    const forPart = line.plans.filter((p) => p.bomChildCode === c.childItemCode);
    if (forPart.length === 0) {
      rows.push({ key: `part-${c.childItemCode}`, part: c, partShort: short, plan: null });
      continue;
    }
    forPart.forEach((plan, i) => {
      rows.push({ key: plan.id, part: i === 0 ? c : null, partShort: short, plan });
    });
  }
  // Plans that answer to no part of this BOM: an ordinary line's plans, an
  // assembly plan (it carries no child code), or a child code the BOM no longer
  // lists. None may be dropped.
  for (const plan of line.plans) {
    if (plan.bomChildCode && claimed.has(plan.bomChildCode)) continue;
    rows.push({ key: plan.id, part: null, partShort: false, plan });
  }
  return rows;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <span>
      <span className="mono text3" style={{ fontSize: 11 }}>
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
  const showName = itemRows.some((r) => {
    const code = r.part?.childItemCode ?? r.plan?.itemCode ?? r.plan?.itemCodeText ?? '';
    const name = r.part ? r.part.childItemName : (r.plan?.itemName ?? r.plan?.itemNameText);
    return Boolean(name) && name !== code;
  });
  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'var(--sp-4)',
          fontSize: 12,
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
        <div className="text3" style={{ fontSize: 12 }}>
          No plans or purchase requests on this line yet.
        </div>
      ) : null}

      {/* ADR-216 — one row per item. A plan and the part it is for are the same
          subject, so they are one row, not a parts table above a run of chips.
          The part columns appear only on a line that HAS parts; an ordinary
          line gets the same table listing its plans. House table (ADR-199) in
          its nested `tbl-compact` density: codes mono, numbers right. */}
      {itemRows.length > 0 ? (
        <div
          className="tbl-wrap"
          style={{
            marginBottom: 'var(--sp-2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
          }}
        >
          <table className="innovic-table tbl-grid tbl-compact">
            <thead>
              <tr>
                <th>Item Code</th>
                {showName ? <th>Item Name</th> : null}
                {hasParts ? <th className="th-num">Qty per Set</th> : null}
                {hasParts ? <th className="th-num">Required</th> : null}
                {hasParts ? <th className="th-num">Planned</th> : null}
                <th>Plan No.</th>
                <th>Type</th>
                <th className="th-num">Plan Qty</th>
                <th>Planned Start</th>
                <th>Planned End</th>
                <th>Plan Status</th>
                <th>Linked</th>
                {showMenu ? <th style={{ width: 40 }} aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {itemRows.map((row) => {
                const { part, plan } = row;
                // A part's own code when the row belongs to one, else the
                // plan's own item (`itemCode ?? itemCodeText`, live over
                // snapshot — the house pattern).
                const code = part?.childItemCode ?? plan?.itemCode ?? plan?.itemCodeText ?? '—';
                const name = part ? part.childItemName : (plan?.itemName ?? plan?.itemNameText);
                const st = plan ? planStatusOf(plan) : null;
                const linked = plan ? planLinkedCodes(plan) : [];
                return (
                  <tr key={row.key} className={row.partShort ? 'row-pending' : undefined}>
                    <td className="td-code">{code}</td>
                    {showName ? <td>{name && name !== code ? name : ''}</td> : null}
                    {hasParts ? <td className="td-num">{part ? part.qtyPerSet : ''}</td> : null}
                    {hasParts ? (
                      <td className="td-num fw-700">{part ? part.requiredQty : ''}</td>
                    ) : null}
                    {hasParts ? (
                      <td
                        className="td-num fw-700"
                        style={part && row.partShort ? { color: 'var(--amber2)' } : undefined}
                        title={
                          part && row.partShort
                            ? `${part.requiredQty - part.plannedQty} of ${part.requiredQty} still to plan for this part`
                            : undefined
                        }
                      >
                        {part ? part.plannedQty : ''}
                        {part && row.partShort ? ' ⚠' : ''}
                      </td>
                    ) : null}
                    {/* No plan against this part yet — the gap this table exists
                        to show. Said in words, not left as an empty row. */}
                    {plan === null ? (
                      // 7 = Plan No. + Type + Plan Qty + Planned Start +
                      // Planned End + Plan Status + Linked.
                      <td className="text3" colSpan={7}>
                        No plan yet
                      </td>
                    ) : (
                      <>
                        <td className="td-code">{plan.code}</td>
                        <td>{planTypeLabel(plan)}</td>
                        <td className="td-num fw-700">{plan.planQty}</td>
                        <td className="mono">{fmtDate(plan.plannedStartDate)}</td>
                        <td className="mono">{fmtDate(plan.plannedEndDate)}</td>
                        <td style={{ color: st?.color, fontWeight: 700 }}>{st?.label}</td>
                        <td className="mono" title={linked.join(', ')}>
                          {linked.length > 0 ? linked.join(', ') : '—'}
                        </td>
                      </>
                    )}
                    {showMenu && rowMenu ? (
                      <td style={{ textAlign: 'center' }}>
                        <RowMenu
                          items={rowMenu(plan, row.partShort)}
                          renderLink={renderLink}
                          label={`Actions for ${plan?.code ?? code}`}
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
    </div>
  );
}
