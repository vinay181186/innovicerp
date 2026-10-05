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
//   T2  route-cards/service.ts — createRouteCard AND updateRouteCard: a card
//       that now names raw material fills the blank raw material of that
//       item's waiting plans (backfillPlansFromRouteCard, below), inside the
//       card's own transaction so a failed backfill cannot leave a half-saved
//       card. The EDIT side matters as much as the create side: a card saved
//       blank and filled in a week later used to leave every waiting plan
//       blank for ever.
//
// A BOM-CHILD PLAN HAS A SECOND, MORE SPECIFIC SOURCE. Grade + size also live
// per BOM child on `bom_master_lines`, and a plan that reads only the card got
// blanks even when the BOM line stated both. Precedence for such a plan is
// BOM line → Route Card → blank (readBomLineRawMaterial, below), and it is
// resolved PER FIELD, not per row: the grade pair is decided on its own and
// the size pair on its own. A BOM line that states a size and no grade gives
// the plan its size and leaves the GRADE to the card — row-level precedence
// gave such a plan a size and a permanently blank grade, which the Production
// Order guard (it refuses only when grade AND size are both empty) then let
// through as a half-material Job Card. Grade and size each still move as an
// id + text PAIR, so a line's id is never paired with a card's text. The RM
// item + qty-per-piece pair comes from the card alone, because the BOM line
// has no such columns.
//
// NO LOOP. The Route Card CREATE FORM prefills its raw material from the
// item's latest plan (client-side, while the field is blank), and T2 pushes
// the saved card's material back to plans that are still missing it. Both are
// one-shot and fill-blanks-only, PER HALF: T2 skips any grade or size that
// already has text, so a value it wrote is never written again, and the form
// prefill is a UI default that triggers no server write of its own.

import { ActivityAction, type ActivityChange } from '@innovic/shared';
import { and, asc, desc, eq, isNull, or, type SQL, sql } from 'drizzle-orm';

import { bomMasterLines, bomMasters, items, plans, routeCards } from '../../db/schema';
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

/** The raw material one BOM child line carries, in the shape a Plan stores it.
 *  Grade and size ONLY: `bom_master_lines` has no RM item / qty-per-piece
 *  columns, so that pair still comes from the Route Card. */
export interface BomLineRawMaterial {
  rawMaterialGradeId: string | null;
  rawMaterialGradeText: string | null;
  rawMaterialSizeId: string | null;
  rawMaterialSizeText: string | null;
}

/**
 * The raw material on ONE BOM child line, or null when the BOM is not live,
 * the line is not there, or the line names no material at all.
 *
 * WHY THE BOM LINE IS CONSULTED. A plan only ever read the Route Card, which
 * is per ITEM — so a BOM-child plan got blank grade and size even when the BOM
 * line stated both, and Create Production Order then refused it. For a
 * BOM-child plan the BOM line WINS, PER FIELD, and the card fills whichever
 * half the line left blank (see the file header), because the line is the more
 * specific statement: the same child can sit in two BOMs and be cut from
 * different stock, which is why `bom_master_lines` carries its own grade /
 * size at all (its schema comment: "the BOM line is the only place that knows
 * what the child is made from").
 *
 * The child is named by CODE, not id, because that is what the plan stores
 * (`plans.bom_child_code`) — the same join `assertBomChildQtyWithinRequirement`
 * uses.
 *
 * THE BOM HEADER IS CHECKED FOR LIVENESS, not just the line. `softDeleteBomMaster`
 * deliberately does NOT stamp the lines (so Trash → Restore brings the BOM back
 * whole), so filtering `bom_master_lines.deleted_at` alone still reads a TRASHED
 * BOM's lines. A plan keeps its `bom_master_id` when the BOM is trashed, so a
 * dead BOM would have handed the plan its grade / size — and, worse, suppressed
 * the live Route Card, because the fallback keys off the line answering nothing.
 * Hence the inner join on `bom_masters` with `deleted_at IS NULL` and the same
 * company, matching the liveness check `readLiveBomPerSet` already does
 * (modules/assembly/fitting.ts).
 */
