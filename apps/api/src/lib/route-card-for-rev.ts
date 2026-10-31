import { sql, type SQL } from 'drizzle-orm';
import { itemRevLabel, type PlanType, type RouteCardApprovalStatus } from '@innovic/shared';
import type { DbTransaction } from '../db/with-user-context';
import { ValidationError } from './errors';

// One Route Card per Item + Drawing Rev (owner 2026-10-31, migration 0232:
// route_cards_company_itemrev_uniq + route_cards_company_item_norev_uniq).
// An item can now have several live cards — one per Rev, plus at most one old
// card with no Rev — so "the item's card" is no longer one row. Every reader
// that used to join route_cards ON item_id picks ONE card through this file.
//
// Two rules, on purpose:
//   STRICT  (may this card drive work?)  — the card for exactly this Item+Rev;
//           a document with no Rev uses the item's no-Rev card. Used by PRO
//           create, the plan's "Gen production order" status, plan type, RM.
//   DISPLAY (which card do we show?)     — the Item+Rev card, else the item's
//           no-Rev card (an old card nobody has given a Rev yet). Never two rows.

function alias(a: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(a)) throw new Error(`route-card-for-rev: bad alias "${a}"`);
  return a;
}

/** STRICT predicate on a route_cards alias already in the query: the live card
 *  of this item for exactly this Rev (NULL Rev → the item's no-Rev card). The
 *  two partial unique indexes make it at most one row. */
export function routeCardForItemRevSql(rcAlias: string, itemId: SQL, itemRevisionId: SQL): SQL {
  const rc = sql.raw(alias(rcAlias));
  return sql`(${rc}.item_id = ${itemId} AND ${rc}.item_revision_id IS NOT DISTINCT FROM ${itemRevisionId} AND ${rc}.deleted_at IS NULL)`;
}

/** DISPLAY: the id of the card to show for this Item+Rev — the Rev's own card,
 *  else the item's no-Rev card. Scalar subquery, always 0 or 1 row. */
export function displayRouteCardIdSql(itemId: SQL, itemRevisionId: SQL): SQL {
  return sql`(SELECT drc.id FROM public.route_cards drc
     WHERE drc.item_id = ${itemId} AND drc.deleted_at IS NULL
       AND (drc.item_revision_id = ${itemRevisionId} OR drc.item_revision_id IS NULL)
     ORDER BY (drc.item_revision_id IS NULL) ASC
     LIMIT 1)`;
}

export interface RouteCardForRev {
  id: string;
  code: string;
  approvalStatus: RouteCardApprovalStatus;
  planType: PlanType;
  itemRevisionId: string | null;
}

/** STRICT single-card lookup (TS side of routeCardForItemRevSql). Null when the
 *  item has no live card for this Rev. */
export async function readRouteCardForItemRev(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
  itemRevisionId: string | null,
): Promise<RouteCardForRev | null> {
  const rows = (await tx.execute(sql`
    SELECT rc.id, rc.code, rc.approval_status AS "approvalStatus", rc.plan_type AS "planType",
           rc.item_revision_id AS "itemRevisionId"
    FROM public.route_cards rc
    WHERE rc.company_id = ${companyId}::uuid
      AND ${routeCardForItemRevSql('rc', sql`${itemId}::uuid`, itemRevisionId ? sql`${itemRevisionId}::uuid` : sql`NULL::uuid`)}
    LIMIT 1
  `)) as unknown as RouteCardForRev[];
  return rows[0] ?? null;
}

/**
 * PRO create (owner 2026-10-31): the picked Route Card must be the card for the
 * PLAN's Item + Rev. Call it INSIDE the plan's row lock, after reading the card
 * (§20.3) — then a card edit cannot slip between the check and the insert.
 *   • plan has a Rev, no card for it, only an old no-Rev card → "IN-RC-x has no
 *     Drawing Rev — set it on the Route Card first" (old cards are set by hand);
 *   • plan has a Rev and no card at all for it → "No Route Card for ABC/1";
 *   • plan has a Rev, a different card was picked → name the right one;
 *   • plan has no Rev (old plan / Buy) → only the item's no-Rev card fits.
 */
export async function assertRouteCardMatchesPlanRev(
  tx: DbTransaction,
  companyId: string,
  args: {
    itemId: string;
    itemLabel: string;
    planItemRevisionId: string | null;
    card: { code: string; itemRevisionId: string | null };
  },
): Promise<void> {
  const want = args.planItemRevisionId;
  const have = args.card.itemRevisionId ?? null;
  if (want === have) return;
  if (!want) {
    throw new ValidationError(
      `Route Card ${args.card.code} is for a Drawing Rev, but this plan has none — pick the item's Route Card with no Drawing Rev.`,
    );
  }
  const revRows = (await tx.execute(sql`
    SELECT ir.rev FROM public.item_revisions ir
    WHERE ir.id = ${want}::uuid AND ir.company_id = ${companyId}::uuid
  `)) as unknown as Array<{ rev: string }>;
  const label = itemRevLabel(args.itemLabel, revRows[0]?.rev ?? null);
  const right = await readRouteCardForItemRev(tx, companyId, args.itemId, want);
  if (right) {
    throw new ValidationError(
      `Route Card ${args.card.code} is not for ${label} — pick ${right.code}.`,
    );
  }
  const legacy = await readRouteCardForItemRev(tx, companyId, args.itemId, null);
  if (legacy) {
    throw new ValidationError(
      `${legacy.code} has no Drawing Rev — set it on the Route Card first.`,
    );
  }
  throw new ValidationError(`No Route Card for ${label} — create it first.`);
}
