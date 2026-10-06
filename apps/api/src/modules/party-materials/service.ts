// Party Materials service (Store slice 1; reworked by ADR-203).
//
// The customer-material register master: one row per Party Supplied Material
// (`<item>-RM`) item + customer (PM-####). Normally created silently by the
// JWSO save (lib/jw-rm ensurePartyMaterial); this master screen can add one by
// hand, under the same rules (RM item required, one per item + customer,
// server-assigned code).
//
// Stock fields (`stock_qty`, `issued_qty`, `received_qty`, `returned_qty`) are
// NOT written here: stock_qty by lib/party-stock-ledger (the one writer), the
// lifetime counters by the documents that move the material (Party GRN QC,
// issue to Job Card, Customer Material Return). This service only reads/writes
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
import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreatePartyMaterialInput,
  ListPartyMaterialsQuery,
  ListPartyMaterialsResponse,
  PartyMaterial,
  PartyMaterialListItem,
  UpdatePartyMaterialInput,
} from '@innovic/shared';
import { clients, items, partyMaterials } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { lockDocSeries } from '../../lib/doc-series-lock';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { PARTY_MATERIAL_SF_COLUMNS } from './sf-columns';

/** ADR-203: every read of the master is gated on the Party screens' view. */
async function requirePartyMaterialRead(user: AuthContext): Promise<void> {
  await requireFormAccess(user, 'party_create', 'view');
}

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

/** Next PM-#### under the series lock (shared with lib/jw-rm ensurePartyMaterial,
 *  which numbers the same series). */
async function nextPartyMaterialCode(tx: DbTransaction, companyId: string): Promise<string> {
  await lockDocSeries(tx, companyId, 'party_materials');
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
  await requirePartyMaterialRead(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const code = await nextPartyMaterialCode(tx, companyId);
    return { code };
  });
}

export async function listPartyMaterials(
  input: ListPartyMaterialsQuery,
  user: AuthContext,
): Promise<ListPartyMaterialsResponse> {
  await requirePartyMaterialRead(user);
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
    // Sort & Filter (ADR-200): the screen's column filters + sort, through the
    // list's own field whitelist (sf-columns.ts). Applied to list AND count.
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(PARTY_MATERIAL_SF_COLUMNS, sf);
    const orderBy = sfOrderBy(PARTY_MATERIAL_SF_COLUMNS, sf, sql`pm.code ASC`);
    const fromWhere = sql`
      FROM public.party_materials pm
      LEFT JOIN public.clients c ON c.id = pm.client_id AND c.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = pm.item_id AND i.deleted_at IS NULL
      WHERE pm.company_id = ${companyId}::uuid
        AND pm.deleted_at IS NULL
        ${searchFrag}
        ${clientFrag}
        ${sfFrag}`;

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
      ${fromWhere}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    // The pager total counts under the SAME filters (search, customer and
    // Sort & Filter) as the page. It used to count every live material,
    // whatever was searched, so the pager ran past the matching rows.
    const totalRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total ${fromWhere}
    `)) as unknown as Array<{ total: number }>;
    const total = Number(totalRows[0]?.total ?? 0);

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
  await requirePartyMaterialRead(user);
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

/** The Party Supplied Material item a register row is for (ADR-203: required,
 *  and it must BE a Party Supplied Material — the `<item>-RM` item). */
async function loadRmItem(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
): Promise<{ id: string; code: string; material: string | null }> {
  const rows = await tx
    .select({
      id: items.id,
      code: items.code,
      itemType: items.itemType,
      material: items.material,
    })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.companyId, companyId), isNull(items.deletedAt)))
    .limit(1);
  const itm = rows[0];
  if (!itm)
    throw new NotFoundError('Selected Item was not found. Please select the Item Code again.');
  if (itm.itemType !== 'party_supplied_material') {
    throw new ValidationError(
      `${itm.code} is not a Party Supplied Material. Pick the customer's raw material item (the -RM code).`,
    );
  }
  return { id: itm.id, code: itm.code, material: itm.material };
}

