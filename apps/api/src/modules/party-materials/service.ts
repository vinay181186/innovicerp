// Party Materials service (Store slice 1).
//
// Catalogue of raw materials supplied by clients for Job Work orders.
// Mirrors legacy renderPartyMaterial / addPartyMaterial / editPartyMaterial /
// delPartyMaterial (HTML L24129–24241). Numbering: PM-NNNN.
//
// Stock fields (`stock_qty`, `issued_qty`, `received_qty`) are mutated by
// downstream services (Party GRN — increments stock+received; JW Issue —
// increments issued and decrements stock). This service only reads/writes
// the master record.

import { emitActivityLog } from '../activity-log/service';
import { ActivityAction } from '@innovic/shared';
import { type DiffField, diffFields, softDeleteStamp } from '../../lib/audit-trail';

/** Party Material fields compared on Edit — labels as on the Party Material Master. */
const PARTY_MATERIAL_FIELDS: readonly DiffField[] = [
  { key: 'name', label: 'Material Name' },
  { key: 'description', label: 'Description' },
  { key: 'material', label: 'Grade' },
  { key: 'uom', label: 'UOM' },
  { key: 'clientCodeText', label: 'Customer' },
  { key: 'itemCodeText', label: 'Item Code' },
];
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreatePartyMaterialInput,
  ListPartyMaterialsQuery,
  ListPartyMaterialsResponse,
  PartyMaterial,
  PartyMaterialListItem,
  ReturnPartyMaterialInput,
  UpdatePartyMaterialInput,
} from '@innovic/shared';
import { ITEM_TYPE_RULES, type ItemType, PARTY_MATERIAL_UOMS } from '@innovic/shared';
import { clients, items, jobWorkOrderLines, partyMaterials } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { postPartyStockMove } from '../../lib/party-stock-ledger';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function tsLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

const CODE_PREFIX = 'PM-';
const CODE_PAD = 4;

