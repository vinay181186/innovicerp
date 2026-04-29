import { and, asc, count, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { items } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
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
        .orderBy(asc(items.code))
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

export async function createItem(input: CreateItemInput, user: AuthContext): Promise<Item> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.companyId, companyId),
          eq(items.code, input.code),
          isNull(items.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictError(`Item code "${input.code}" already exists`);
    }

    const inserted = await tx
      .insert(items)
      .values({
        companyId,
        code: input.code,
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
    return inserted[0] as unknown as Item;
  });
}

export async function updateItem(
  id: string,
  input: UpdateItemInput,
  user: AuthContext,
): Promise<Item> {
  requireCompany(user);
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

    const updated = await tx
      .update(items)
      .set(updates)
      .where(eq(items.id, id))
      .returning();
    return updated[0] as unknown as Item;
  });
}

export async function softDeleteItem(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .limit(1);
    if (existing.length === 0) {
      throw new NotFoundError(`Item ${id} not found`);
    }
    await tx
      .update(items)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(items.id, id));
    return { ok: true };
  });
}
