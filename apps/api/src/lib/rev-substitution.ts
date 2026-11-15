// ADR-292 — approved Rev substitutions (rev_substitutions, 0250).
//
// A substitution lets stock of one Drawing Rev (`from`) be used where an SO
// line / JWSO line / Job Card asks for another (`to`), up to qty_allowed.
//
// This file is the ONE writer of rev_substitutions.qty_used (§20.1):
//   consumeSubstitution   — Dispatch / Item Issue of a substituted part
//   giveBackSubstitution  — Dispatch cancel / edit down, Item Issue return /
//                           cancel of a substituted part
// Both lock the matching rows FOR UPDATE inside the caller's transaction, then
// check and write (§20.3); the CHECK qty_used BETWEEN 0 AND qty_allowed is the
// database backstop.
//
// Every use is recorded against its source row (rev_substitution_uses, 0251):
// a give-back returns exactly what THAT source used — never re-derived from the
// order / Job Card's Rev, which may have changed since.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';
import { ConflictError } from './errors';

export type SubstitutionScope =
  | { salesOrderLineId: string }
  | { jobWorkOrderLineId: string }
  | { jobCardId: string };

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

function scopeFrag(scope: SubstitutionScope) {
  if ('salesOrderLineId' in scope)
    return sql`sales_order_line_id = ${scope.salesOrderLineId}::uuid`;
  if ('jobWorkOrderLineId' in scope) return sql`jw_line_id = ${scope.jobWorkOrderLineId}::uuid`;
  return sql`job_card_id = ${scope.jobCardId}::uuid`;
}

/** The one sentence a wrong-Rev Dispatch / Item Issue is refused with. */
export function revMismatchMessage(
  usedLabel: string,
  askedLabel: string,
  against: 'order' | 'Job Card' = 'order',
): string {
  return (
    `Revision mismatch with the ${against}: ${usedLabel} is not the ${against}'s Drawing Rev (${askedLabel}). ` +
    'An Engineering-approved substitution is needed.'
  );
}

interface SubArgs {
  companyId: string;
  userId: string;
  scope: SubstitutionScope;
  /** The Rev of the stock used. */
  fromRevId: string;
  /** The Rev the scope asks for; null = any `to` (the scope has no Rev). */
  toRevId: string | null;
  qty: number;
}

/** The document row that used a substitution. */
export interface SubstitutionSource {
  type: 'dispatch_line' | 'store_issue_line';
  id: string;
}

interface LockedSub {
  id: string;
  allowed: number;
  used: number;
}

async function lockMatching(
  tx: DbTransaction,
  a: Omit<SubArgs, 'qty' | 'userId'>,
): Promise<LockedSub[]> {
  const rows = (await tx.execute(sql`
    SELECT id, qty_allowed::float8 AS allowed, qty_used::float8 AS used
      FROM public.rev_substitutions
     WHERE company_id = ${a.companyId}::uuid AND deleted_at IS NULL
       AND ${scopeFrag(a.scope)}
       AND from_item_revision_id = ${a.fromRevId}::uuid
       ${a.toRevId ? sql`AND to_item_revision_id = ${a.toRevId}::uuid` : sql``}
     ORDER BY approved_at, id
     FOR UPDATE`)) as unknown as Array<{ id: string; allowed: number; used: number }>;
  return rows.map((r) => ({ id: r.id, allowed: Number(r.allowed), used: Number(r.used) }));
}

