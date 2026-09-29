import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNull,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { ITEM_TYPE_RULES, type ItemType, itemTypeLabel, withPartyMaterialSuffix } from '@innovic/shared';
import { items } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { withUniqueRetry } from '../../lib/db-retry';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import type {
  BulkCreateItemsInput,
  BulkCreateItemsResponse,
  BulkItemSkip,
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

/** Item types that are the customer's property (ADR-195) — derived from the
 *  shared rule map so a future party-owned type is covered without editing this
 *  list. Currently just `party_supplied_material`. */
const PARTY_OWNED_ITEM_TYPES = (Object.keys(ITEM_TYPE_RULES) as ItemType[]).filter(
  (t) => ITEM_TYPE_RULES[t].partyOwned,
);

/** Escape the ILIKE metacharacters in a user's search term. Without this a user
 *  typing "%" in the Item Master search box gets a wildcard pattern instead of
 *  a literal search — i.e. the search box becomes a "show everything" button.
 *  Postgres's DEFAULT LIKE/ILIKE escape character is backslash, so no explicit
 *  ESCAPE clause is needed here (and drizzle's `ilike()` builder, which this
 *  list is written with, cannot emit one) — verified against the live database.
 *  Deliberately a local copy of the sales-orders / purchase-orders helper
 *  rather than an export across modules: it is three lines, and each list must
 *  be free to change its own search behaviour without dragging the others. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listItems(
  input: ListItemsQuery,
  user: AuthContext,
): Promise<ListItemsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(items.companyId, companyId), isNull(items.deletedAt)];
    if (input.search) {
      // Search covers every column the Item Master list actually shows — Item
      // Code, Name, Description, Drawing No., Rev, Material and the UOM badge
      // (the column defs in apps/web/src/modules/items/routes/list.tsx).
      // UOM is a Postgres enum, so it needs an explicit ::text cast — `uom
      // ILIKE $1` errors with "operator does not exist: uom ~~*". The raw
      // fragment carries ESCAPE '\' so it behaves exactly like the ilike()
      // calls around it (which get the same behaviour from Postgres's default).
      // Deliberately NOT searched:
      //  - HSN code — stored on the item, not on this screen;
      //  - item type — not a row column; it is the StatStrip filter above the
      //    table (All / Component / Assembly), so searching it would only
      //    duplicate a filter that already exists;
      //  - the drawing file path — the "Drw" cell renders an icon, not the path;
      //  - min stock qty — a quantity: partial matching on numbers makes a
      //    short term useless.
      // No money column exists on this table.
      const term = `%${escapeLikeTerm(input.search)}%`;
      const searchCondition = or(
        ilike(items.code, term),
        ilike(items.name, term),
        ilike(items.description, term),
        ilike(items.drawingNo, term),
        ilike(items.revision, term),
        ilike(items.material, term),
        sql`${items.uom}::text ILIKE ${term} ESCAPE '\\'`,
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    if (input.itemType) {
      conditions.push(eq(items.itemType, input.itemType));
    }
    // ADR-195: general item pickers (e.g. PO / PR / BOM line items) pass this flag
    // to hide the customer's party-supplied material, which they must never pick.
    // The Item Master list leaves it unset and still shows every type.
    if (input.excludePartyOwned && PARTY_OWNED_ITEM_TYPES.length > 0) {
      conditions.push(notInArray(items.itemType, PARTY_OWNED_ITEM_TYPES));
    }
    // ADR-171: Source filter (Make / Buy).
    if (input.procurementType) {
      conditions.push(eq(items.procurementType, input.procurementType));
    }

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(items)
        .where(where)
        .orderBy(
          (input.sortDir === 'desc' ? desc : asc)(
            input.sortBy === 'name' ? items.name : items.code,
          ),
        )
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
    if (!row) throw new NotFoundError('Item not found. It may have been moved to Trash.');
    return row as unknown as Item;
  });
}

/** Next ITM-#### code in the company series. Server-authoritative so item
 *  codes auto-generate in a series (users may still type/override their own,
 *  e.g. customer part numbers). Highest numeric suffix on an ITM- code + 1.
 *
 *  ADR-195: `ITM-####` and `ITM-####-rm` (party-supplied material) share ONE
 *  counter. An optional `-rm` suffix is stripped before the number is read, so
 *  the plain and the -rm forms can never land on the same integer. */
async function nextItemCode(tx: DbTransaction, companyId: string): Promise<string> {
  // Single indexed read, not a JS scan of the whole column: strip an optional
  // -rm suffix and the ITM- prefix in SQL, cast the remainder to int and take the
  // MAX. The `~*` regexp WHERE keeps only well-formed ITM-####[-rm] codes, so the
  // cast never sees a non-numeric value (a hand-typed code like ITM-SPL is
  // ignored — the series is only ever the auto-numbered ones).
  const rows = (await tx.execute(sql`
    SELECT COALESCE(
      MAX(CAST(regexp_replace(regexp_replace(lower(code), '-rm$', ''), '^itm-', '') AS integer)),
      0
    ) + 1 AS next_num
    FROM public.items
    WHERE company_id = ${companyId}::uuid
      AND code ~* '^itm-[0-9]+(-rm)?$'
  `)) as unknown as Array<{ next_num: number }>;
  const next = Number(rows[0]?.next_num ?? 1);
  return `ITM-${String(next).padStart(4, '0')}`;
}

/** Preview the next ITM-#### for the create form (prefilled, editable). Reuses
 *  the insert-path generator so the preview matches what createItem assigns. */
export async function getNextItemCode(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({ code: await nextItemCode(tx, companyId) }));
}

