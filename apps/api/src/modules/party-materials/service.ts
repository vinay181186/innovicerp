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

import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreatePartyMaterialInput,
  ListPartyMaterialsQuery,
  ListPartyMaterialsResponse,
  PartyMaterial,
  PartyMaterialListItem,
  UpdatePartyMaterialInput,
} from '@innovic/shared';
import { clients, items, partyMaterials } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';

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
    if (!row) throw new NotFoundError(`Party material ${id} not found`);
    return rowToPartyMaterial(row.pm, { itemCode: row.itemCode, itemName: row.itemName });
  });
}

export async function createPartyMaterial(
  input: CreatePartyMaterialInput,
  user: AuthContext,
): Promise<PartyMaterial> {
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
      throw new ConflictError(`Party material code ${input.code} already exists`);
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
    if (!cl) throw new NotFoundError(`Client ${input.clientId} not found`);

    let itemCodeText: string | null = null;
    if (input.itemId) {
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
      if (!itm) throw new NotFoundError(`Item ${input.itemId} not found`);
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
    if (!row) throw new ValidationError('Failed to insert party material');
    return rowToPartyMaterial(row);
  });
}

export async function updatePartyMaterial(
  id: string,
  input: UpdatePartyMaterialInput,
  user: AuthContext,
): Promise<PartyMaterial> {
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
    if (!existing) throw new NotFoundError(`Party material ${id} not found`);

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
      if (!cl) throw new NotFoundError(`Client ${input.clientId} not found`);
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
        if (!itm) throw new NotFoundError(`Item ${input.itemId} not found`);
        patch.itemId = itm.id;
        patch.itemCodeText = itm.code;
      }
    }

    const updated = await tx
      .update(partyMaterials)
      .set(patch)
      .where(eq(partyMaterials.id, existing.id))
      .returning();
    const row = updated[0];
    if (!row) throw new ValidationError('Failed to update party material');
    return rowToPartyMaterial(row);
  });
}

export async function softDeletePartyMaterial(id: string, user: AuthContext): Promise<void> {
  const companyId = requireCompany(user);
  const userId = user.id;
  await withUserContext(user, async (tx) => {
    const rows = await tx
      .select({ id: partyMaterials.id, code: partyMaterials.code, stockQty: partyMaterials.stockQty })
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
    if (!existing) throw new NotFoundError(`Party material ${id} not found`);
    if (existing.stockQty > 0) {
      throw new ConflictError(
        `Cannot delete party material ${existing.code}: stock_qty is ${existing.stockQty}. Issue material first.`,
      );
    }
    await tx
      .update(partyMaterials)
      .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: userId })
      .where(eq(partyMaterials.id, existing.id));
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
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt != null ? tsLike(row.deletedAt) : null,
  };
}