async function nextPartyMaterialCode(
  tx: Parameters<Parameters<typeof withUserContext>[1]>[0],
  companyId: string,
): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(
      MAX(NULLIF(regexp_replace(code, '^${sql.raw(CODE_PREFIX)}', ''), '')::int),
      0
    ) + 1 AS next_num
    FROM public.party_materials
    WHERE company_id = ${companyId}::uuid
      AND code LIKE ${`${CODE_PREFIX}%`}
      AND code ~ ${`^${CODE_PREFIX}\\d+$`}
  `)) as unknown as Array<{ next_num: number }>;
  const next = Number(rows[0]?.next_num ?? 1);
  return `${CODE_PREFIX}${String(next).padStart(CODE_PAD, '0')}`;
}

export async function getNextPartyMaterialCode(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const code = await nextPartyMaterialCode(tx, companyId);
    return { code };
  });
}

/** ADR-102 part-identity rule, widened for ADR-195. A party material fits a
 *  JWSO line when it is pinned to that line's part (the ADR-102 case) OR when
 *  it is pinned to the JWSO's own customer material (`clientMaterial`, the -rm
 *  item code the ADR-195 bridge created it from). Without the second arm the
 *  material the JWSO itself creates could never be received or issued.
 *  Legacy rows with no item link on either side are not checkable and pass. */
export function partyMaterialFitsJwLine(
  pm: { itemId: string | null; itemCodeText: string | null },
  lineItemId: string | null,
  jwClientMaterial: string | null,
): boolean {
  if (pm.itemId == null || lineItemId == null) return true;
  if (pm.itemId === lineItemId) return true;
  const cm = (jwClientMaterial ?? '').trim().toLowerCase();
  const pmCode = (pm.itemCodeText ?? '').trim().toLowerCase();
  return cm !== '' && pmCode === cm;
}

/** ADR-195 bridge — ensure a party_materials record exists for one customer +
 *  one party-supplied item, so the Party GRN / QC / party-stock chain (ADR-194)
 *  can attach to a JWSO's customer material.
 *
 *  Runs inside the CALLER's transaction (the JWSO save) and does NO permission
 *  check of its own — the caller has already gated the write. It reuses the
 *  PM-#### generator so party codes never diverge from the ones the master form
 *  assigns.
 *
 *  Returns the id of the existing or newly-created party material, or null when
 *  it cannot resolve (item code not found, not a party-supplied item, or the
 *  customer is missing). The caller treats every outcome as best-effort — a JWSO
 *  save must not fail because of the bridge.
 *
 *  Respects the (company, code) uniqueness (via the generator) and the
 *  (company, item, client) index (via the existence check before insert).
 *  Note there is NO DB-level unique on (company, item, client) — that shape is
 *  an ordinary index — so this existence check is what keeps it single. */
export async function ensurePartyMaterialForClientItem(
  tx: DbTransaction,
  params: { companyId: string; clientId: string; itemCode: string; user: AuthContext },
): Promise<string | null> {
  const { companyId, clientId, user } = params;
  const code = params.itemCode.trim();
  if (!code) return null;

  // The picked item must exist in this company's Item Master AND be a
  // party-owned type (ADR-195). Anything else is left alone.
  const itemRows = await tx
    .select({
      id: items.id,
      code: items.code,
      name: items.name,
      uom: items.uom,
      itemType: items.itemType,
    })
    .from(items)
    .where(and(eq(items.companyId, companyId), eq(items.code, code), isNull(items.deletedAt)))
    .limit(1);
  const item = itemRows[0];
  if (!item) return null;
  if (!ITEM_TYPE_RULES[item.itemType as ItemType]?.partyOwned) return null;

  // Concurrency guard: there is NO DB unique on (company, item, client), so two
  // concurrent JWSO saves for the same trio could both pass the existence SELECT
  // below and both INSERT, leaving duplicate PM- rows. A transaction-scoped
  // advisory lock keyed on a stable hash of (company, client, item) serialises
  // the bridge for that trio — the second caller blocks here, then sees the first
  // caller's row in the existence check and reuses it. The lock releases
  // automatically when the (JWSO) transaction commits or rolls back.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${companyId}:${clientId}:${item.id}`}, 0))`,
  );

  // Already bridged for this (company, item, client)? Reuse it.
  const existing = await tx
    .select({ id: partyMaterials.id })
    .from(partyMaterials)
    .where(
      and(
        eq(partyMaterials.companyId, companyId),
        eq(partyMaterials.itemId, item.id),
        eq(partyMaterials.clientId, clientId),
        isNull(partyMaterials.deletedAt),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0].id;

  // Snapshot the client's code (mirrors createPartyMaterial's client_code_text).
  const clientRows = await tx
    .select({ id: clients.id, code: clients.code })
    .from(clients)
    .where(
      and(eq(clients.id, clientId), eq(clients.companyId, companyId), isNull(clients.deletedAt)),
    )
    .limit(1);
  const cl = clientRows[0];
  if (!cl) return null;

  const pmCode = await nextPartyMaterialCode(tx, companyId);
  // The party store only knows the coarse UOM set (NOS/KG/MTR/SET/LOT); map the
  // item's UOM onto it, falling back to NOS when it is not one of those.
  const uom = (PARTY_MATERIAL_UOMS as readonly string[]).includes(item.uom) ? item.uom : 'NOS';

  const inserted = await tx
    .insert(partyMaterials)
    .values({
      companyId,
      code: pmCode,
      name: item.name,
      description: null,
      material: null,
      uom,
      clientId: cl.id,
      clientCodeText: cl.code,
      itemId: item.id,
      itemCodeText: item.code,
      stockQty: 0,
      issuedQty: 0,
      receivedQty: 0,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning({ id: partyMaterials.id });
  const row = inserted[0];
  if (!row) return null;

  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Create,
      entity: 'PartyMaterial',
      entityId: row.id,
      refId: pmCode,
      detail: `${pmCode} — ${item.name} (auto-created from JWSO customer material)`,
    },
    companyId,
    user,
  );
  return row.id;
}

export async function listPartyMaterials(
  input: ListPartyMaterialsQuery,
  user: AuthContext,
): Promise<ListPartyMaterialsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (
          pm.code ILIKE ${term}
          OR pm.name ILIKE ${term}
          OR pm.material ILIKE ${term}
          OR pm.description ILIKE ${term}
          OR c.name ILIKE ${term}
        )`
      : sql``;
    const clientFrag = input.clientId ? sql`AND pm.client_id = ${input.clientId}::uuid` : sql``;

    const result = await tx.execute(sql`
      SELECT
        pm.id, pm.company_id AS "companyId", pm.code,
        pm.name, pm.description, pm.material, pm.uom,
        pm.client_id AS "clientId",
        pm.client_code_text AS "clientCodeText",
        pm.item_id AS "itemId",
        pm.item_code_text AS "itemCodeText",
        pm.stock_qty AS "stockQty",
        pm.issued_qty AS "issuedQty",
        pm.received_qty AS "receivedQty",
        pm.returned_qty AS "returnedQty",
        pm.created_at AS "createdAt", pm.created_by AS "createdBy",
        pm.updated_at AS "updatedAt", pm.updated_by AS "updatedBy",
        pm.deleted_at AS "deletedAt",
        c.name AS "clientName",
        i.code AS "itemCode",
        i.name AS "itemName"
      FROM public.party_materials pm
      LEFT JOIN public.clients c ON c.id = pm.client_id AND c.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = pm.item_id AND i.deleted_at IS NULL
      WHERE pm.company_id = ${companyId}::uuid
        AND pm.deleted_at IS NULL
        ${searchFrag}
        ${clientFrag}
      ORDER BY pm.code ASC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [eq(partyMaterials.companyId, companyId), isNull(partyMaterials.deletedAt)];
    const totalRows = await tx
      .select({ value: count() })
      .from(partyMaterials)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    const itemsOut = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items: itemsOut, total, limit: input.limit, offset: input.offset };
  });
}

function toListItem(r: Record<string, unknown>): PartyMaterialListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    name: String(r['name'] ?? ''),
    description: (r['description'] as string | null) ?? null,
    material: (r['material'] as string | null) ?? null,
    uom: String(r['uom'] ?? 'NOS'),
    clientId: (r['clientId'] as string | null) ?? null,
    clientCodeText: (r['clientCodeText'] as string | null) ?? null,
    itemId: (r['itemId'] as string | null) ?? null,
    itemCodeText: (r['itemCodeText'] as string | null) ?? null,
    stockQty: Number(r['stockQty'] ?? 0),
    issuedQty: Number(r['issuedQty'] ?? 0),
    receivedQty: Number(r['receivedQty'] ?? 0),
    returnedQty: Number(r['returnedQty'] ?? 0),
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: r['deletedAt'] != null ? tsLike(r['deletedAt']) : null,
    clientName: (r['clientName'] as string | null) ?? null,
    itemCode: (r['itemCode'] as string | null) ?? null,
    itemName: (r['itemName'] as string | null) ?? null,
  };
}

export async function getPartyMaterial(id: string, user: AuthContext): Promise<PartyMaterial> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // LEFT JOIN items to resolve itemCode/itemName from the FK (item_id), the
    // same join listPartyMaterials uses. item_code_text is nullable, so a row
    // linked only by item_id would otherwise show a blank item code in detail.
    const rows = await tx
      .select({
        pm: partyMaterials,
        itemCode: items.code,
        itemName: items.name,
      })
      .from(partyMaterials)
      .leftJoin(items, and(eq(items.id, partyMaterials.itemId), isNull(items.deletedAt)))
      .where(
        and(
          eq(partyMaterials.id, id),
          eq(partyMaterials.companyId, companyId),
          isNull(partyMaterials.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Party Material not found. It may have been moved to Trash.');
    return rowToPartyMaterial(row.pm, { itemCode: row.itemCode, itemName: row.itemName });
  });
}

export async function createPartyMaterial(
  input: CreatePartyMaterialInput,
  user: AuthContext,
): Promise<PartyMaterial> {
  // Tier gate. Adding a master record is a create, so L2 Data Entry and up.
  // Until now this endpoint had no permission check at all — only a company-id
  // check — so any logged-in account could add a party material.
  await requireFormAccess(user, 'party_create', 'entry');
  const companyId = requireCompany(user);
  const userId = user.id;

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: partyMaterials.id })
      .from(partyMaterials)
      .where(
        and(
          eq(partyMaterials.companyId, companyId),
          eq(partyMaterials.code, input.code),
          isNull(partyMaterials.deletedAt),
        ),
      )
      .limit(1);
    if (existing[0]) {
      throw new ConflictError(`Party Material Code "${input.code}" already exists.`);
    }

    const clientRows = await tx
      .select({ id: clients.id, code: clients.code })
      .from(clients)
      .where(
        and(
          eq(clients.id, input.clientId),
          eq(clients.companyId, companyId),
          isNull(clients.deletedAt),
        ),
      )
      .limit(1);
    const cl = clientRows[0];
    if (!cl) throw new NotFoundError('Selected Customer was not found. Please select again.');

    let itemCodeText: string | null = null;
    if (input.itemId) {
      const itemRows = await tx
        .select({ id: items.id, code: items.code })
        .from(items)
        .where(
          and(eq(items.id, input.itemId), eq(items.companyId, companyId), isNull(items.deletedAt)),
        )
        .limit(1);
      const itm = itemRows[0];
      if (!itm)
        throw new NotFoundError('Selected Item was not found. Please select the Item Code again.');
      itemCodeText = itm.code;
    }

    const inserted = await tx
      .insert(partyMaterials)
      .values({
        companyId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        material: input.material ?? null,
        uom: input.uom,
        clientId: cl.id,
        clientCodeText: cl.code,
        itemId: input.itemId ?? null,
        itemCodeText,
        stockQty: 0,
        issuedQty: 0,
        receivedQty: 0,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new ValidationError('Could not save Party Material. Try again.');
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Create,
        entity: 'PartyMaterial',
        entityId: row.id,
        refId: row.code,
        detail: `${row.code} — ${row.name}`,
      },
      companyId,
      user,
    );
    return rowToPartyMaterial(row);
  });
}

export async function updatePartyMaterial(
  id: string,
  input: UpdatePartyMaterialInput,
  user: AuthContext,
): Promise<PartyMaterial> {
  // Changing a saved record is `edit`, so L2 (create-only) is correctly refused.
  await requireFormAccess(user, 'party_create', 'edit');
  const companyId = requireCompany(user);
  const userId = user.id;

  return withUserContext(user, async (tx) => {
    const existingRows = await tx
      .select()
      .from(partyMaterials)
      .where(
        and(
          eq(partyMaterials.id, id),
          eq(partyMaterials.companyId, companyId),
          isNull(partyMaterials.deletedAt),
        ),
      )
      .limit(1);
    const existing = existingRows[0];
    if (!existing)
      throw new NotFoundError('Party Material not found. It may have been moved to Trash.');

    const patch: Partial<typeof partyMaterials.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: userId,
    };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.material !== undefined) patch.material = input.material;
    if (input.uom !== undefined) patch.uom = input.uom;
    if (input.clientId !== undefined) {
      const clientRows = await tx
        .select({ id: clients.id, code: clients.code })
        .from(clients)
        .where(
          and(
            eq(clients.id, input.clientId),
            eq(clients.companyId, companyId),
            isNull(clients.deletedAt),
          ),
        )
        .limit(1);
      const cl = clientRows[0];
      if (!cl) throw new NotFoundError('Selected Customer was not found. Please select again.');
      patch.clientId = cl.id;
      patch.clientCodeText = cl.code;
    }
    if (input.itemId !== undefined) {
      if (input.itemId === null) {
        patch.itemId = null;
        patch.itemCodeText = null;
      } else {
        const itemRows = await tx
          .select({ id: items.id, code: items.code })
          .from(items)
          .where(
            and(
              eq(items.id, input.itemId),
              eq(items.companyId, companyId),
              isNull(items.deletedAt),
            ),
          )
          .limit(1);
        const itm = itemRows[0];
        if (!itm)
          throw new NotFoundError(
            'Selected Item was not found. Please select the Item Code again.',
          );
        patch.itemId = itm.id;
        patch.itemCodeText = itm.code;
      }
    }

    // ADR-197: before → after, read before the update; no row when nothing changed.
    const changes = diffFields(existing, patch, PARTY_MATERIAL_FIELDS);
    const updated = await tx
      .update(partyMaterials)
      .set(patch)
      .where(eq(partyMaterials.id, existing.id))
      .returning();
    const row = updated[0];
    if (!row) throw new ValidationError('Could not save Party Material. Try again.');
    if (changes.length > 0) {
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Edit,
          entity: 'PartyMaterial',
          entityId: row.id,
          refId: row.code,
          changes,
          detail: `Edited ${row.code} — ${row.name}`,
        },
        companyId,
        user,
      );
    }
    return rowToPartyMaterial(row);
  });
}

export async function softDeletePartyMaterial(
  id: string,
  user: AuthContext,
  /** ADR-197: why it was deleted (the route requires it). */
  reason?: string,
): Promise<void> {
  // Delete is not one of the four tier actions, so it is expressed as the pair
  // only L5 Department Admin and above hold: edit AND approve. L3 Editor has
  // edit without approve; L4 Approver has approve without edit. Previously there
  // was no permission check here at all.
  await requireFormAccess(user, 'party_create', 'edit');
  await requireFormAccess(user, 'party_create', 'approve');
  const companyId = requireCompany(user);
  const userId = user.id;
  await withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        id: partyMaterials.id,
        code: partyMaterials.code,
        stockQty: partyMaterials.stockQty,
      })
      .from(partyMaterials)
      .where(
        and(
          eq(partyMaterials.id, id),
          eq(partyMaterials.companyId, companyId),
          isNull(partyMaterials.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing)
      throw new NotFoundError('Party Material not found. It may have been moved to Trash.');
    if (existing.stockQty > 0) {
      throw new ConflictError(
        `Cannot delete ${existing.code}: ${existing.stockQty} still in stock. Issue it first.`,
      );
    }
    await tx
      .update(partyMaterials)
      .set({ ...softDeleteStamp(user), updatedAt: new Date(), updatedBy: userId })
      .where(eq(partyMaterials.id, existing.id));
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Delete,
        entity: 'PartyMaterial',
        entityId: existing.id,
        refId: existing.code,
        reason: reason?.trim() || null,
        detail: existing.code,
      },
      companyId,
      user,
    );
  });
}

/** R7 (ADR-194): return spare customer material to the customer.
 *
 * Spare client material — over-supplied, or left over after a short-close — is
 * handed back. This takes the qty OUT of the separate party store (a
 * 'return'/'out' ledger row, capped at the current balance by the writer) and
 * bumps the returned_qty lifetime counter. Reuses the jw_create permission — it
 * is a customer-facing job-work movement, not a store-master edit. */
export async function returnPartyMaterial(
  id: string,
  input: ReturnPartyMaterialInput,
  user: AuthContext,
): Promise<PartyMaterial> {
  await requireFormAccess(user, 'jw_create', 'entry');
  const companyId = requireCompany(user);
  const userId = user.id;

  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({ id: partyMaterials.id, code: partyMaterials.code })
      .from(partyMaterials)
      .where(
        and(
          eq(partyMaterials.id, id),
          eq(partyMaterials.companyId, companyId),
          isNull(partyMaterials.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing)
      throw new NotFoundError('Party Material not found. It may have been moved to Trash.');

    // Validate the optional JWSO line belongs to this company before it is
    // stamped on the ledger row (it feeds the JC customer-material roll-up).
    if (input.jwLineId) {
      const lineRows = await tx
        .select({ id: jobWorkOrderLines.id })
        .from(jobWorkOrderLines)
        .where(
          and(
            eq(jobWorkOrderLines.id, input.jwLineId),
            eq(jobWorkOrderLines.companyId, companyId),
            isNull(jobWorkOrderLines.deletedAt),
          ),
        )
        .limit(1);
      if (!lineRows[0])
        throw new NotFoundError('Selected JWSO line was not found. Please pick it again.');
    }

    // The writer locks the row, caps the return at the current balance and
    // lowers stock_qty; this service bumps the returned_qty lifetime counter.
    await postPartyStockMove(tx, {
      companyId,
      partyMaterialId: existing.id,
      jwLineId: input.jwLineId ?? null,
      movement: 'return',
      direction: 'out',
      qty: input.qty,
      sourceDocType: 'party_material_return',
      sourceDocId: existing.id,
      remarks: `Returned to customer: ${input.reason}`,
      userId,
      qtyLabel: 'Return Qty',
    });

    const updated = await tx
      .update(partyMaterials)
      .set({
        returnedQty: sql`${partyMaterials.returnedQty} + ${input.qty}`,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(partyMaterials.id, existing.id))
      .returning();
    const row = updated[0];
    if (!row) throw new ValidationError('Could not record the return. Try again.');

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Return,
        entity: 'PartyMaterial',
        entityId: row.id,
        refId: row.code,
        qty: input.qty,
        reason: input.reason,
        detail: `${row.code} — returned ${input.qty} to customer`,
      },
      companyId,
      user,
    );
    return rowToPartyMaterial(row);
  });
}

function rowToPartyMaterial(
  row: typeof partyMaterials.$inferSelect,
  joined: { itemCode: string | null; itemName: string | null } = {
    itemCode: null,
    itemName: null,
  },
): PartyMaterial {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    name: row.name,
    description: row.description,
    material: row.material,
    uom: row.uom,
    clientId: row.clientId,
    clientCodeText: row.clientCodeText,
    itemId: row.itemId,
    itemCodeText: row.itemCodeText,
    itemCode: joined.itemCode,
    itemName: joined.itemName,
    stockQty: row.stockQty,
    issuedQty: row.issuedQty,
    receivedQty: row.receivedQty,
    returnedQty: row.returnedQty,
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt != null ? tsLike(row.deletedAt) : null,
  };
}
