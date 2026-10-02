// Raw material shared between an item's Route Card and the Plans for that
// same item — one lookup, two triggers.
//
// WHY THIS EXISTS. `route_card_pending` is a DESIGNED plan state: the plan may
// be made FIRST and the item's Route Card AFTER (the Plans list even carries a
// "+ Create Route Card" button for it). Nothing used to carry the card's raw
// material back to the waiting plan, so the plan kept the blanks it was born
// with for ever. Planning LOOKED right — the "+ Plan" box prefills live from
// the card — while Create Production Order, which reads the PLAN's stored
// snapshot, stayed blank. Live proof: PLN-0001 (grade/size null) vs
// IN-RC-00001 (EN24 / DIA 32) created 21 minutes later; the plan's updated_at
// never moved.
//
// The two triggers that close it, both reading the card through
// readRouteCardRawMaterial() below so there is only ONE "find this item's
// route card" query:
//
//   T1  plans/service.ts — createPlan / updatePlan: a plan saved with BLANK
//       raw material fills from the item's Route Card. Extends the ADR-193
//       phase 3a default, which filled the RM item + qty per piece only and
//       left grade / size behind.
//   T2  route-cards/service.ts — createRouteCard: a new card fills the blank
//       raw material of that item's waiting plans
//       (backfillPlansFromRouteCard, below), inside the card's own
//       transaction so a failed backfill cannot leave a half-created card.
//
// NO LOOP. The Route Card CREATE FORM prefills its raw material from the
// item's latest plan (client-side, while the field is blank), and T2 pushes
// the saved card's material back to blank plans. Both are one-shot and
// fill-blanks-only: T2 skips any plan that already has grade or size text, so
// the value it wrote can never be re-pushed anywhere, and the form prefill is
// a UI default that triggers no server write of its own.

import { ActivityAction, type ActivityChange } from '@innovic/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { plans, routeCards } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { emitActivityLog } from '../activity-log/service';

/** The raw material one Route Card carries, in the shape a Plan stores it. */
export interface RouteCardRawMaterial {
  routeCardId: string;
  routeCardCode: string;
  rawMaterialGradeId: string | null;
  rawMaterialGradeText: string | null;
  rawMaterialSizeId: string | null;
  rawMaterialSizeText: string | null;
  /** The RM item pair, or null/null when the card names no RM item OR its
   *  Item Master row has been deleted (then `rawMaterialItemCode` is null
   *  too). The ADR-193 default this replaces inner-joined `items` for exactly
   *  that reason: a dead master must not become a plan's stored RM item. */
  rawMaterialItemId: string | null;
  rmQtyPerPiece: number | null;
  /** The RM item's code, for the History row's "RM Item" line. */
  rawMaterialItemCode: string | null;
}

/**
 * The raw material on this item's Route Card, or null when the item has no
 * card yet (the `route_card_pending` case) — the ONE lookup both triggers use.
 */
