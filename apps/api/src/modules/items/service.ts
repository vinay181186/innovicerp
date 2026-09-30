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
import {
  ActivityAction,
  checkItemHsn,
  ITEM_PROCUREMENT_TYPE_LABEL,
  ITEM_TYPE_RULES,
  type ItemProcurementType,
  type ItemType,
  itemTypeLabel,
  type MasterImportRowResult,
  withPartyMaterialSuffix,
} from '@innovic/shared';
import { items } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { type DiffField, diffFields, softDeleteStamp } from '../../lib/audit-trail';
import { withUniqueRetry } from '../../lib/db-retry';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import {
  applyMasterRules,
  dropBlankCells,
  issueTexts,
  loadMasterRuleSettings,
  rawRowText,
  withWarnings,
  zodRowReason,
} from '../../lib/master-rules';
import { emitActivityLog } from '../activity-log/service';
import { checkTypeAndSerialChange, SERIAL_ONLY_FOR_TOOLS, trackSerialForCreate } from './type-lock';
import { createItemInputSchema, updateItemImportRowSchema } from './schema';
import type {
  BulkCreateItemsInput,
  BulkCreateItemsResponse,
  BulkItemSkip,
  CreateItemInput,
  Item,
  ItemSaveResponse,
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
/** File path → just the file name, for the History tab's Before → After. */
function fileName(v: unknown): string | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  return v.split('/').pop() ?? v;
}

/** Every user-editable Item Master field, with its screen label (NAMING.md),
 *  for the Edit row's Before → After (ADR-197). */
const ITEM_FIELDS: readonly DiffField[] = [
  { key: 'name', label: 'Item Name' },
  { key: 'description', label: 'Description' },
  { key: 'drawingNo', label: 'Drawing No.' },
  { key: 'revision', label: 'Item Master Rev' },
  { key: 'material', label: 'Material' },
  { key: 'uom', label: 'UOM' },
  {
    key: 'itemType',
    label: 'Item Type',
    format: (v) => (typeof v === 'string' && v ? itemTypeLabel(v as ItemType) : null),
  },
  {
    key: 'procurementType',
    label: 'Make / Buy',
    format: (v) =>
      typeof v === 'string' && v
        ? (ITEM_PROCUREMENT_TYPE_LABEL[v as ItemProcurementType] ?? v)
        : null,
  },
  { key: 'trackSerial', label: 'Track by Serial No.' },
  { key: 'hsnCode', label: 'HSN Code' },
  { key: 'drawingFilePath', label: 'Old Drawing', format: fileName },
  { key: 'imagePath', label: 'Product image', format: fileName },
];

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

export async function createItem(
  input: CreateItemInput,
  user: AuthContext,
): Promise<ItemSaveResponse> {
  // Tier gate (was the admin/manager role check). L2 Data Entry can add an
  // item; L1 Viewer and L4 Approver cannot.
  await requireFormAccess(user, 'item_create', 'entry');
  const companyId = requireCompany(user);
  // withUniqueRetry re-runs in a fresh transaction if two concurrent creates
  // collide on the (company_id, code) unique index — e.g. both auto-generate
  // the same ITM-#### — so the loser retries with the next code.
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      // HSN rule (plan D3): warn mode → saved + `warnings`; enforce → 400.
      const settings = await loadMasterRuleSettings(tx, companyId);
      const warnings = applyMasterRules(
        checkItemHsn(input, settings),
        settings.masterRulesMode,
        `Item "${input.name}"`,
      );
      // ADR-195: a Party Supplied Material item always carries the `-rm` suffix,
      // whether the code was auto-generated (blank input) or hand-typed. Other
      // item types keep the code exactly as given / generated.
      const baseCode = input.code?.trim() || (await nextItemCode(tx, companyId));
      const code =
        input.itemType === 'party_supplied_material' ? withPartyMaterialSuffix(baseCode) : baseCode;
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
          trackSerial: trackSerialForCreate(input.itemType, input.trackSerial),
          hsnCode: emptyToNull(input.hsnCode),
          drawingFilePath: input.drawingFilePath ?? null,
          imagePath: input.imagePath ?? null,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning();
      const row = inserted[0] as unknown as Item;
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Create,
          entity: 'Item',
          entityId: row.id,
          refId: row.code,
          detail: `${row.code} — ${row.name}`,
        },
        companyId,
        user,
      );
      return withWarnings(row, warnings);
    }),
  );
}

type ItemRow = typeof items.$inferSelect;