async function loadClient(
  tx: DbTransaction,
  companyId: string,
  clientId: string,
): Promise<{ id: string; code: string }> {
  const rows = await tx
    .select({ id: clients.id, code: clients.code })
    .from(clients)
    .where(
      and(eq(clients.id, clientId), eq(clients.companyId, companyId), isNull(clients.deletedAt)),
    )
    .limit(1);
  const cl = rows[0];
  if (!cl) throw new NotFoundError('Selected Customer was not found. Please select again.');
  return cl;
}

/** Serialise every writer of one (item, customer) pair — the same advisory key
 *  lib/jw-rm ensurePartyMaterial takes — then refuse a second register row. */
async function assertOnePerItemClient(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
  itemCode: string,
  clientId: string,
  clientCode: string,
  exceptId: string | null,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${companyId}:${clientId}:${itemId}`}, 0))`,
  );
  const dup = (await tx.execute(sql`
    SELECT code FROM public.party_materials
     WHERE company_id = ${companyId}::uuid AND item_id = ${itemId}::uuid
       AND client_id = ${clientId}::uuid AND deleted_at IS NULL
       ${exceptId ? sql`AND id <> ${exceptId}::uuid` : sql``}
     LIMIT 1
  `)) as unknown as Array<{ code: string }>;
  if (dup[0]) {
    throw new ConflictError(
      `${dup[0].code} is already the customer material for ${itemCode} and ${clientCode}. ` +
        `Use ${dup[0].code} — there is one per item and customer.`,
    );
  }
}

/** Is this material in use — moved in the register, OR named by a live JWSO
 *  line or a live Party GRN line (incl. one still waiting for QC, which has no
 *  register row yet)? Customer / item / UOM are then fixed and it cannot be
 *  deleted (code review fix). */
