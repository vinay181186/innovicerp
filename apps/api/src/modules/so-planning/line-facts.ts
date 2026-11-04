// SO Planning (ADR-268) — the facts of a line that are not its plans: PRs raised
// on it, Job Cards raised straight on it, its procurement type, the live customer
// name. Read by the order detail (service.ts) and the Planning list
// (list-lines.ts). All moved here unchanged from service.ts, except
// loadDirectJcsByLine, which replaces the two copies the SO and JW detail had.

import type { ItemProcurementType, PlanningLine } from '@innovic/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  jobCards,
  jobWorkOrders,
  plans,
  purchaseOrders,
  purchaseRequests,
  salesOrders,
} from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { prCoverQtyRaw } from '../../lib/so-line-coverage';

/** Which table a line id belongs to: 'so' = sales_order_lines, 'jw' = job_work_order_lines. */
export type LineSource = 'so' | 'jw';

export const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

/** ADR-171 — 'make' unless the Item Master says 'buy'. A free-text line (no
 *  item) is 'make': it can only ever be planned, never bought through + PR. */
export function toProcurementType(raw: string | null | undefined): ItemProcurementType {
  return raw === 'buy' ? 'buy' : 'make';
}

/** The filter that makes a purchase request "this SO line's PR" (ADR-171):
 *  a standard PR raised straight against the line — not an OSP PR, which
 *  hangs off a JC op and belongs to a plan's card, not the line. */
function linePrFilter(companyId: string, lineIds: string[]) {
  return and(
    eq(purchaseRequests.companyId, companyId),
    inArray(purchaseRequests.sourceSoLineId, lineIds),
    isNull(purchaseRequests.deletedAt),
    isNull(purchaseRequests.sourceJcOpId),
    eq(purchaseRequests.prType, 'standard'),
    NOT_A_PLAN_PR,
  );
}

/** A PR that an OLD direct-purchase / full-outsource plan raised on Execute
 *  also carries `source_so_line_id` and `pr_type='standard'` — but that qty is
 *  already counted through the plan's `plan_qty`. Counting it again here would
 *  double a Buy line's planned qty the moment its item is flagged Buy (exactly
 *  the migration story). The plan points at its PR through dp_pr_id /
 *  fo_pr_id / fo_mat_pr_id / material_pr_id, so those PRs are not "line PRs". */
const NOT_A_PLAN_PR = sql`NOT EXISTS (
  SELECT 1 FROM ${plans} p
  WHERE p.deleted_at IS NULL
    AND ${purchaseRequests.id} IN (p.dp_pr_id, p.fo_pr_id, p.fo_mat_pr_id, p.material_pr_id)
)`;

type LinePrs = { prs: PlanningLine['prs']; prQty: number };

/**
 * ADR-171 — purchase requests raised from the Planning line, keyed by SO line
 * id. `prQty` is the live total (cancelled PRs excluded); `prs` lists every one
 * including cancelled so the chip row tells the whole story. `poCode` is the
 * purchase order stamped on the PR (`purchase_requests.po_id`, the first PO
 * raised from it), when any.
 */
export async function loadPrsByLine(
  tx: DbTransaction,
  companyId: string,
  lineIds: string[],
): Promise<Map<string, LinePrs>> {
  const map = new Map<string, LinePrs>();
  if (lineIds.length === 0) return map;
  const rows = await tx
    .select({
      id: purchaseRequests.id,
      code: purchaseRequests.code,
      qty: purchaseRequests.qty,
      // ADR-189 — what the PR still covers (ordered only, once balance-closed).
      coverQty: sql<number>`${sql.raw(prCoverQtyRaw('purchase_requests'))}::numeric`,
      status: purchaseRequests.status,
      soLineId: purchaseRequests.sourceSoLineId,
      poCode: purchaseOrders.code,
    })
    .from(purchaseRequests)
    .leftJoin(
      purchaseOrders,
      and(eq(purchaseOrders.id, purchaseRequests.poId), isNull(purchaseOrders.deletedAt)),
    )
    .where(linePrFilter(companyId, lineIds))
    .orderBy(asc(purchaseRequests.code));
  for (const r of rows) {
    if (!r.soLineId) continue;
    const entry = map.get(r.soLineId) ?? { prs: [], prQty: 0 };
    entry.prs.push({
      id: r.id,
      code: r.code,
      qty: Number(r.qty),
      status: r.status,
      poCode: r.poCode ?? null,
    });
    if (r.status !== 'cancelled') entry.prQty += Number(r.coverQty);
    map.set(r.soLineId, entry);
  }
  return map;
}