export async function createItem(input: CreateItemInput, user: AuthContext): Promise<Item> {
  // Tier gate (was the admin/manager role check). L2 Data Entry can add an
  // item; L1 Viewer and L4 Approver cannot.
  await requireFormAccess(user, 'item_create', 'entry');
  const companyId = requireCompany(user);
  // withUniqueRetry re-runs in a fresh transaction if two concurrent creates
  // collide on the (company_id, code) unique index — e.g. both auto-generate
  // the same ITM-#### — so the loser retries with the next code.
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      // ADR-195: a Party Supplied Material item always carries the `-rm` suffix,
      // whether the code was auto-generated (blank input) or hand-typed. Other
      // item types keep the code exactly as given / generated.
      const baseCode = input.code?.trim() || (await nextItemCode(tx, companyId));
      const code =
        input.itemType === 'party_supplied_material'
          ? withPartyMaterialSuffix(baseCode)
          : baseCode;
      const existing = await tx
        .select({ id: items.id, deletedAt: items.deletedAt })
        .from(items)
        .where(and(eq(items.companyId, companyId), eq(items.code, code)))
        .limit(1);
      const dup = existing[0];
      if (dup) {
        if (dup.deletedAt) {
          throw new ConflictError(
            `Item Code "${code}" is in Trash. Restore it from Trash instead.`,
          );
        }
        throw new ConflictError(`Item Code "${code}" already exists.`);
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
          procurementType: input.procurementType,
          hsnCode: input.hsnCode ?? null,
          drawingFilePath: input.drawingFilePath ?? null,
          imagePath: input.imagePath ?? null,
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

/**
 * Create many items in ONE transaction — the Excel importer's whole sheet.
 *
 * Why this exists: the importer used to call createItem once per row and wait
 * for each round trip, and every success invalidated the on-screen item list, so
 * the browser re-downloaded the whole master after every row. Measured live on
 * the identical vendor import, that ran at ~1 row/second — nine minutes for a
 * 500-row sheet — and got slower as the master grew.
 *
 * What makes this fast is not batching the HTTP call alone — it is doing the
 * per-row work ONCE:
 *   - one access check, one transaction, one RLS context set;
 *   - existing codes read in a single query instead of one lookup per row;
 *   - the ITM-#### series continued in memory instead of re-scanning the table
 *     for every row;
 *   - one multi-row INSERT instead of N;
 *   - one activity-log line for the import instead of one per item.
 *
 * DE-DUPLICATION KEY: item CODE, and only code. That is what the importer has
 * always used — the sheet's "Item Code*" column is required, the parser rejects
 * a code repeated inside the file, and the API rejected a code already stored.
 * Names are deliberately NOT de-duplicated: two genuinely different items can
 * share a name (same part, different revision or customer), so refusing on name
 * would throw away real rows. The check simply moves here, where it compares
 * against the WHOLE company instead of only the rows the browser had loaded.
 *
 * Tolerant, not all-or-nothing: a bad row is reported and left out, the rest go
 * in. A sheet with one duplicate should not cost the operator the other 499.
 */
export async function createItemsBulk(
  input: BulkCreateItemsInput,
  user: AuthContext,
): Promise<BulkCreateItemsResponse> {
  // Same gate as a single create — this raises items, so it is `entry`.
  await requireFormAccess(user, 'item_create', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // One read of what already exists, rather than a duplicate-check per row.
    // Deleted rows are included on purpose: their CODE is still taken (the
    // single create refuses to reuse it), so the series must skip past them and
    // the operator gets told to restore rather than re-create.
    const existingRows = await tx
      .select({ code: items.code, deletedAt: items.deletedAt })
      .from(items)
      .where(eq(items.companyId, companyId));

    const takenCodes = new Set(existingRows.map((r) => r.code.trim().toLowerCase()));
    const deletedCodes = new Set(
      existingRows.filter((r) => r.deletedAt).map((r) => r.code.trim().toLowerCase()),
    );

    // Continue the ITM-#### series in memory. nextItemCode() scans the table for
    // the highest code; doing that per row is one extra query per item.
    let nextSeq = 0;
    for (const r of existingRows) {
      // ADR-195: ITM-#### and ITM-####-rm share one counter — strip an optional
      // -rm suffix before reading the number so the series never collides.
      const m = /^ITM-(\d+)$/i.exec(r.code.trim().replace(/-rm$/i, ''));
      if (m) nextSeq = Math.max(nextSeq, Number(m[1]));
    }

    const skipped: BulkItemSkip[] = [];
    const values: Array<typeof items.$inferInsert> = [];
    const codes: string[] = [];

    for (const [i, it] of input.items.entries()) {
      const index = i + 1;
      const name = it.name.trim();

      let code = it.code?.trim();
      if (code) {
        const key = code.toLowerCase();
        if (deletedCodes.has(key)) {
          skipped.push({
            index,
            name,
            reason: `Item Code "${code}" already exists in Trash — restore it from Trash instead`,
          });
          continue;
        }
        if (takenCodes.has(key)) {
          skipped.push({ index, name, reason: `Item Code "${code}" already exists` });
          continue;
        }
      } else {
        // Code is optional on import — the server assigns the next in series,
        // exactly as the single create does when the form leaves it blank.
        nextSeq += 1;
        code = `ITM-${String(nextSeq).padStart(4, '0')}`;
        // Defensive: a company holding a hand-typed ITM-0007 alongside the
        // series could collide. Walk forward until the code is free.
        while (takenCodes.has(code.toLowerCase())) {
          nextSeq += 1;
          code = `ITM-${String(nextSeq).padStart(4, '0')}`;
        }
      }
      // Claim the code so a duplicate INSIDE the sheet is caught too, not only
      // one against what was already stored.
      takenCodes.add(code.toLowerCase());

      values.push({
        companyId,
        code,
        name,
        description: it.description ?? null,
        drawingNo: it.drawingNo ?? null,
        revision: it.revision,
        material: it.material ?? null,
        uom: it.uom,
        itemType: it.itemType,
        procurementType: it.procurementType,
        hsnCode: it.hsnCode ?? null,
        drawingFilePath: it.drawingFilePath ?? null,
        imagePath: it.imagePath ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      });
      codes.push(code);
    }

    if (values.length > 0) {
      // One statement for the lot. Chunked because a single INSERT carries one
      // parameter per column per row and Postgres caps a statement at 65535.
      const CHUNK = 500;
      for (let i = 0; i < values.length; i += CHUNK) {
        await tx.insert(items).values(values.slice(i, i + CHUNK));
      }
      // One line for the whole import. Writing an activity row per item would
      // put the per-row cost straight back into the transaction, and the log
      // reader wants "500 items imported", not 500 near-identical lines.
      await emitActivityLog(
        tx,
        {
          action: 'CREATE',
          entity: 'Item',
          detail: `Excel import — ${values.length} item(s): ${codes[0]}…${codes[codes.length - 1]}`,
        },
        companyId,
        user,
      );
    }

    return { created: values.length, skipped, codes };
  });
}

export async function updateItem(
  id: string,
  input: UpdateItemInput,
  user: AuthContext,
): Promise<Item> {
  // Changing a saved record is `edit`, so L2 (create-only) is correctly refused.
  await requireFormAccess(user, 'item_create', 'edit');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: items.id, code: items.code, itemType: items.itemType })
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .for('update')
      .limit(1);
    if (existing.length === 0) {
      throw new NotFoundError('Item not found. It may have been moved to Trash.');
    }
    // ADR-193 (P23): a Tool / Instrument is handed out and returned, so its
    // history is built differently. Once stock has moved, the type may not be
    // switched to or from 'tool'; other type changes stay allowed (logged).
    const cur = existing[0]!;
    if (
      input.itemType !== undefined &&
      input.itemType !== cur.itemType &&
      (input.itemType === 'tool' || cur.itemType === 'tool')
    ) {
      const moved = (await tx.execute(sql`
        SELECT 1 FROM public.store_transactions WHERE item_id = ${id}::uuid LIMIT 1
      `)) as unknown as unknown[];
      if (moved.length > 0) {
        throw new ConflictError(
          `${cur.code}: Item Type cannot be changed to or from Tool / Instrument once stock has moved. Create a new item instead.`,
        );
      }
    }
    // ADR-195: the item CODE is permanent, and a Party Supplied Material item bakes
    // the -rm suffix into its code at creation. So the type may never be switched
    // INTO or OUT OF party-supplied on edit — doing so would leave the code and the
    // type inconsistent (a -rm code on a non-party item, or a party item without
    // one). Create a new item instead.
    if (
      input.itemType !== undefined &&
      input.itemType !== cur.itemType &&
      (input.itemType === 'party_supplied_material' ||
        cur.itemType === 'party_supplied_material')
    ) {
      throw new ConflictError(
        `${cur.code}: Item Type cannot be changed to or from Party Supplied Material — the item code (with its -rm suffix) is permanent. Create a new item instead.`,
      );
    }

    const updates: Record<string, unknown> = { updatedBy: user.id };
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description ?? null;
    if (input.drawingNo !== undefined) updates.drawingNo = input.drawingNo ?? null;
    if (input.revision !== undefined) updates.revision = input.revision;
    if (input.material !== undefined) updates.material = input.material ?? null;
    if (input.uom !== undefined) updates.uom = input.uom;
    if (input.itemType !== undefined) updates.itemType = input.itemType;
    if (input.procurementType !== undefined) updates.procurementType = input.procurementType;
    if (input.hsnCode !== undefined) updates.hsnCode = input.hsnCode ?? null;
    if (input.drawingFilePath !== undefined)
      updates.drawingFilePath = input.drawingFilePath ?? null;
    // Product image: a string sets it, null clears it, undefined leaves it alone.
    if (input.imagePath !== undefined) updates.imagePath = input.imagePath ?? null;

    const updated = await tx.update(items).set(updates).where(eq(items.id, id)).returning();
    const row = updated[0] as unknown as Item;
    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'Item',
        detail:
          `${row.code} — ${row.name}` +
          (input.itemType !== undefined && input.itemType !== cur.itemType
            ? ` · Item Type ${itemTypeLabel(cur.itemType)} → ${itemTypeLabel(input.itemType)}`
            : ''),
        refId: row.code,
      },
      companyId,
      user,
    );
    return row;
  });
}

export async function softDeleteItem(id: string, user: AuthContext): Promise<{ ok: true }> {
  // Delete is not one of the four tier actions, so it is expressed as the pair
  // that only L5 Department Admin and above hold: edit AND approve. L3 Editor
  // has edit but not approve; L4 Approver has approve but not edit. The owner
  // scoped delete to the tier meant to run the department.
  await requireFormAccess(user, 'item_create', 'edit');
  await requireFormAccess(user, 'item_create', 'approve');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: items.id, code: items.code, name: items.name })
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .limit(1);
    const row = existing[0];
    if (!row) {
      throw new NotFoundError('Item not found. It may have been moved to Trash.');
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
