import { and, asc, count, desc, eq, ilike, isNull, like, or, type SQL } from 'drizzle-orm';
import { items } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import { withUniqueRetry } from '../../lib/db-retry';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import type {
  CreateItemInput,
  Item,
  ListItemsQuery,
  ListItemsResponse,
  UpdateItemInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

export async function listItems(
  input: ListItemsQuery,
  user: AuthContext,
): Promise<ListItemsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(items.companyId, companyId), isNull(items.deletedAt)];
    if (input.search) {
      const searchCondition = or(
        ilike(items.code, `%${input.search}%`),
        ilike(items.name, `%${input.search}%`),
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    if (input.itemType) {
      conditions.push(eq(items.itemType, input.itemType));
    }

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(items)
        .where(where)
        .orderBy((input.sortDir === 'desc' ? desc : asc)(input.sortBy === 'name' ? items.name : items.code))
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(items).where(where),
    ]);

    return {
      items: rows as unknown as Item[],
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

export async function getItem(id: string, user: AuthContext): Promise<Item> {
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError(`Item ${id} not found`);
    return row as unknown as Item;
  });
}

/** Next ITM-#### code in the company series. Server-authoritative so item
 *  codes auto-generate in a series (users may still type/override their own,
 *  e.g. customer part numbers). Highest numeric suffix on an ITM- code + 1. */
async function nextItemCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = await tx
    .select({ code: items.code })
    .from(items)
    .where(and(eq(items.companyId, companyId), like(items.code, 'ITM-%')));
  let max = 0;
  for (const r of rows) {
    const m = /^ITM-(\d+)$/i.exec(r.code ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `ITM-${String(max + 1).padStart(4, '0')}`;
}

/** Preview the next ITM-#### for the create form (prefilled, editable). Reuses
 *  the insert-path generator so the preview matches what createItem assigns. */
export async function getNextItemCode(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({ code: await nextItemCode(tx, companyId) }));
}

export async function createItem(input: CreateItemInput, user: AuthContext): Promise<Item> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  // withUniqueRetry re-runs in a fresh transaction if two concurrent creates
  // collide on the (company_id, code) unique index — e.g. both auto-generate
  // the same ITM-#### — so the loser retries with the next code.
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      const code = input.code?.trim() || (await nextItemCode(tx, companyId));
      const existing = await tx
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.companyId, companyId), eq(items.code, code), isNull(items.deletedAt)))
        .limit(1);
      if (existing.length > 0) {
        throw new ConflictError(`Item code "${code}" already exists`);
      }

      const inserted = await tx
        .insert(items)
        .values({
          companyId,
          code,
          name: input.name,
          description: input.description ?? null,
          drawingNo: input.drawingNo ?? null,
          revision: input.revision,
          material: input.material ?? null,
          uom: input.uom,
          itemType: input.itemType,
          hsnCode: input.hsnCode ?? null,
          drawingFilePath: input.drawingFilePath ?? null,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning();
      const row = inserted[0] as unknown as Item;
      await emitActivityLog(
        tx,
        { action: 'CREATE', entity: 'Item', detail: `${row.code} — ${row.name}`, refId: row.code },
        companyId,
        user,
      );
      return row;
    }),
  );
}

export async function updateItem(
  id: string,
  input: UpdateItemInput,
  user: AuthContext,
): Promise<Item> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .limit(1);
    if (existing.length === 0) {
      throw new NotFoundError(`Item ${id} not found`);
    }

    const updates: Record<string, unknown> = { updatedBy: user.id };
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description ?? null;
    if (input.drawingNo !== undefined) updates.drawingNo = input.drawingNo ?? null;
    if (input.revision !== undefined) updates.revision = input.revision;
    if (input.material !== undefined) updates.material = input.material ?? null;
    if (input.uom !== undefined) updates.uom = input.uom;
    if (input.itemType !== undefined) updates.itemType = input.itemType;
    if (input.hsnCode !== undefined) updates.hsnCode = input.hsnCode ?? null;
    if (input.drawingFilePath !== undefined)
      updates.drawingFilePath = input.drawingFilePath ?? null;

    const updated = await tx.update(items).set(updates).where(eq(items.id, id)).returning();
    const row = updated[0] as unknown as Item;
    await emitActivityLog(
      tx,
      { action: 'EDIT', entity: 'Item', detail: `${row.code} — ${row.name}`, refId: row.code },
      companyId,
      user,
    );
    return row;
  });
}

export async function softDeleteItem(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: items.id, code: items.code, name: items.name })
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .limit(1);
    const row = existing[0];
    if (!row) {
      throw new NotFoundError(`Item ${id} not found`);
    }
    await tx
      .update(items)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(items.id, id));
    await emitActivityLog(
      tx,
      { action: 'DELETE', entity: 'Item', detail: `${row.code} — ${row.name}`, refId: row.code },
      companyId,
      user,
    );
    return { ok: true };
  });
}