export async function readBomLineRawMaterial(
  tx: DbTransaction,
  companyId: string,
  bomMasterId: string,
  bomChildCode: string,
): Promise<BomLineRawMaterial | null> {
  const rows = await tx
    .select({
      rawMaterialGradeId: bomMasterLines.rawMaterialGradeId,
      rawMaterialGradeText: bomMasterLines.rawMaterialGradeText,
      rawMaterialSizeId: bomMasterLines.rawMaterialSizeId,
      rawMaterialSizeText: bomMasterLines.rawMaterialSizeText,
    })
    .from(bomMasterLines)
    // INNER JOIN: a child whose Item Master row is gone has no code to match,
    // so a dead master can never hand a plan its raw material.
    .innerJoin(items, eq(bomMasterLines.childItemId, items.id))
    // INNER JOIN on the HEADER too — the lines of a trashed BOM are not
    // stamped, so this is the only place the BOM's own liveness is checked.
    .innerJoin(bomMasters, eq(bomMasterLines.bomMasterId, bomMasters.id))
    .where(
      and(
        eq(bomMasterLines.bomMasterId, bomMasterId),
        eq(bomMasterLines.companyId, companyId),
        isNull(bomMasterLines.deletedAt),
        eq(bomMasters.companyId, companyId),
        isNull(bomMasters.deletedAt),
        eq(items.code, bomChildCode),
        eq(items.companyId, companyId),
        isNull(items.deletedAt),
      ),
    )
    // DETERMINISTIC ON PURPOSE — lowest line no first. `bom_master_lines_bom_item_uniq`
    // means one child cannot sit twice on one live BOM, but the ordering is not
    // left to the planner: a bare `.limit(1)` on a table that somehow had two
    // would hand out an arbitrary row (the fault fixed in readRouteCardRawMaterial).
    .orderBy(asc(bomMasterLines.lineNo))
    .limit(1);

  const line = rows[0];
  if (!line) return null;
  // A line saved with blank raw material has nothing to copy at all: answer
  // null so the caller falls straight through to the Route Card. A line that
  // filled only ONE of the two pairs is still returned — the caller asks
  // bomLineHasGrade / bomLineHasSize per field and takes the card for the
  // half the line left blank.
  if (!bomLineHasGrade(line) && !bomLineHasSize(line)) return null;
  return line;
}

/** Does this BOM line state a grade (master id, snapshot text, or both)? Asked
 *  on its own, because the size pair is decided separately. */
export function bomLineHasGrade(line: BomLineRawMaterial): boolean {
  return line.rawMaterialGradeId !== null || line.rawMaterialGradeText !== null;
}