/** True when a live substitution exists for this scope + Rev pair (any qty left). */
export async function hasSubstitution(
  tx: DbTransaction,
  a: Omit<SubArgs, 'qty' | 'userId'>,
): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT 1 FROM public.rev_substitutions
     WHERE company_id = ${a.companyId}::uuid AND deleted_at IS NULL
       AND ${scopeFrag(a.scope)}
       AND from_item_revision_id = ${a.fromRevId}::uuid
       ${a.toRevId ? sql`AND to_item_revision_id = ${a.toRevId}::uuid` : sql``}
     LIMIT 1`)) as unknown as unknown[];
  return rows.length > 0;
}

/**
 * Use `qty` of the approved substitution(s): rows locked, oldest approval
 * first. Refused (409) when what is left is less than `qty` — nothing written.
 * One use row per substitution taken, against `source`.
 */
export async function consumeSubstitution(
  tx: DbTransaction,
  a: SubArgs & {
    source: SubstitutionSource;
    usedLabel: string;
    askedLabel: string;
    against?: 'order' | 'Job Card';
  },
): Promise<void> {
  const qty = r3(a.qty);
  if (qty <= 0) return;
  const subs = await lockMatching(tx, a);
  const left = r3(subs.reduce((s, x) => s + Math.max(0, x.allowed - x.used), 0));
  if (subs.length === 0 || left < qty) {
    throw new ConflictError(
      subs.length === 0
        ? revMismatchMessage(a.usedLabel, a.askedLabel, a.against)
        : `${a.usedLabel} in place of ${a.askedLabel}: Qty (${qty}) cannot be more than the approved substitution still left (${left}).`,
    );
  }
  let need = qty;
  for (const s of subs) {
    if (need <= 0) break;
    const take = r3(Math.min(need, s.allowed - s.used));
    if (take <= 0) continue;
    await tx.execute(sql`
      UPDATE public.rev_substitutions
         SET qty_used = qty_used + ${take}, updated_at = now(), updated_by = ${a.userId}::uuid
       WHERE id = ${s.id}::uuid`);
    await tx.execute(sql`
      INSERT INTO public.rev_substitution_uses
        (company_id, substitution_id, source_type, source_id, qty, created_by, updated_by)
      VALUES (${a.companyId}::uuid, ${s.id}::uuid, ${a.source.type}, ${a.source.id}::uuid, ${take},
              ${a.userId}::uuid, ${a.userId}::uuid)`);
    need = r3(need - take);
  }
}

/**
 * Give back up to `qty` of what `source` used (its use rows, newest first),
 * never more than it used and has not yet given back. `fromRevId` limits it to
 * uses of that stock Rev (a partial return from one bucket). Returns how much
 * went back — 0 when the source used no substitution.
 */
export async function giveBackSubstitution(
  tx: DbTransaction,
  a: {
    companyId: string;
    userId: string;
    source: SubstitutionSource;
    qty: number;
    fromRevId?: string | null | undefined;
  },
): Promise<number> {
  let need = r3(a.qty);
  if (need <= 0) return 0;
  // Substitution rows first, then the use rows — the order consume locks in.
  const uses = (await tx.execute(sql`
    SELECT u.id, u.substitution_id AS "subId", (u.qty - u.returned_qty)::float8 AS open
      FROM public.rev_substitution_uses u
      JOIN public.rev_substitutions s ON s.id = u.substitution_id
     WHERE u.company_id = ${a.companyId}::uuid AND u.deleted_at IS NULL
       AND u.source_type = ${a.source.type} AND u.source_id = ${a.source.id}::uuid
       AND u.qty > u.returned_qty
       ${a.fromRevId ? sql`AND s.from_item_revision_id = ${a.fromRevId}::uuid` : sql``}
     ORDER BY u.created_at DESC, u.id DESC
       FOR UPDATE OF s, u`)) as unknown as Array<{ id: string; subId: string; open: number }>;
  let given = 0;
  for (const u of uses) {
    if (need <= 0) break;
    const back = r3(Math.min(need, Number(u.open)));
    if (back <= 0) continue;
    await tx.execute(sql`
      UPDATE public.rev_substitution_uses
         SET returned_qty = returned_qty + ${back}, updated_at = now(), updated_by = ${a.userId}::uuid
       WHERE id = ${u.id}::uuid`);
    await tx.execute(sql`
      UPDATE public.rev_substitutions
         SET qty_used = GREATEST(0, qty_used - ${back}), updated_at = now(),
             updated_by = ${a.userId}::uuid
       WHERE id = ${u.subId}::uuid`);
    need = r3(need - back);
    given = r3(given + back);
  }
  return given;
}
