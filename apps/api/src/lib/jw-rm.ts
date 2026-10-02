// ADR-203 — the customer's raw material (RM) for a JWSO line.
//
// Owner rules (2026-10-02): every JWSO line's order item ABCD123 has ONE customer
// RM item, code ABCD123-RM (Party Supplied Material, UOM NOS, ₹0). It is found
// or created SILENTLY — no user input — and REUSED whenever the item code
// matches, whichever customer the JWSO is for. The per-customer register lives
// on party_materials (one row per RM item + customer, PM-####).
//
// Both functions are idempotent and safe under concurrency:
//   · a transaction advisory lock per (company, order item) / (company, RM, client)
//     serialises two saves for the same pair, and
//   · the unique indexes items_company_parent_rm_uniq / items_company_lower_code_uniq
//     / party_materials_company_item_client_uniq make a duplicate impossible even
//     if a caller forgets the lock.
// Errors are THROWN — a JWSO must never save without its material (the old
// ADR-195 bridge swallowed them; that is what ADR-203 removes).

import { ITEM_TYPE_RULES, rmCodeForItemCode, type ItemType } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';
import { lockDocSeries } from './doc-series-lock';
import { ConflictError, NotFoundError, ValidationError } from './errors';

export interface RmItem {
  rmItemId: string;
  rmItemCode: string;
  rmItemName: string;
  created: boolean;
}

/** Find or create the `<code>-RM` item for one order item. */
export async function ensureRmItemForOrderItem(
  tx: DbTransaction,
  companyId: string,
  orderItemId: string,
  userId: string,
): Promise<RmItem> {
  const parents = (await tx.execute(sql`
    SELECT id, code, name, material, item_type::text AS "itemType"
      FROM public.items
     WHERE id = ${orderItemId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<{
    id: string;
    code: string;
    name: string;
    material: string | null;
    itemType: string;
  }>;
  const parent = parents[0];
  if (!parent) throw new NotFoundError('Item not found in the Item Master.');
  if (ITEM_TYPE_RULES[parent.itemType as ItemType]?.partyOwned) {
    throw new ValidationError(
      `${parent.code} is a customer material (Party Supplied Material) — pick the part to be made, not its raw material.`,
    );
  }

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`jw-rm:${companyId}:${orderItemId}`}, 0))`,
  );

  // 1. Already linked to this order item.
  const linked = (await tx.execute(sql`
    SELECT id, code, name FROM public.items
     WHERE company_id = ${companyId}::uuid AND parent_item_id = ${orderItemId}::uuid
       AND deleted_at IS NULL
  `)) as unknown as Array<{ id: string; code: string; name: string }>;
  if (linked[0]) {
    return {
      rmItemId: linked[0].id,
      rmItemCode: linked[0].code,
      rmItemName: linked[0].name,
      created: false,
    };
  }

  // 2. An item already carries the code (any letter case): adopt it if it is a
  //    Party Supplied Material with no owner yet; refuse anything else.
  const code = rmCodeForItemCode(parent.code);
  const byCode = (await tx.execute(sql`
    SELECT id, code, name, item_type::text AS "itemType", parent_item_id AS "parentItemId"
      FROM public.items
     WHERE company_id = ${companyId}::uuid AND lower(code) = lower(${code}) AND deleted_at IS NULL
  `)) as unknown as Array<{
    id: string;
    code: string;
    name: string;
    itemType: string;
    parentItemId: string | null;
  }>;
  const existing = byCode[0];
  if (existing) {
    if (existing.itemType !== 'party_supplied_material') {
      throw new ConflictError(
        `Item code ${existing.code} already exists and is not a Party Supplied Material — rename it before using ${parent.code} on a JWSO.`,
      );
    }
    if (existing.parentItemId && existing.parentItemId !== orderItemId) {
      throw new ConflictError(`${existing.code} already belongs to another item.`);
    }
    await tx.execute(sql`
      UPDATE public.items SET parent_item_id = ${orderItemId}::uuid, updated_at = now(), updated_by = ${userId}::uuid
       WHERE id = ${existing.id}::uuid AND parent_item_id IS NULL
    `);
    return {
      rmItemId: existing.id,
      rmItemCode: existing.code,
      rmItemName: existing.name,
      created: false,
    };
  }

  // 3. Create it — same name, NOS, Party Supplied Material, no user input.
  const inserted = (await tx.execute(sql`
    INSERT INTO public.items
      (company_id, code, name, material, uom, item_type, procurement_type, parent_item_id, created_by, updated_by)
    VALUES
      (${companyId}::uuid, ${code}, ${parent.name}, ${parent.material}, 'NOS', 'party_supplied_material',
       'buy', ${orderItemId}::uuid, ${userId}::uuid, ${userId}::uuid)
    RETURNING id, code, name
  `)) as unknown as Array<{ id: string; code: string; name: string }>;
  const row = inserted[0]!;
  return { rmItemId: row.id, rmItemCode: row.code, rmItemName: row.name, created: true };
}

/** Find or create the per-customer party material (register row) for an RM
 *  item. PM-#### numbering is serialised by the party_materials series lock. */
export async function ensurePartyMaterial(
  tx: DbTransaction,
  companyId: string,
  rmItemId: string,
  clientId: string,
  userId: string,
): Promise<{ partyMaterialId: string; partyMaterialCode: string }> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${companyId}:${clientId}:${rmItemId}`}, 0))`,
  );
  const found = (await tx.execute(sql`
    SELECT id, code FROM public.party_materials
     WHERE company_id = ${companyId}::uuid AND item_id = ${rmItemId}::uuid
       AND client_id = ${clientId}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<{ id: string; code: string }>;
  if (found[0]) return { partyMaterialId: found[0].id, partyMaterialCode: found[0].code };

  const info = (await tx.execute(sql`
    SELECT i.code AS "itemCode", i.name AS "itemName", i.material, c.code AS "clientCode"
      FROM public.items i, public.clients c
     WHERE i.id = ${rmItemId}::uuid AND i.company_id = ${companyId}::uuid AND i.deleted_at IS NULL
       AND i.item_type = 'party_supplied_material'
       AND c.id = ${clientId}::uuid AND c.company_id = ${companyId}::uuid AND c.deleted_at IS NULL
  `)) as unknown as Array<{
    itemCode: string;
    itemName: string;
    material: string | null;
    clientCode: string;
  }>;
  const i = info[0];
  if (!i) throw new ValidationError('Customer material or customer not found.');

  await lockDocSeries(tx, companyId, 'party_materials');
  const next = (await tx.execute(sql`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '^PM-', ''), '')::int), 0) + 1 AS n
      FROM public.party_materials
     WHERE company_id = ${companyId}::uuid AND code ~ '^PM-\\d+$'
  `)) as unknown as Array<{ n: number }>;
  const pmCode = `PM-${String(Number(next[0]?.n ?? 1)).padStart(4, '0')}`;

  const ins = (await tx.execute(sql`
    INSERT INTO public.party_materials
      (company_id, code, name, material, uom, client_id, client_code_text, item_id, item_code_text,
       stock_qty, issued_qty, received_qty, created_by, updated_by)
    VALUES
      (${companyId}::uuid, ${pmCode}, ${i.itemName}, ${i.material}, 'NOS', ${clientId}::uuid, ${i.clientCode},
       ${rmItemId}::uuid, ${i.itemCode}, 0, 0, 0, ${userId}::uuid, ${userId}::uuid)
    RETURNING id, code
  `)) as unknown as Array<{ id: string; code: string }>;
  return { partyMaterialId: ins[0]!.id, partyMaterialCode: ins[0]!.code };
}
