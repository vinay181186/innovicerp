// Multi-Level BOM (ADR-225) — the tree guards every write runs.
//
//   lockMlBomTree           one transaction-scoped advisory lock per company,
//                           taken FIRST by every write that can change a link,
//                           so two saves cannot each build half of a loop
//   resolveDefaultBoms      child item → its live Default Multi-Level BOM
//   relinkLinesToDefault    point other BOMs' manufacture lines of an item at
//                           that item's (new) Default, logged on each parent
//   reresolveOwnLinks       a restored BOM's own lines → current Defaults
//   assertTreeSound         no loop below the BOM, and neither this BOM nor any
//                           BOM above it deeper than ML_BOM_MAX_LEVELS
//
// Links are resolved here, on the server, never taken from the client.

import { type SQL, sql } from 'drizzle-orm';
import { ActivityAction, ML_BOM_MAX_LEVELS } from '@innovic/shared';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { loadItemsByIds } from './helpers';

/** Serialise every link-changing Multi-Level BOM write of one company. */
export async function lockMlBomTree(tx: DbTransaction, companyId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ml_bom_tree:${companyId}`}))`);
}

/** item id → id of that item's live Default Multi-Level BOM (absent = none). */
export async function resolveDefaultBoms(
  tx: DbTransaction,
  companyId: string,
  itemIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(itemIds));
  if (unique.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT b.id, b.item_id
    FROM public.ml_boms b
    WHERE b.company_id = ${companyId}::uuid
      AND b.is_default
      AND b.deleted_at IS NULL
      AND b.item_id IN (${sql.join(
        unique.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
  `)) as unknown as Array<{ id: string; item_id: string }>;
  for (const r of rows) out.set(r.item_id, r.id);
  return out;
}

interface LinkMove {
  ml_bom_id: string;
  parent_code: string;
  item_code: string | null;
  old_code: string | null;
  new_code: string | null;
}

/** Wraps a link-moving UPDATE (CTE `upd` RETURNING ml_bom_id, child_item_id,
 *  old_id, new_id) so it hands back the codes the History rows name. */
function withMoveCodes(update: SQL): SQL {
  return sql`
    WITH upd AS (${update})
    SELECT upd.ml_bom_id, p.code AS parent_code, i.code AS item_code,
           ob.code AS old_code, nb.code AS new_code
    FROM upd
    JOIN public.ml_boms p ON p.id = upd.ml_bom_id
    LEFT JOIN public.items i ON i.id = upd.child_item_id
    LEFT JOIN public.ml_boms ob ON ob.id = upd.old_id
    LEFT JOIN public.ml_boms nb ON nb.id = upd.new_id`;
}

/**
 * One History row per moved link, on the PARENT BOM whose line moved
 * ("Sub-assembly HSG-10: IN-MLB-00002 → IN-MLB-00007"). Deliberately NO
 * revision bump and no revision snapshot: nobody edited that BOM — the
 * server re-pointed its link because the child item's Default changed.
 */
async function logLinkMoves(
  tx: DbTransaction,
  companyId: string,
  user: AuthContext,
  moves: readonly LinkMove[],
): Promise<void> {
  for (const m of moves) {
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Edit,
        entity: 'MlBom',
        entityId: m.ml_bom_id,
        refId: m.parent_code,
        detail:
          `Sub-assembly ${m.item_code ?? ''}: ${m.old_code ?? '(none)'} → ` +
          `${m.new_code ?? '(none)'}`,
      },
      companyId,
      user,
    );
  }
}

/**
 * Point every live manufacture line (of a live BOM other than this one) whose
 * child is `itemId` at `bomId`, the item's Default. Covers both a brand-new
 * Default (lines with no link yet) and Make Default (lines still on the old
 * Default). Buy / Outsource lines are left alone (ADR-225 decision 9). Logs
 * the move on each parent (logLinkMoves). Returns the distinct parent BOM ids
 * whose lines moved — the caller must run assertTreeSound on each.
 */
export async function relinkLinesToDefault(
  tx: DbTransaction,
  companyId: string,
  bomId: string,
  itemId: string,
  user: AuthContext,
): Promise<string[]> {
  const moves = (await tx.execute(
    withMoveCodes(sql`
      UPDATE public.ml_bom_lines l
      SET child_ml_bom_id = ${bomId}::uuid, updated_by = ${user.id}::uuid
      FROM (
        SELECT l2.id, l2.child_ml_bom_id AS old_id
        FROM public.ml_bom_lines l2
        JOIN public.ml_boms p ON p.id = l2.ml_bom_id
        WHERE p.company_id = ${companyId}::uuid
          AND p.deleted_at IS NULL
          AND l2.company_id = ${companyId}::uuid
          AND l2.deleted_at IS NULL
          AND l2.child_item_id = ${itemId}::uuid
          AND l2.bom_type = 'manufacture'
          AND l2.ml_bom_id <> ${bomId}::uuid
          AND l2.child_ml_bom_id IS DISTINCT FROM ${bomId}::uuid
      ) o
      WHERE l.id = o.id
      RETURNING l.ml_bom_id, l.child_item_id, o.old_id, l.child_ml_bom_id AS new_id`),
  )) as unknown as LinkMove[];
  await logLinkMoves(tx, companyId, user, moves);
  return Array.from(new Set(moves.map((m) => m.ml_bom_id)));
}

/**
 * Re-resolve THIS BOM's own live lines to each child item's current live
 * Default (manufacture lines only; Buy / Outsource → no link) — the save rule,
 * for a BOM coming back from Trash whose links may be stale. Logs each moved
 * link on this BOM. The caller then runs assertTreeSound.
 */
export async function reresolveOwnLinks(
  tx: DbTransaction,
  companyId: string,
  bomId: string,
  user: AuthContext,
): Promise<void> {
  const moves = (await tx.execute(
    withMoveCodes(sql`
      UPDATE public.ml_bom_lines l
      SET child_ml_bom_id = r.new_id, updated_by = ${user.id}::uuid
      FROM (
        SELECT l2.id, l2.child_ml_bom_id AS old_id,
               CASE WHEN l2.bom_type = 'manufacture' THEN d.id END AS new_id
        FROM public.ml_bom_lines l2
        LEFT JOIN public.ml_boms d
          ON d.company_id = ${companyId}::uuid
         AND d.item_id = l2.child_item_id
         AND d.is_default
         AND d.deleted_at IS NULL
        WHERE l2.ml_bom_id = ${bomId}::uuid
          AND l2.company_id = ${companyId}::uuid
          AND l2.deleted_at IS NULL
      ) r
      WHERE l.id = r.id
        AND l.child_ml_bom_id IS DISTINCT FROM r.new_id
      RETURNING l.ml_bom_id, l.child_item_id, r.old_id, r.new_id`),
  )) as unknown as LinkMove[];
  await logLinkMoves(tx, companyId, user, moves);
}

async function bomCode(tx: DbTransaction, id: string): Promise<string> {
  const rows = (await tx.execute(
    sql`SELECT code FROM public.ml_boms WHERE id = ${id}::uuid`,
  )) as unknown as Array<{ code: string }>;
  return rows[0]?.code ?? 'this BOM';
}

/**
 * Refuse (409) a save that leaves a loop under `bomId`, or makes the tree of
 * `bomId` — or of any BOM that uses it, however far up — deeper than
 * ML_BOM_MAX_LEVELS. Call it AFTER the lines and links are written, inside the
 * same transaction and under lockMlBomTree.
 */
export async function assertTreeSound(
  tx: DbTransaction,
  companyId: string,
  bomId: string,
): Promise<void> {
  // ── Down: walk the links, carrying the item path; stop on a repeat ──────
  const down = (await tx.execute(sql`
    WITH RECURSIVE d AS (
      SELECT l.child_ml_bom_id AS next_id,
             1 AS depth,
             ARRAY[b.item_id, l.child_item_id]::uuid[] AS item_path,
             (l.child_item_id = b.item_id) AS is_loop
      FROM public.ml_boms b
      JOIN public.ml_bom_lines l ON l.ml_bom_id = b.id AND l.deleted_at IS NULL
      WHERE b.id = ${bomId}::uuid AND b.company_id = ${companyId}::uuid
      UNION ALL
      SELECT l.child_ml_bom_id,
             d.depth + 1,
             d.item_path || l.child_item_id,
             (l.child_item_id = ANY(d.item_path))
      FROM d
      JOIN public.ml_boms cb ON cb.id = d.next_id AND cb.deleted_at IS NULL
      JOIN public.ml_bom_lines l ON l.ml_bom_id = cb.id AND l.deleted_at IS NULL
      WHERE NOT d.is_loop AND d.depth <= ${ML_BOM_MAX_LEVELS}
    )
    SELECT
      (SELECT array_to_string(item_path, ',') FROM d WHERE is_loop LIMIT 1) AS loop_path,
      (SELECT COALESCE(MAX(depth), 0) FROM d)::int AS depth
  `)) as unknown as Array<{ loop_path: string | null; depth: number }>;
  const loopPath = down[0]?.loop_path ?? null;
  const depth = Number(down[0]?.depth ?? 0);

  if (loopPath) {
    const ids = loopPath.split(',');
    const codes = await loadItemsByIds(tx, ids, companyId);
    const chain = ids.map((id) => codes.get(id)?.code ?? id.slice(0, 8)).join(' → ');
    throw new ConflictError(
      `Loop: ${chain}. A part cannot be inside its own sub-assembly — change the line ` +
        `type to Buy / Outsource, or remove the line.`,
    );
  }
  if (depth > ML_BOM_MAX_LEVELS) {
    throw new ConflictError(
      `${await bomCode(tx, bomId)} would be more than ${ML_BOM_MAX_LEVELS} levels deep. ` +
        `A Multi-Level BOM can nest at most ${ML_BOM_MAX_LEVELS} levels.`,
    );
  }

  // ── Up: every BOM that uses this one, with its longest distance ─────────
  const up = (await tx.execute(sql`
    WITH RECURSIVE u AS (
      SELECT l.ml_bom_id AS bom_id, 1 AS dist, ARRAY[${bomId}::uuid, l.ml_bom_id]::uuid[] AS path
      FROM public.ml_bom_lines l
      JOIN public.ml_boms p ON p.id = l.ml_bom_id AND p.deleted_at IS NULL
      WHERE l.child_ml_bom_id = ${bomId}::uuid
        AND l.company_id = ${companyId}::uuid
        AND l.deleted_at IS NULL
      UNION ALL
      SELECT l.ml_bom_id, u.dist + 1, u.path || l.ml_bom_id
      FROM u
      JOIN public.ml_bom_lines l ON l.child_ml_bom_id = u.bom_id AND l.deleted_at IS NULL
      JOIN public.ml_boms p ON p.id = l.ml_bom_id AND p.deleted_at IS NULL
      WHERE u.dist <= ${ML_BOM_MAX_LEVELS} AND NOT (l.ml_bom_id = ANY(u.path))
    )
    SELECT p.code, MAX(u.dist)::int AS dist
    FROM u JOIN public.ml_boms p ON p.id = u.bom_id
    GROUP BY p.code
    ORDER BY dist DESC, p.code
    LIMIT 1
  `)) as unknown as Array<{ code: string; dist: number }>;
  const top = up[0];
  if (top && Number(top.dist) + depth > ML_BOM_MAX_LEVELS) {
    throw new ConflictError(
      `${top.code} uses ${await bomCode(tx, bomId)} as a sub-assembly and would become ` +
        `${Number(top.dist) + depth} levels deep. A Multi-Level BOM can nest at most ` +
        `${ML_BOM_MAX_LEVELS} levels.`,
    );
  }
}