export async function readRouteCardRawMaterial(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
): Promise<RouteCardRawMaterial | null> {
  const rows = await tx
    .select({
      id: routeCards.id,
      code: routeCards.code,
      rawMaterialGradeId: routeCards.rawMaterialGradeId,
      rawMaterialGradeText: routeCards.rawMaterialGradeText,
      rawMaterialSizeId: routeCards.rawMaterialSizeId,
      rawMaterialSizeText: routeCards.rawMaterialSizeText,
      rawMaterialItemId: routeCards.rawMaterialItemId,
      rmQtyPerPiece: routeCards.rmQtyPerPiece,
      // Null when the RM item master row is gone / soft-deleted — doubles as
      // the liveness check the ADR-193 default did with an inner join.
      rawMaterialItemCode: sql<string | null>`(
        SELECT rmi.code FROM public.items rmi
        WHERE rmi.id = ${routeCards.rawMaterialItemId}
          AND rmi.company_id = ${routeCards.companyId}
          AND rmi.deleted_at IS NULL
      )`,
    })
    .from(routeCards)
    .where(
      and(
        eq(routeCards.companyId, companyId),
        eq(routeCards.itemId, itemId),
        isNull(routeCards.deletedAt),
      ),
    )
    // DETERMINISTIC ON PURPOSE — newest card first. "One active card per item"
    // is a partial unique index, so there is normally exactly one row, but the
    // ADR-193 default this replaces ended in a bare `.limit(1)` with NO
    // ordering: an item that somehow had two live cards got an arbitrary one.
    // Newest-first is what the Route Card prefill shows, so the plan's stored
    // snapshot and the form a planner looks at agree.
    .orderBy(desc(routeCards.createdAt))
    .limit(1);

  const rc = rows[0];
  if (!rc) return null;
  const rmItemLive = rc.rawMaterialItemCode !== null;
  return {
    routeCardId: rc.id,
    routeCardCode: rc.code,
    rawMaterialGradeId: rc.rawMaterialGradeId,
    rawMaterialGradeText: rc.rawMaterialGradeText,
    rawMaterialSizeId: rc.rawMaterialSizeId,
    rawMaterialSizeText: rc.rawMaterialSizeText,
    rawMaterialItemId: rmItemLive ? rc.rawMaterialItemId : null,
    rmQtyPerPiece: rmItemLive ? rc.rmQtyPerPiece : null,
    rawMaterialItemCode: rc.rawMaterialItemCode,
  };
}

/** Does the card name a grade or a size at all? A card saved with blank raw
 *  material has nothing to copy down, and T2 then does nothing. */
export function routeCardHasGradeOrSize(rc: RouteCardRawMaterial): boolean {
  return (
    rc.rawMaterialGradeId !== null ||
    rc.rawMaterialGradeText !== null ||
    rc.rawMaterialSizeId !== null ||
    rc.rawMaterialSizeText !== null
  );
}

/** Does the card carry a usable RM item + qty-per-piece pair? */
export function routeCardHasRmItem(rc: RouteCardRawMaterial): boolean {
  return rc.rawMaterialItemId !== null && rc.rmQtyPerPiece !== null;
}

/**
 * T2 — a new Route Card fills the blank raw material of that item's waiting
 * plans. Runs inside the caller's transaction (createRouteCard's
 * withUserContext), so card + backfill + History commit or roll back together.
 *
 * Guards, all three required (see the WHERE below):
 *   - grade text AND size text both NULL — fill BLANKS only. This is also the
 *     concurrency guard: a planner typing a grade at the same moment is never
 *     overwritten, because the UPDATE re-checks it under the row lock.
 *   - jc_id IS NULL — never touch a plan whose Job Card already exists. The
 *     card copied the blank down (plans/service.ts copies the plan's RM onto
 *     the JC at execute) and plan-vs-card must not drift.
 *   - same company, same item, not deleted.
 *
 * Returns the codes of the plans it filled (for the caller's report / tests).
 */