/** Excel column names for a refused row's reason (import template headers). */
const ITEM_IMPORT_LABELS: Record<string, string> = {
  code: 'Item Code',
  name: 'Item Name',
  description: 'Description',
  material: 'Material',
  uom: 'UOM',
  itemType: 'Item Type',
  procurementType: 'Source',
  hsnCode: 'HSN Code',
  drawingNo: 'Drawing No.',
  revision: 'Item Master Rev',
  trackSerial: 'Track by Serial No.',
};

/**
 * The Excel importer's whole sheet in ONE transaction — ERPNext Data Import
 * behaviour (shared/schemas/master-import.ts):
 *   - mode 'insert' creates new items by Item Code (codes are the de-dup key;
 *     names are NOT — two different items may share a name); a blank code gets
 *     the next ITM-####; a Party Supplied Material code gets its -rm suffix,
 *     as the single create does;
 *   - mode 'update' finds each row's item by Item Code and writes only the
 *     filled cells, one History (EDIT) row per item. Item Type and Track by
 *     Serial No. are NOT changed by import (they carry stock locks) — a row
 *     that tries is skipped with the reason;
 *   - EVERY row is parsed on its own — a bad row is skipped with its reason,
 *     the rest go in;
 *   - the HSN rule runs per row (warn → imported with a warning, enforce →
 *     skipped);
 *   - dryRun = the preview: the same answer, nothing written.
 *
 * Speed (why this exists at all): one access check, one read of the whole
 * master, multi-row INSERT — the per-row POST loop it replaced ran at ~1 row
 * per second.
 */
