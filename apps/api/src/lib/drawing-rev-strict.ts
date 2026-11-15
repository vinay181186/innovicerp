// ADR-292 — the "Drawing Rev strict" switch (Approval Configuration).
//
// On: a Production Order or Job Card for a MAKE item with no Drawing Rev is
// refused. Off (the default): it is allowed, and the screens keep showing the
// orange "No Drawing Rev" warning. The owner turns it on only once the Drawing
// Rev Fix List is clean.
//
// Called by the Production Order / Job Card writers (Agent ECR) inside their
// own transaction, so the switch and the item are read in the same snapshot as
// the write.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';
import { ValidationError } from './errors';

/** The switch, read for one company. A company with no config row → off. */
export async function isDrawingRevStrict(tx: DbTransaction, companyId: string): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT drawing_rev_strict AS on
      FROM public.approval_config
     WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
     LIMIT 1`)) as unknown as Array<{ on: boolean | null }>;
  return rows[0]?.on === true;
}

/**
 * Refuse a MAKE item with no Drawing Rev while the switch is on. A Buy item, a
 * named Rev, or the switch off → nothing happens.
 */
export async function assertMakeItemHasRev(
  tx: DbTransaction,
  companyId: string,
  itemId: string | null | undefined,
  itemRevisionId: string | null | undefined,
): Promise<void> {
  if (!itemId || itemRevisionId) return;
  if (!(await isDrawingRevStrict(tx, companyId))) return;
  const rows = (await tx.execute(sql`
    SELECT code, procurement_type::text AS "procurementType"
      FROM public.items
     WHERE id = ${itemId}::uuid AND company_id = ${companyId}::uuid
     LIMIT 1`)) as unknown as Array<{ code: string; procurementType: string | null }>;
  const item = rows[0];
  if (!item || item.procurementType !== 'make') return;
  throw new ValidationError(
    `${item.code} has no Drawing Rev — set it on the order line (Drawing Rev Fix List) before a Production Order / Job Card. Drawing Rev strict is on.`,
  );
}
