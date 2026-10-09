// Multi-Level Plan (ADR-225 phase 4) — Raise orders from the plan's rows.
// Contract: packages/shared/src/schemas/ml-plan-orders.ts.
//
//   Manufacture row (the top row too) → a route-card Plan (createPlanInTx).
//       The TOP row's plan carries the SO line (the line's own plan: the
//       normal own-plan cap applies); every other row's plan has no SO line.
//   Outsource row → a full-outsource Plan (Vendor + Process), no SO line.
//   Buy row → a standard Purchase Request, vendor TBD (as raisePlanningPr),
//       no SO line.
//   Every one carries ml_plan_node_id = the row.
//
// ONE transaction: every row is raised, or none.
//
// Lock: the ml_plans row FIRST (FOR UPDATE) — the parent of every row's cap.
// createPlanInTx / insertPurchaseRequestTx then take their own locks (number
// series) in their normal order. Raised is read AFTER the lock, in a fresh
// statement, so two raises on one plan queue at the lock and the second sees
// what the first committed — Raised can never pass Net Need (§20.3). Every
// other qty writer of these documents (plan / PR edit) takes the same lock
// (edit-cap.ts).
//
// No SO line lock is needed here: the line cannot be pulled away meanwhile —
// SO cancel / close / line edit refuse while this live Multi-Level Plan
// exists (guards.ts assertNoLiveMlPlan…, under THEIR line lock) — and no
// other plan can land on the line: createPlanInTx on it refuses because of
// the live Multi-Level Plan (assertLineFreeForPlan). The only plans on the
// line are this plan's own, all raised under the ml_plans lock above.

import { sql } from 'drizzle-orm';
import {
  ActivityAction,
  type CreatePlanInput,
  type CreatePurchaseRequestInput,
  createPlanInputSchema,
  createPurchaseRequestInputSchema,
  sfTodayIst,
} from '@innovic/shared';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { assertUnchangedSinceOpened } from '../../lib/edit-conflict';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { createPlanInTx } from '../plans/service';
import { insertPurchaseRequestTx } from '../purchase-requests/service';
import { closedLineRefusal, readLineFacts, refusalMessage, soLabel } from './guards';
import { type RowRaises, raisesOf, readRaisedByNode } from './order-reads';
import { loadMlPlanDetail } from './reads';
import type { MlPlanDetail, RaiseMlPlanOrderLine, RaiseMlPlanOrdersInput } from './schema';
import { milliToText, toMilli } from './snapshot-math';
import { ENTITY, lockPlan, readFactsStillEligible, userName } from './writes';

type RowKind = RowRaises;

const KIND_WORD: Record<RowKind, string> = {
  plan: 'Manufacture',
  outsource_plan: 'Outsource',
  pr: 'Buy',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface NodeRow {
  id: string;
  depth: number;
  bomType: string | null;
  itemId: string;
  itemCode: string | null;
  itemName: string | null;
  netNeedQty: string;
  rawMaterialGradeText: string | null;
  rawMaterialSizeText: string | null;
}

const label = (n: NodeRow): string => n.itemCode ?? 'A row';

/** The plan's LIVE nodes among `ids`, keyed by id. */
async function readNodes(
  tx: DbTransaction,
  companyId: string,
  planId: string,
  ids: readonly string[],
): Promise<Map<string, NodeRow>> {
  const rows = (await tx.execute(sql`
    SELECT n.id, n.depth, n.bom_type::text AS bom_type, n.item_id,
           i.code AS item_code, i.name AS item_name,
           n.net_need_qty::text AS net_need_qty,
           n.raw_material_grade_text, n.raw_material_size_text
    FROM public.ml_plan_nodes n
    LEFT JOIN public.items i ON i.id = n.item_id
    WHERE n.ml_plan_id = ${planId}::uuid AND n.company_id = ${companyId}::uuid
      AND n.deleted_at IS NULL
      AND n.id = ANY(${sql.param(Array.from(new Set(ids)))}::uuid[])
  `)) as unknown as Array<Record<string, unknown>>;
  const out = new Map<string, NodeRow>();
  for (const r of rows) {
    out.set(String(r['id']), {
      id: String(r['id']),
      depth: Number(r['depth']),
      bomType: (r['bom_type'] as string | null) ?? null,
      itemId: String(r['item_id']),
      itemCode: (r['item_code'] as string | null) ?? null,
      itemName: (r['item_name'] as string | null) ?? null,
      netNeedQty: String(r['net_need_qty']),
      rawMaterialGradeText: (r['raw_material_grade_text'] as string | null) ?? null,
      rawMaterialSizeText: (r['raw_material_size_text'] as string | null) ?? null,
    });
  }
  return out;
}

/** Route Card facts per item: its plan type and how many live ops it has. */
async function readRouteCards(
  tx: DbTransaction,
  companyId: string,
  itemIds: readonly string[],
): Promise<Map<string, { planType: string; opCount: number }>> {
  const out = new Map<string, { planType: string; opCount: number }>();
  if (itemIds.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT rc.item_id, rc.plan_type::text AS plan_type,
           (SELECT COUNT(*)::int FROM public.route_card_ops o
            WHERE o.route_card_id = rc.id AND o.deleted_at IS NULL) AS op_count
    FROM public.route_cards rc
    WHERE rc.company_id = ${companyId}::uuid AND rc.deleted_at IS NULL
      AND rc.item_id = ANY(${sql.param(Array.from(new Set(itemIds)))}::uuid[])
  `)) as unknown as Array<{ item_id: string; plan_type: string; op_count: number }>;
  for (const r of rows) {
    out.set(String(r.item_id), { planType: String(r.plan_type), opCount: Number(r.op_count) });
  }
  return out;
}

/** Live vendors of the company among `ids` → their code. */
async function readVendors(
  tx: DbTransaction,
  companyId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT v.id, v.code FROM public.vendors v
    WHERE v.company_id = ${companyId}::uuid AND v.deleted_at IS NULL
      AND v.id = ANY(${sql.param(Array.from(new Set(ids)))}::uuid[])
  `)) as unknown as Array<{ id: string; code: string }>;
  for (const r of rows) out.set(String(r.id), String(r.code));
  return out;
}