export async function createItemsBulk(
  input: BulkCreateItemsInput,
  user: AuthContext,
): Promise<BulkCreateItemsResponse> {
  const mode = input.mode ?? 'insert';
  const dryRun = input.dryRun ?? false;
  // Insert raises items (`entry`); Update Existing changes saved ones (`edit`).
  await requireFormAccess(user, 'item_create', mode === 'update' ? 'edit' : 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const settings = await loadMasterRuleSettings(tx, companyId);
    // One read of the whole master. Deleted rows are included on purpose:
    // their CODE is still taken (restore, don't re-create).
    const existingRows = await tx.select().from(items).where(eq(items.companyId, companyId));
    const takenCodes = new Set(existingRows.map((r) => r.code.trim().toLowerCase()));
    const liveByCode = new Map(
      existingRows.filter((r) => !r.deletedAt).map((r) => [r.code.trim().toLowerCase(), r]),
    );
    const deletedCodes = new Set(
      existingRows.filter((r) => r.deletedAt).map((r) => r.code.trim().toLowerCase()),
    );

    // Continue the ITM-#### series in memory (ITM-#### and ITM-####-rm share
    // one counter, ADR-195).
    let nextSeq = 0;
    for (const r of existingRows) {
      const m = /^ITM-(\d+)$/i.exec(r.code.trim().replace(/-rm$/i, ''));
      if (m) nextSeq = Math.max(nextSeq, Number(m[1]));
    }

    const rows: MasterImportRowResult[] = [];
    const inserts: Array<typeof items.$inferInsert> = [];
    const codes: string[] = [];
    const updates: Array<{
      before: ItemRow;
      set: Record<string, unknown>;
      changes: ReturnType<typeof diffFields>;
    }> = [];
    const seenCodes = new Set<string>();

    for (const [i, raw] of input.items.entries()) {
      const index = i + 1;
      const rawName = rawRowText(raw, 'name');
      const rawCode = rawRowText(raw, 'code') || null;
      const skip = (reason: string, code: string | null = rawCode, name = rawName): void => {
        rows.push({ index, code, name, action: 'skip', reason });
      };

      if (mode === 'insert') {
        const parsed = createItemInputSchema.safeParse(raw);
        if (!parsed.success) {
          skip(zodRowReason(parsed.error, ITEM_IMPORT_LABELS));
          continue;
        }
        const it = parsed.data;
        const name = it.name.trim();
        if (it.trackSerial && it.itemType !== 'tool') {
          skip(SERIAL_ONLY_FOR_TOOLS, it.code ?? null, name);
          continue;
        }
        let code = it.code?.trim();
        if (code) {
          if (it.itemType === 'party_supplied_material') code = withPartyMaterialSuffix(code);
          const key = code.toLowerCase();
          if (deletedCodes.has(key)) {
            skip(
              `Item Code "${code}" already exists in Trash — restore it from Trash instead`,
              code,
              name,
            );
            continue;
          }
          if (takenCodes.has(key)) {
            skip(`Item Code "${code}" already exists`, code, name);
            continue;
          }
        } else {
          do {
            nextSeq += 1;
            code = `ITM-${String(nextSeq).padStart(4, '0')}`;
            if (it.itemType === 'party_supplied_material') code = withPartyMaterialSuffix(code);
          } while (takenCodes.has(code.toLowerCase()));
        }
        const issues = checkItemHsn(it, settings);
        if (settings.masterRulesMode === 'enforce' && issues.length > 0) {
          skip(issueTexts(issues).join(' '), code, name);
          continue;
        }
        takenCodes.add(code.toLowerCase());
        inserts.push({
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
          trackSerial: it.trackSerial === true,
          hsnCode: emptyToNull(it.hsnCode),
          drawingFilePath: it.drawingFilePath ?? null,
          imagePath: it.imagePath ?? null,
          createdBy: user.id,
          updatedBy: user.id,
        });
        codes.push(code);
        rows.push({
          index,
          code,
          name,
          action: 'insert',
          ...(issues.length ? { warnings: issueTexts(issues) } : {}),
        });
        continue;
      }

      // ── Update Existing ──
      const parsed = updateItemImportRowSchema.safeParse(dropBlankCells(raw));
      if (!parsed.success) {
        skip(zodRowReason(parsed.error, ITEM_IMPORT_LABELS));
        continue;
      }
      const { code: codeIn, ...patch } = parsed.data;
      const key = codeIn.toLowerCase();
      if (seenCodes.has(key)) {
        skip(`Item Code "${codeIn}" is repeated in the sheet`);
        continue;
      }
      seenCodes.add(key);
      const before = liveByCode.get(key);
      if (!before) {
        skip(
          deletedCodes.has(key)
            ? `Item ${codeIn} is in Trash — restore it first`
            : `No item with Item Code "${codeIn}"`,
        );
        continue;
      }
      if (patch.itemType !== undefined && patch.itemType !== before.itemType) {
        skip(
          `Item Type cannot be changed by import (${itemTypeLabel(before.itemType)} → ${itemTypeLabel(patch.itemType)}) — change it on the item screen`,
          before.code,
          before.name,
        );
        continue;
      }
      if (patch.trackSerial !== undefined && patch.trackSerial !== before.trackSerial) {
        skip(
          'Track by Serial No. cannot be changed by import — change it on the item screen',
          before.code,
          before.name,
        );
        continue;
      }
      const set = itemPlainUpdates(patch);
      const issues = checkItemHsn(
        {
          itemType: before.itemType,
          hsnCode: patch.hsnCode !== undefined ? patch.hsnCode : before.hsnCode,
        },
        settings,
      );
      if (settings.masterRulesMode === 'enforce' && issues.length > 0) {
        skip(issueTexts(issues).join(' '), before.code, before.name);
        continue;
      }
      const changes = diffFields(before, set, ITEM_FIELDS);
      if (changes.length > 0) updates.push({ before, set, changes });
      rows.push({
        index,
        code: before.code,
        name: patch.name?.trim() ?? before.name,
        action: 'update',
        changedFields: changes.length,
        ...(issues.length ? { warnings: issueTexts(issues) } : {}),
      });
    }

    if (!dryRun) {
      // Chunked: one INSERT carries one parameter per column per row and
      // Postgres caps a statement at 65535.
      const CHUNK = 500;
      for (let i = 0; i < inserts.length; i += CHUNK) {
        await tx.insert(items).values(inserts.slice(i, i + CHUNK));
      }
      if (inserts.length > 0) {
        // One line for the whole insert — the log reader wants "500 items
        // imported", not 500 near-identical lines.
        await emitActivityLog(
          tx,
          {
            action: ActivityAction.Create,
            entity: 'Item',
            detail: `Excel import — ${inserts.length} item(s): ${codes[0]}…${codes[codes.length - 1]}`,
          },
          companyId,
          user,
        );
      }
      // Update Existing: one History row per item, Before → After (ADR-197).
      for (const u of updates) {
        await tx
          .update(items)
          .set({ ...u.set, updatedBy: user.id })
          .where(eq(items.id, u.before.id));
        await emitActivityLog(
          tx,
          {
            action: ActivityAction.Edit,
            entity: 'Item',
            entityId: u.before.id,
            refId: u.before.code,
            changes: u.changes,
            detail: `Excel import (update) — ${u.before.code} — ${u.before.name}`,
          },
          companyId,
          user,
        );
      }
    }

    const skipped: BulkItemSkip[] = rows
      .filter((r) => r.action === 'skip')
      .map((r) => ({ index: r.index, name: r.name, reason: r.reason ?? '' }));
    return {
      dryRun,
      mode,
      created: inserts.length,
      updated: rows.filter((r) => r.action === 'update').length,
      rows,
      skipped,
      codes,
    };
  });
}