// Plan v3 Step 4 — the customer name every Planning pane shows is the LIVE
// client master name via the order's client_id; the order's saved
// customer_name is only the fallback when it has no client_id.
export function liveSoCustomerName() {
  return sql<
    string | null
  >`COALESCE((SELECT c.name FROM public.clients c WHERE c.id = ${salesOrders.clientId} AND c.deleted_at IS NULL), ${salesOrders.customerName})`;
}
export function liveJwCustomerName() {
  return sql<
    string | null
  >`COALESCE((SELECT c.name FROM public.clients c WHERE c.id = ${jobWorkOrders.clientId} AND c.deleted_at IS NULL), ${jobWorkOrders.customerName})`;
}

/**
 * Job Cards created directly against these lines WITHOUT a plan (the source line
 * set, not referenced by any non-cancelled plan.jcId) — real production the plans
 * table can't see, counted as covered so Planning stops reporting "yet to plan"
 * while SO Status shows progress. One query, and ANY plan's jc_id counts, wherever
 * that plan sits: the rule of soLineDirectJcRaw (lib/so-line-coverage), so the list
 * and the order view read the same whichever plans each has loaded (ADR-268).
 */
export async function loadDirectJcsByLine(
  tx: DbTransaction,
  lines: ReadonlyArray<{ id: string; itemId: string | null }>,
  source: LineSource,
): Promise<Map<string, { qty: number; codes: string[] }>> {
  const directJcByLine = new Map<string, { qty: number; codes: string[] }>();
  if (lines.length === 0) return directJcByLine;
  const lineIds = lines.map((l) => l.id);
  const jcRows = await tx
    .select({
      id: jobCards.id,
      code: jobCards.code,
      soLineId: jobCards.sourceSoLineId,
      jwLineId: jobCards.sourceJwLineId,
      itemId: jobCards.itemId,
      orderQty: jobCards.orderQty,
    })
    .from(jobCards)
    .where(
      and(
        source === 'so'
          ? inArray(jobCards.sourceSoLineId, lineIds)
          : inArray(jobCards.sourceJwLineId, lineIds),
        isNull(jobCards.deletedAt),
        // ADR-185 — a Production Order's card belongs to its plan, never
        // a direct card, whether or not it is the plan's jc_id.
        isNull(jobCards.productionOrderId),
        // Rework/repair children are not extra coverage (gap 3). ADR-268: the
        // JW detail lacked this while the JW order list had it; now one rule.
        isNull(jobCards.recoveryKind),
        sql`NOT EXISTS (SELECT 1 FROM public.plans lp WHERE lp.jc_id = ${jobCards.id} AND lp.deleted_at IS NULL AND lp.plan_status <> 'cancelled')`,
      ),
    )
    .orderBy(asc(jobCards.code));
  // ADR-185 — only a card for the line's OWN item is direct coverage; a BOM
  // cascade's child cards (other items on the parent line) are not.
  const lineItemById = new Map(lines.map((l) => [l.id, l.itemId]));
  for (const jc of jcRows) {
    const lineId = source === 'so' ? jc.soLineId : jc.jwLineId;
    if (!lineId) continue;
    if ((jc.itemId ?? null) !== (lineItemById.get(lineId) ?? null)) continue;
    const entry = directJcByLine.get(lineId) ?? { qty: 0, codes: [] };
    entry.qty += jc.orderQty;
    entry.codes.push(jc.code);
    directJcByLine.set(lineId, entry);
  }
  return directJcByLine;
}