/** Does this BOM line state a size? The grade pair is decided separately. */
export function bomLineHasSize(line: BomLineRawMaterial): boolean {
  return line.rawMaterialSizeId !== null || line.rawMaterialSizeText !== null;
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
 * WHICH PLANS T2 MAY FILL — ONE definition, used by the backfill's locked read,
 * by every UPDATE it issues, and by lockBackfillCandidates() below. A
 * copy-pasted second predicate is exactly how the two would drift apart.
 *
 * A plan is a candidate when EITHER HALF is still blank — grade text NULL **OR**
 * size text NULL. It used to require BOTH, which per-field precedence turned
 * into a permanent lock-out: a BOM line that states a size and no grade now
 * gives the plan its size at CREATE time, so the plan is born with one half
 * filled, and a card created or edited a week later with the grade could never
 * match it again. The grade stayed blank for ever and Create Production Order
 * (it refuses only when grade AND size are both empty) let the half-material
 * Job Card through — the very thing this work exists to prevent. Which HALVES
 * get written is decided per plan in the loop below; this predicate only says
 * "there is still something to fill here".
 *
 * `jc_id IS NULL` — never touch a plan whose Job Card already exists: the plan's
 * RM was copied onto the JC at execute and plan-vs-card must not drift.
 *
 * NOTE — the guard keys on the TEXT columns only, so a plan with a grade/size
 * ID but no text still counts as blank on that half. That is deliberate: the
 * write below always sets the id AND the text of a half together, so such a
 * plan gets a consistent pair instead of a new text beside a stale id.
 */
function backfillCandidateGuard(companyId: string, itemId: string): SQL | undefined {
  return and(
    eq(plans.companyId, companyId),
    eq(plans.itemId, itemId),
    isNull(plans.deletedAt),
    isNull(plans.jcId),
    or(isNull(plans.rawMaterialGradeText), isNull(plans.rawMaterialSizeText)),
  );
}

/**
 * LOCK ORDER — plans BEFORE route_cards (CLAUDE.md Section 20.3).
 *
 * Take the row locks T2 will need, and nothing else: no read, no write, no
 * decision. `updateRouteCard` calls this at the very top of its transaction so
 * its order becomes **plans → route_cards**, which is the order `executePlan`
 * (modules/plans/service.ts) already uses — it locks the plan row `FOR UPDATE`
 * and only later writes the item's `route_cards` row through
 * `saveRouteCardForItem`. Without this pre-lock the Route Card edit path ran
 * route_cards → plans, so one user saving the Route Card for item X and another
 * pressing Execute on a plan for item X could deadlock (Postgres 40P01) and the
 * loser got a raw database error.
 *
 * The predicate is `backfillCandidateGuard` itself — the SAME code the backfill
 * uses — so the pre-lock can never cover a different set than the backfill
 * locks. It keys on the PLAN's blank columns, its item and its Job Card, never
 * on the card's own values, so writing the `route_cards` row in between cannot
 * change the candidate set. The backfill's own `FOR UPDATE` later in the same
 * transaction re-locks rows this transaction already holds, which is free.
 */
export async function lockBackfillCandidates(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
): Promise<void> {
  await tx
    .select({ id: plans.id })
    .from(plans)
    .where(backfillCandidateGuard(companyId, itemId))
    .for('update');
}

/**
 * T2 — a saved Route Card (created OR edited) fills the blank raw material of
 * that item's waiting plans. Runs inside the caller's transaction
 * (createRouteCard / updateRouteCard's withUserContext), so card + backfill +
 * History commit or roll back together. The edit path pre-locks these same plan
 * rows at the top of its transaction — see lockBackfillCandidates above.
 *
 * WHICH PLANS — backfillCandidateGuard() above: same company, same item, not
 * deleted, no Job Card, and at least ONE of grade text / size text still blank.
 *
 * FILL-BLANKS-ONLY, PER HALF. The guard says a plan has something to fill; it
 * does NOT say which half, so each half is decided per plan: the grade pair is
 * written only when the plan's grade text is blank, the size pair only when its
 * size text is blank, and the RM item pair only when both its columns are
 * blank. A plan that already carries a size keeps it untouched and receives
 * only the grade. Each of those conditions is REPEATED on the UPDATE's WHERE
 * under the row lock, which is also the concurrency guard: a planner who typed
 * a grade in the same moment is never overwritten, and a zero-row UPDATE just
 * skips that plan.
 *
 * A CANDIDATE THAT CARRIES A BOM LINK OBEYS THE SAME PER-FIELD PRECEDENCE the
 * create / edit paths use — BOM line → Route Card → blank, grade and size
 * decided separately — so this trigger cannot write the card's grade over a
 * BOM-child plan whose BOM line names a different one. A plan with no BOM link
 * behaves exactly as before: every value comes from the card.
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
  const cardHasGradeOrSize = routeCardHasGradeOrSize(rc);
  const fillRmItem = routeCardHasRmItem(rc);
  // A card with no raw material of its own: nothing to copy, no write, no
  // History row. The plans keep their blanks, exactly as before. T2's TRIGGER
  // is still the CARD naming raw material; a BOM line never starts a backfill
  // of its own, it only decides where each field's value comes from once the
  // card has started one.
  if (!cardHasGradeOrSize && !fillRmItem) return [];

  // The ONE candidate predicate (see backfillCandidateGuard above), held as a
  // value so the SELECT, every UPDATE and lockBackfillCandidates() cannot drift
  // apart.
  const guard = backfillCandidateGuard(companyId, itemId);

  // Locked read first: which HALF of each plan is still blank, which plans
  // already carry an RM item pair (that pair is the planner's and is left
  // alone) and which carry a BOM link (their grade / size may belong to the BOM
  // line, not to this card). The UPDATEs below repeat the guard AND the
  // per-half blank checks, so the fill itself does not depend on this read.
  const candidates = await tx
    .select({
      id: plans.id,
      code: plans.code,
      bomMasterId: plans.bomMasterId,
      bomChildCode: plans.bomChildCode,
      rawMaterialGradeText: plans.rawMaterialGradeText,
      rawMaterialSizeText: plans.rawMaterialSizeText,
      rawMaterialItemId: plans.rawMaterialItemId,
      rmQtyPerPiece: plans.rmQtyPerPiece,
    })
    .from(plans)
    .where(guard)
    .for('update');
  if (candidates.length === 0) return [];

  const cardLabel = `Route Card ${rc.routeCardCode}`;

  // PER-CANDIDATE, because each plan can hang off a different BOM line and so
  // resolve to a different value — one bulk UPDATE cannot express that any
  // more. The guard narrows hard first (one item, blank RM, no Job Card), so
  // the set is small, and the lines are cached by BOM + child so two plans on
  // the same line cost one query.
  const lineCache = new Map<string, BomLineRawMaterial | null>();
  const readLine = async (
    bomMasterId: string,
    bomChildCode: string,
  ): Promise<BomLineRawMaterial | null> => {
    const key = `${bomMasterId}|${bomChildCode}`;
    const hit = lineCache.get(key);
    if (hit !== undefined) return hit;
    const line = await readBomLineRawMaterial(tx, companyId, bomMasterId, bomChildCode);
    lineCache.set(key, line);
    return line;
  };

  const filled: Array<{
    id: string;
    code: string;
    gradeText: string | null;
    sizeText: string | null;
    rmItemFilled: boolean;
    /** Every document that actually supplied a value, for the History row. */
    sources: string[];
  }> = [];

  for (const p of candidates) {
    // WHICH HALVES THIS PLAN IS MISSING. The guard only promised that one of
    // the two is blank; a plan born with a size from its BOM line and no grade
    // must receive ONLY the grade and keep its size exactly as it is.
    const gradeBlank = p.rawMaterialGradeText === null;
    const sizeBlank = p.rawMaterialSizeText === null;

    const line =
      p.bomMasterId !== null && p.bomChildCode !== null
        ? await readLine(p.bomMasterId, p.bomChildCode)
        : null;
    const lineLabel = p.bomChildCode === null ? '' : `BOM line ${p.bomChildCode}`;
    // PER FIELD, same precedence as createPlanInTx / updatePlanTx: the BOM
    // line wins the grade pair only if it HAS a grade, and the size pair only
    // if it HAS a size. Whichever half it left blank falls to the card.
    const gradeFromLine = line !== null && bomLineHasGrade(line);
    const sizeFromLine = line !== null && bomLineHasSize(line);
    const gradeRm: BomLineRawMaterial = line !== null && gradeFromLine ? line : rc;
    const sizeRm: BomLineRawMaterial = line !== null && sizeFromLine ? line : rc;

    const hasGrade = gradeRm.rawMaterialGradeId !== null || gradeRm.rawMaterialGradeText !== null;
    const hasSize = sizeRm.rawMaterialSizeId !== null || sizeRm.rawMaterialSizeText !== null;
    const blankPair = p.rawMaterialItemId === null && p.rmQtyPerPiece === null;
    // FILL-BLANKS-ONLY, per half: a half that already has a value is never
    // written, not even with the same value — this is what makes an existing
    // size untouchable while the grade is filled.
    const writeGrade = gradeBlank && hasGrade;
    const writeSize = sizeBlank && hasSize;
    const writeRmItem = fillRmItem && blankPair;
    // Nothing either document can give this plan's remaining blanks: no write,
    // no History row.
    if (!writeGrade && !writeSize && !writeRmItem) continue;

    // The id AND the text go together, for grade and for size: text without
    // the id leaves a plan that displays a grade but is not linked to the
    // master. Where the winning source has text but no id (its master row was
    // deleted), the text is copied and the id stays null — that is what the
    // snapshot columns are for. A field is only ever written from ONE
    // document, so a line's id can never be paired with a card's text. A half
    // the plan already has is absent from `values` entirely, so the UPDATE
    // below does not even name its columns.
    const values: {
      rawMaterialGradeId?: string | null;
      rawMaterialGradeText?: string | null;
      rawMaterialSizeId?: string | null;
      rawMaterialSizeText?: string | null;
      rawMaterialItemId?: string | null;
      rmQtyPerPiece?: number | null;
    } = {};
    if (writeGrade) {
      values.rawMaterialGradeId = gradeRm.rawMaterialGradeId;
      values.rawMaterialGradeText = gradeRm.rawMaterialGradeText;
    }
    if (writeSize) {
      values.rawMaterialSizeId = sizeRm.rawMaterialSizeId;
      values.rawMaterialSizeText = sizeRm.rawMaterialSizeText;
    }
    if (writeRmItem) {
      values.rawMaterialItemId = rc.rawMaterialItemId;
      values.rmQtyPerPiece = rc.rmQtyPerPiece;
    }

    const rows = await tx
      .update(plans)
      .set({
        ...values,
        updatedBy: user.id,
        // Set explicitly as updatePlan does: a filled plan MUST show that it
        // moved — the bug's own symptom was the plan's updated_at never
        // moving. (0187's trigger does it too; this does not depend on it.)
        updatedAt: new Date(),
      })
      .where(
        and(
          // The whole guard again, under the row lock — PLUS the blank check
          // for each half this UPDATE actually writes. The guard alone is now
          // an OR ("one of the two is blank"), so it is the per-half isNull
          // terms that make this FILL-BLANKS-ONLY: a planner who typed a grade
          // in between is never overwritten, and the UPDATE simply returns
          // zero rows and this plan is skipped.
          guard,
          eq(plans.id, p.id),
          ...(writeGrade ? [isNull(plans.rawMaterialGradeText)] : []),
          ...(writeSize ? [isNull(plans.rawMaterialSizeText)] : []),
          ...(writeRmItem ? [isNull(plans.rawMaterialItemId), isNull(plans.rmQtyPerPiece)] : []),
        ),
      )
      .returning({ id: plans.id, code: plans.code });
    const row = rows[0];
    if (!row) continue;

    // ADR-197 — only the halves ACTUALLY written are named, and each one names
    // the document it actually came from. A plan that kept its own size and
    // received only the grade must not claim the size was filled, nor name a
    // source that supplied nothing.
    const sources: string[] = [];
    const noteSource = (label: string): void => {
      if (label !== '' && !sources.includes(label)) sources.push(label);
    };
    if (writeGrade) noteSource(gradeFromLine ? lineLabel : cardLabel);
    if (writeSize) noteSource(sizeFromLine ? lineLabel : cardLabel);
    // The RM item pair is Route-Card-only: `bom_master_lines` has no such
    // columns.
    if (writeRmItem) noteSource(cardLabel);

    filled.push({
      id: row.id,
      code: row.code,
      gradeText: writeGrade ? gradeRm.rawMaterialGradeText : null,
      sizeText: writeSize ? sizeRm.rawMaterialSizeText : null,
      rmItemFilled: writeRmItem,
      sources,
    });
  }

  // ADR-197 — one History row per plan, naming the source each value ACTUALLY
  // came from (the BOM line, the Route Card, or both in one save), so a value
  // nobody typed is explainable later. Labels match the plan edit diff
  // (planEditFields) so the History tab reads the same either way.
  for (const p of filled) {
    const changes: ActivityChange[] = [];
    if (p.gradeText !== null) {
      changes.push({
        field: 'rawMaterialGradeText',
        label: 'RM Grade',
        before: null,
        after: p.gradeText,
      });
    }
    if (p.sizeText !== null) {
      changes.push({
        field: 'rawMaterialSizeText',
        label: 'RM Size',
        before: null,
        after: p.sizeText,
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
        detail: `${p.code} — raw material filled from ${p.sources.join(' and ')}`,
      },
      companyId,
      user,
    );
  }

  return filled.map((p) => p.code);
}