/** Fields an item update may write directly (not Item Type / Track by Serial
 *  No., which go through type-lock.ts). Shared by the item screen's update and
 *  the Update Existing import. */
function itemPlainUpdates(input: UpdateItemInput): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description ?? null;
  if (input.drawingNo !== undefined) updates.drawingNo = input.drawingNo ?? null;
  if (input.revision !== undefined) updates.revision = input.revision;
  if (input.material !== undefined) updates.material = input.material ?? null;
  if (input.uom !== undefined) updates.uom = input.uom;
  if (input.procurementType !== undefined) updates.procurementType = input.procurementType;
  if (input.hsnCode !== undefined) updates.hsnCode = emptyToNull(input.hsnCode);
  if (input.drawingFilePath !== undefined) updates.drawingFilePath = input.drawingFilePath ?? null;
  // Product image: a string sets it, null clears it, undefined leaves it alone.
  if (input.imagePath !== undefined) updates.imagePath = input.imagePath ?? null;
  return updates;
}

function emptyToNull(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  return t.length === 0 ? null : t;
}

export async function updateItem(
  id: string,
  input: UpdateItemInput,
  user: AuthContext,
): Promise<ItemSaveResponse> {
  // Changing a saved record is `edit`, so L2 (create-only) is correctly refused.
  await requireFormAccess(user, 'item_create', 'edit');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // The whole row, read BEFORE the update — it is the "before" of the
    // History tab's Before → After (ADR-197).
    const existing = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .for('update')
      .limit(1);
    if (existing.length === 0) {
      throw new NotFoundError('Item not found. It may have been moved to Trash.');
    }
    // ADR-193 (P23 / P15 phase 4): no switch to or from 'tool', and no change
    // of Track by Serial No., once stock has moved (type-lock.ts).
    const cur = existing[0]!;
    // ADR-195: the item CODE is permanent, and a Party Supplied Material item bakes
    // the -rm suffix into its code at creation. So the type may never be switched
    // INTO or OUT OF party-supplied on edit — doing so would leave the code and the
    // type inconsistent (a -rm code on a non-party item, or a party item without
    // one). Create a new item instead.
    if (
      input.itemType !== undefined &&
      input.itemType !== cur.itemType &&
      (input.itemType === 'party_supplied_material' || cur.itemType === 'party_supplied_material')
    ) {
      throw new ConflictError(
        `${cur.code}: Item Type cannot be changed to or from Party Supplied Material — the item code (with its -rm suffix) is permanent. Create a new item instead.`,
      );
    }
    const trackSerial = await checkTypeAndSerialChange(tx, id, cur, input);

    // HSN rule on the MERGED item (type and HSN after this save).
    const settings = await loadMasterRuleSettings(tx, companyId);
    const warnings = applyMasterRules(
      checkItemHsn(
        {
          itemType: input.itemType ?? cur.itemType,
          hsnCode: input.hsnCode !== undefined ? input.hsnCode : cur.hsnCode,
        },
        settings,
      ),
      settings.masterRulesMode,
      `Item ${cur.code}`,
    );

    const updates: Record<string, unknown> = { updatedBy: user.id, ...itemPlainUpdates(input) };
    if (input.itemType !== undefined) updates.itemType = input.itemType;
    if (trackSerial !== undefined) updates.trackSerial = trackSerial;

    const changes = diffFields(cur, updates, ITEM_FIELDS);
    const updated = await tx.update(items).set(updates).where(eq(items.id, id)).returning();
    const row = updated[0] as unknown as Item;
    if (changes.length > 0) {
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Edit,
          entity: 'Item',
          entityId: row.id,
          refId: row.code,
          changes,
          detail: `Edited ${row.code} — ${row.name}`,
        },
        companyId,
        user,
      );
    }
    return withWarnings(row, warnings);
  });
}

export async function softDeleteItem(
  id: string,
  reason: string,
  user: AuthContext,
): Promise<{ ok: true }> {
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
      .set({ ...softDeleteStamp(user), updatedBy: user.id })
      .where(eq(items.id, id));
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Delete,
        entity: 'Item',
        entityId: row.id,
        refId: row.code,
        reason,
        detail: `${row.code} — ${row.name}`,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}