/** Thousandths of a request qty, or null when it has more than 3 decimals. */
function qtyMilli(qty: number): bigint | null {
  const m = Math.round(qty * 1000);
  return Math.abs(qty * 1000 - m) > 1e-6 ? null : BigInt(m);
}

/** "5" for a whole number, "2.500" otherwise — for messages. */
const qtyWord = (milli: bigint): string =>
  milli % 1000n === 0n ? (milli / 1000n).toString() : milliToText(milli);

/** The first Zod issue, in words, prefixed with the item. */
function zodRefusal(item: string, issues: ReadonlyArray<{ message: string }>): ValidationError {
  return new ValidationError(`${item}: ${issues[0]?.message ?? 'invalid row'}`);
}

/** Re-throw a plan / PR creator's refusal naming the row it came from. */
function prefixed(item: string, e: unknown): unknown {
  if (e instanceof ValidationError) {
    return new ValidationError(`${item}: ${e.message} Nothing was saved.`);
  }
  if (e instanceof ConflictError) {
    return new ConflictError(`${item}: ${e.message} Nothing was saved.`);
  }
  return e;
}

/** A Released plan's SO line: only "still open" is re-checked (status and
 *  close-short of the SO and the line) — its rows are frozen, so item type,
 *  Default BOM, BOM Master and line_has_plans no longer apply. */
async function readFactsStillOpen(
  tx: DbTransaction,
  companyId: string,
  soLineId: string,
  planId: string,
) {
  const facts = await readLineFacts(tx, companyId, soLineId, planId);
  if (!facts) throw new NotFoundError('The SO line of this plan was removed.');
  const refusal = closedLineRefusal(facts);
  if (refusal) throw new ConflictError(refusalMessage({ ...facts, refusal }));
  return facts;
}

interface Prepared {
  line: RaiseMlPlanOrderLine;
  node: NodeRow;
  kind: RowKind;
  plan?: CreatePlanInput;
  pr?: CreatePurchaseRequestInput;
}

export async function raiseMlPlanOrdersTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  input: RaiseMlPlanOrdersInput,
  user: AuthContext,
): Promise<MlPlanDetail> {
  const nodeIds = input.lines.map((l) => l.nodeId);

  // §20.3 — the Multi-Level Plan row first (see the file header).
  const row = await lockPlan(tx, companyId, id);
  if (row.status === 'cancelled') {
    throw new ConflictError(`${row.code} is Cancelled — no orders can be raised from it.`);
  }
  // §20.4 — the screen raised from what it loaded.
  assertUnchangedSinceOpened(
    row.updatedAt,
    input.expectedUpdatedAt,
    await userName(tx, row.updatedBy),
  );
  // Draft: the SO line must still be plannable (its own plans and this
  // plan's orders do not count against it). Released: the rows are frozen,
  // so only the SO and the line still being open matters.
  const facts =
    row.status === 'released'
      ? await readFactsStillOpen(tx, companyId, row.soLineId, id)
      : await readFactsStillEligible(tx, companyId, row.soLineId, id);

  // 3. Every row: on this plan, live, a sane qty — and within To Raise,
  //    measured NOW, under the lock.
  const nodes = await readNodes(tx, companyId, id, nodeIds);
  const gone = input.lines.filter((l) => !nodes.has(l.nodeId));
  if (gone.length > 0) {
    throw new ConflictError(
      `${gone.length === 1 ? 'A row' : `${gone.length} rows`} you picked ${gone.length === 1 ? 'is' : 'are'} no longer on ${row.code} — reload.`,
    );
  }
  // Access per document kind: a plan needs the Plan form, a PR the PR form —
  // the same rights the planner would need to make them by hand.
  const kinds = new Set(Array.from(nodes.values()).map(raisesOf));
  if (kinds.has('plan') || kinds.has('outsource_plan')) {
    await requireFormAccess(user, 'plan_create', 'entry');
  }
  if (kinds.has('pr')) await requireFormAccess(user, 'pr_create', 'entry');

  const badInput: string[] = [];
  const blocked: string[] = [];
  const raised = await readRaisedByNode(tx, companyId, id);
  const vendors = await readVendors(
    tx,
    companyId,
    input.lines.flatMap((l) => (l.vendorId ? [l.vendorId] : [])),
  );
  const makeItems = input.lines
    .map((l) => nodes.get(l.nodeId)!)
    .filter((n) => raisesOf(n) === 'plan')
    .map((n) => n.itemId);
  const cards = await readRouteCards(tx, companyId, makeItems);

  const prepared: Prepared[] = [];
  for (const line of input.lines) {
    const node = nodes.get(line.nodeId)!;
    const kind = raisesOf(node);
    const item = label(node);
    const milli = qtyMilli(line.qty);
    if (milli === null) {
      badInput.push(`${item}: Qty can have at most 3 decimals.`);
      continue;
    }
    if (kind !== 'pr' && milli % 1000n !== 0n) {
      badInput.push(
        `${item}: a ${KIND_WORD[kind]} row raises a plan, which is for whole pieces — ${line.qty} is not a whole number.`,
      );
    }
    if (line.requiredDate && !DATE_RE.test(line.requiredDate)) {
      badInput.push(`${item}: Required Date must be a date (YYYY-MM-DD).`);
    }
    if (kind === 'outsource_plan') {
      if (!line.vendorId || !line.process?.trim()) {
        badInput.push(`${item}: an Outsource row needs a Vendor and a Process.`);
      } else if (!vendors.has(line.vendorId)) {
        badInput.push(`${item}: the Vendor was not found — pick it again.`);
      }
    }

    // The cap: never more than To Raise (Net Need − Raised), in thousandths.
    const left = toMilli(node.netNeedQty) - toMilli(raised.get(node.id) ?? '0');
    if (milli > left) {
      blocked.push(`${item}: only ${qtyWord(left > 0n ? left : 0n)} left to raise.`);
    }
    if (kind === 'plan') {
      const card = cards.get(node.itemId);
      if (!card) blocked.push(`${item} has no Route Card — make one first.`);
      else if (card.opCount === 0) {
        blocked.push(`${item}'s Route Card has no operations — add them first.`);
      } else if (card.planType === 'direct_purchase') {
        blocked.push(`${item}'s Route Card says Buy — it cannot be planned to manufacture.`);
      }
    }
    prepared.push({ line, node, kind });
  }
  // 4. Refuse ONCE, naming every problem — nothing has been written yet.
  if (badInput.length > 0) throw new ValidationError(badInput.join(' '));
  if (blocked.length > 0) throw new ConflictError(blocked.join(' '));

  // Build + check each document's input with its own shared rules
  // (createPlanInTx / insertPurchaseRequestTx do not re-run them).
  const today = sfTodayIst();
  const soCode = facts.soCode;
  for (const p of prepared) {
    const { line, node, kind } = p;
    const item = label(node);
    const itemText = {
      itemId: node.itemId,
      itemCodeText: node.itemCode ? node.itemCode.slice(0, 80) : null,
      itemNameText: node.itemName ? node.itemName.slice(0, 200) : null,
    };
    if (kind === 'pr') {
      const parsed = createPurchaseRequestInputSchema.safeParse({
        prDate: today,
        prType: 'standard',
        // Same placeholder as raisePlanningPr: Planning does not know the
        // vendor — Purchase picks one on the PO.
        vendorCodeText: 'TBD',
        itemId: node.itemId,
        ...(node.itemCode ? { itemCodeText: node.itemCode.slice(0, 64) } : {}),
        ...(node.itemName ? { itemName: node.itemName.slice(0, 255) } : {}),
        qty: line.qty,
        estCost: 0,
        ...(line.requiredDate ? { requiredDate: line.requiredDate } : {}),
        remarks: `${row.code} · ${node.itemCode ?? ''}`.trim(),
      });
      if (!parsed.success) throw zodRefusal(item, parsed.error.issues);
      p.pr = parsed.data;
      continue;
    }
    const common = {
      planDate: today,
      ...itemText,
      orderQty: line.qty,
      planQty: line.qty,
      soCodeText: soCode.slice(0, 40),
      lineNo: facts.lineNo,
      remarks: row.code,
    };
    const parsed = createPlanInputSchema.safeParse(
      kind === 'plan'
        ? {
            ...common,
            planType: 'manufacture',
            opsSource: 'route_card',
            // The top row's plan IS the SO line's own plan.
            soLineId: node.depth === 0 ? row.soLineId : null,
            ...(line.requiredDate ? { plannedEndDate: line.requiredDate } : {}),
            // RM from the row when the BOM line states it; otherwise left
            // unsent so the plan fills it from the Route Card (T1).
            ...(node.rawMaterialGradeText
              ? { rawMaterialGradeText: node.rawMaterialGradeText.slice(0, 120) }
              : {}),
            ...(node.rawMaterialSizeText
              ? { rawMaterialSizeText: node.rawMaterialSizeText.slice(0, 160) }
              : {}),
          }
        : {
            ...common,
            planType: 'full_outsource',
            // 'plan', not 'route_card' — otherwise the card's type wins.
            opsSource: 'plan',
            soLineId: null,
            foVendorId: line.vendorId,
            foVendorCodeText: vendors.get(line.vendorId!) ?? null,
            foProcess: line.process!.trim(),
            ...(line.requiredDate ? { foDeliveryDate: line.requiredDate } : {}),
          },
    );
    if (!parsed.success) throw zodRefusal(item, parsed.error.issues);
    p.plan = parsed.data;
  }

  // 5. Create — the plan / PR creators log their own documents.
  const made: string[] = [];
  for (const p of prepared) {
    const item = label(p.node);
    try {
      if (p.pr) {
        const pr = await insertPurchaseRequestTx(tx, p.pr, user, companyId, {
          mlPlanNodeId: p.node.id,
        });
        made.push(`${pr.code} (${item} × ${p.line.qty}, ${KIND_WORD[p.kind]})`);
      } else if (p.plan) {
        const plan = await createPlanInTx(tx, companyId, p.plan, user, {
          mlPlanNodeId: p.node.id,
        });
        made.push(`${plan.code} (${item} × ${p.line.qty}, ${KIND_WORD[p.kind]})`);
      }
    } catch (e) {
      throw prefixed(item, e);
    }
  }

  // 6. §20.2 — Draft → Released is conditional; updated_at is bumped either
  //    way so a second open screen's expectedUpdatedAt goes stale (409).
  const moved = (await tx.execute(sql`
    UPDATE public.ml_plans
    SET status = 'released', updated_at = now(), updated_by = ${user.id}::uuid
    WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
      AND status = 'draft'
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  if (moved.length === 0) {
    const bumped = (await tx.execute(sql`
      UPDATE public.ml_plans
      SET updated_at = now(), updated_by = ${user.id}::uuid
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
        AND status = 'released'
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    // We hold the row lock, so only 'released' can be here — anything else
    // is a bug, not a race; refuse rather than leave orders on a plan that
    // says otherwise.
    if (bumped.length === 0) {
      throw new ConflictError(`${row.code} changed while raising — reload.`);
    }
  }

  // 7. One History row on the plan, listing the documents raised.
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Edit,
      entity: ENTITY,
      entityId: id,
      refId: row.code,
      changes:
        moved.length > 0
          ? [{ field: 'status', label: 'Plan Status', before: 'Draft', after: 'Released' }]
          : null,
      detail: `Raised from ${row.code} (${soLabel(facts)} Line ${facts.lineNo}): ${made.join(', ')}`,
    },
    companyId,
    user,
  );
  return loadMlPlanDetail(tx, id, companyId);
}