export async function backfillPlansFromRouteCard(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
  rc: RouteCardRawMaterial,
  user: AuthContext,
): Promise<string[]> {
  const fillGradeSize = routeCardHasGradeOrSize(rc);
  const fillRmItem = routeCardHasRmItem(rc);
  // A card with no raw material of its own: nothing to copy, no write, no
  // History row. The plans keep their blanks, exactly as before.
  if (!fillGradeSize && !fillRmItem) return [];

  // The guard, as a value so the SELECT and both UPDATEs cannot drift apart.
  const guard = and(
    eq(plans.companyId, companyId),
    eq(plans.itemId, itemId),
    isNull(plans.deletedAt),
    isNull(plans.rawMaterialGradeText),
    isNull(plans.rawMaterialSizeText),
    isNull(plans.jcId),
  );

  // Locked read first, only to know which plans already have an RM item pair
  // (their pair is the planner's and is left alone). The UPDATEs below repeat
  // the whole guard, so the fill itself does not depend on this read.
  const candidates = await tx
    .select({
      id: plans.id,
      code: plans.code,
      rawMaterialItemId: plans.rawMaterialItemId,
      rmQtyPerPiece: plans.rmQtyPerPiece,
    })
    .from(plans)
    .where(guard)
    .for('update');
  if (candidates.length === 0) return [];

  const gradeSizeValues = {
    rawMaterialGradeId: rc.rawMaterialGradeId,
    rawMaterialGradeText: rc.rawMaterialGradeText,
    rawMaterialSizeId: rc.rawMaterialSizeId,
    rawMaterialSizeText: rc.rawMaterialSizeText,
  };
  // The id AND the text go together, for grade and for size: text without the
  // id leaves a plan that displays a grade but is not linked to the master.
  // Where the card has text but no id (its master row was deleted), the text
  // is copied and the id stays null — that is what the snapshot columns are
  // for.

  const blankPair = candidates.filter(
    (p) => p.rawMaterialItemId === null && p.rmQtyPerPiece === null,
  );
  const keptPair = candidates.filter(
    (p) => !(p.rawMaterialItemId === null && p.rmQtyPerPiece === null),
  );

  const filled: Array<{ id: string; code: string; rmItemFilled: boolean }> = [];

  if (fillRmItem && blankPair.length > 0) {
    const rows = await tx
      .update(plans)
      .set({
        ...gradeSizeValues,
        rawMaterialItemId: rc.rawMaterialItemId,
        rmQtyPerPiece: rc.rmQtyPerPiece,
        updatedBy: user.id,
        // Set explicitly as updatePlan does: a filled plan MUST show that it
        // moved — the bug's own symptom was the plan's updated_at never
        // moving. (0187's trigger does it too; this does not depend on it.)
        updatedAt: new Date(),
      })
      .where(
        and(
          guard,
          inArray(
            plans.id,
            blankPair.map((p) => p.id),
          ),
          isNull(plans.rawMaterialItemId),
          isNull(plans.rmQtyPerPiece),
        ),
      )
      .returning({ id: plans.id, code: plans.code });
    for (const r of rows) filled.push({ ...r, rmItemFilled: true });
  }

  // Plans that already carry an RM item pair (or a card with no pair to give):
  // grade + size only.
  const gradeSizeOnlyIds = [
    ...keptPair.map((p) => p.id),
    ...(fillRmItem ? [] : blankPair.map((p) => p.id)),
  ];
  if (fillGradeSize && gradeSizeOnlyIds.length > 0) {
    const rows = await tx
      .update(plans)
      .set({ ...gradeSizeValues, updatedBy: user.id, updatedAt: new Date() })
      .where(and(guard, inArray(plans.id, gradeSizeOnlyIds)))
      .returning({ id: plans.id, code: plans.code });
    for (const r of rows) filled.push({ ...r, rmItemFilled: false });
  }

  // ADR-197 — one History row per plan, naming the Route Card as the source,
  // so a value nobody typed is explainable later. Labels match the plan edit
  // diff (planEditFields) so the History tab reads the same either way.
  for (const p of filled) {
    const changes: ActivityChange[] = [];
    if (rc.rawMaterialGradeText !== null) {
      changes.push({
        field: 'rawMaterialGradeText',
        label: 'RM Grade',
        before: null,
        after: rc.rawMaterialGradeText,
      });
    }
    if (rc.rawMaterialSizeText !== null) {
      changes.push({
        field: 'rawMaterialSizeText',
        label: 'RM Size',
        before: null,
        after: rc.rawMaterialSizeText,
      });
    }
    if (p.rmItemFilled) {
      changes.push({
        field: 'rawMaterialItemId',
        label: 'RM Item',
        before: null,
        after: rc.rawMaterialItemCode ?? rc.rawMaterialItemId,
      });
      changes.push({
        field: 'rmQtyPerPiece',
        label: 'RM Qty per piece',
        before: null,
        after: rc.rmQtyPerPiece,
      });
    }
    if (changes.length === 0) continue;
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Edit,
        entity: 'Plan',
        entityId: p.id,
        refId: p.code,
        changes,
        detail: `${p.code} — raw material filled from Route Card ${rc.routeCardCode}`,
      },
      companyId,
      user,
    );
  }

  return filled.map((p) => p.code);
}