async function hasRegisterRows(tx: DbTransaction, partyMaterialId: string): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT 1 AS x FROM public.party_stock_ledger
     WHERE party_material_id = ${partyMaterialId}::uuid
    UNION ALL
    SELECT 1 FROM public.job_work_order_lines
     WHERE party_material_id = ${partyMaterialId}::uuid AND deleted_at IS NULL
    UNION ALL
    SELECT 1 FROM public.party_grn_lines pgl
      JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
     WHERE pgl.party_material_id = ${partyMaterialId}::uuid AND pgl.deleted_at IS NULL
    LIMIT 1
  `)) as unknown as Array<{ x: number }>;
  return rows.length > 0;
}

export async function createPartyMaterial(
  input: CreatePartyMaterialInput,
  user: AuthContext,
): Promise<PartyMaterial> {
  // Adding a master record is a create, so L2 Data Entry and up.
  await requireFormAccess(user, 'party_create', 'entry');
  const companyId = requireCompany(user);
  const userId = user.id;
  if (!input.itemId) {
    throw new ValidationError('Pick the Party Supplied Material item (the -RM code).');
  }
  if (!input.clientId) throw new ValidationError('Pick the Customer.');

  return withUserContext(user, async (tx) => {
    const cl = await loadClient(tx, companyId, input.clientId);
    const itm = await loadRmItem(tx, companyId, input.itemId);
    await assertOnePerItemClient(tx, companyId, itm.id, itm.code, cl.id, cl.code, null);

    // ADR-203: the code is the server's (PM-####, series-locked); the code the
    // form sends is ignored.
    const code = await nextPartyMaterialCode(tx, companyId);
    const inserted = await tx
      .insert(partyMaterials)
      .values({
        companyId,
        code,
        name: input.name,
        description: input.description ?? null,
        material: input.material ?? null,
        // ADR-203 (D1): customer material is counted in pieces — always NOS.
        uom: 'NOS',
        clientId: cl.id,
        clientCodeText: cl.code,
        itemId: itm.id,
        itemCodeText: itm.code,
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
    const lockedRows = (await tx.execute(sql`
      SELECT id FROM public.party_materials
       WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
       FOR UPDATE
    `)) as unknown as Array<{ id: string }>;
    if (!lockedRows[0]) {
      throw new NotFoundError('Party Material not found. It may have been moved to Trash.');
    }
    const existing = (
      await tx.select().from(partyMaterials).where(eq(partyMaterials.id, id)).limit(1)
    )[0]!;

    // ADR-203: customer, item and UOM are fixed once the material has moved in
    // the register — every movement was booked against them.
    const clientChange = input.clientId !== undefined && input.clientId !== existing.clientId;
    const itemChange = input.itemId !== undefined && input.itemId !== existing.itemId;
    if (input.uom !== undefined && input.uom !== 'NOS') {
      throw new ValidationError('Customer material is counted in pieces — its UOM is always NOS.');
    }
    const uomChange = input.uom !== undefined && input.uom !== existing.uom;
    if ((clientChange || itemChange || uomChange) && (await hasRegisterRows(tx, existing.id))) {
      const what = [clientChange && 'Customer', itemChange && 'Item', uomChange && 'UOM']
        .filter(Boolean)
        .join(', ');
      throw new ConflictError(
        `${existing.code} is already used (JWSO lines, Party GRNs or register movements) — its ${what} cannot be changed.`,
      );
    }

    // Only the fields the request carries, and only when they change.
    const patch: Partial<typeof partyMaterials.$inferInsert> = {};
    if (input.name !== undefined && input.name !== existing.name) patch.name = input.name;
    if (input.description !== undefined && input.description !== (existing.description ?? '')) {
      patch.description = input.description;
    }
    if (input.material !== undefined && input.material !== (existing.material ?? '')) {
      patch.material = input.material;
    }
    if (uomChange && input.uom !== undefined) patch.uom = input.uom;

    let clientId = existing.clientId;
    let clientCode = existing.clientCodeText ?? '';
    if (clientChange && input.clientId !== undefined) {
      const cl = await loadClient(tx, companyId, input.clientId);
      patch.clientId = cl.id;
      patch.clientCodeText = cl.code;
      clientId = cl.id;
      clientCode = cl.code;
    }
    let itemId = existing.itemId;
    let itemCode = existing.itemCodeText ?? '';
    if (itemChange && input.itemId !== undefined) {
      const itm = await loadRmItem(tx, companyId, input.itemId);
      patch.itemId = itm.id;
      patch.itemCodeText = itm.code;
      itemId = itm.id;
      itemCode = itm.code;
      // ADR-218 — Grade belongs to the ITEM, so it follows the item. The Edit
      // screen shows it read-only and sends nothing, so without this a swapped
      // item kept the old item's grade for ever. An explicit `material` in the
      // same request still wins (handled above) for an API caller that means
      // to override it.
      if (input.material === undefined) patch.material = itm.material ?? null;
    }
    if ((clientChange || itemChange) && itemId && clientId) {
      await assertOnePerItemClient(
        tx,
        companyId,
        itemId,
        itemCode,
        clientId,
        clientCode,
        existing.id,
      );
    }

    if (Object.keys(patch).length === 0) {
      return rowToPartyMaterial(existing);
    }

    // ADR-197: before → after, read before the update.
    const changes = diffFields(existing, patch, PARTY_MATERIAL_FIELDS);
    const updated = await tx
      .update(partyMaterials)
      .set({ ...patch, updatedAt: new Date(), updatedBy: userId })
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
  // Delete needs edit AND approve (L5 Department Admin and above).
  await requireFormAccess(user, 'party_create', 'edit');
  await requireFormAccess(user, 'party_create', 'approve');
  const companyId = requireCompany(user);
  const userId = user.id;
  await withUserContext(user, async (tx) => {
    // Lock the row so a receipt or issue cannot land between the check and the delete.
    const rows = (await tx.execute(sql`
      SELECT id, code, stock_qty::int AS "stockQty"
        FROM public.party_materials
       WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
       FOR UPDATE
    `)) as unknown as Array<{ id: string; code: string; stockQty: number }>;
    const existing = rows[0];
    if (!existing) {
      throw new NotFoundError('Party Material not found. It may have been moved to Trash.');
    }
    if (Number(existing.stockQty) > 0) {
      throw new ConflictError(
        `Cannot delete ${existing.code}: ${existing.stockQty} still in the customer material register.`,
      );
    }
    if (await hasRegisterRows(tx, existing.id)) {
      throw new ConflictError(
        `Cannot delete ${existing.code}: it is used by JWSO lines, Party GRNs or register movements, ` +
          `and that history must keep its material.`,
      );
    }
    await tx
      .update(partyMaterials)
      .set({ ...softDeleteStamp(user), updatedAt: new Date(), updatedBy: userId })
      .where(and(eq(partyMaterials.id, existing.id), isNull(partyMaterials.deletedAt)));
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
