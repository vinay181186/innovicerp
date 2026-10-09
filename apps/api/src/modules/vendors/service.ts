import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  ActivityAction,
  checkPartyGst,
  gstCategoryLabel,
  type MasterImportRowResult,
  type MasterRuleIssue,
} from '@innovic/shared';
import type { DocumentEditStagedResult } from '@innovic/shared';
import { vendors } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { type DiffField, diffFields, softDeleteStamp } from '../../lib/audit-trail';
import { withUniqueRetry } from '../../lib/db-retry';
import { assertUnchangedSinceOpened } from '../../lib/edit-conflict';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { VENDOR_SF_COLUMNS } from './sf-columns';
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
import { createVendorInputSchema, updateVendorImportRowSchema } from './schema';
import type {
  BulkCreateVendorsInput,
  BulkCreateVendorsResponse,
  BulkVendorSkip,
  CreateVendorInput,
  ListVendorsQuery,
  ListVendorsResponse,
  UpdateVendorInput,
  Vendor,
  VendorSaveResponse,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

const activeLabel = (v: unknown): string | null =>
  v === true ? 'Active' : v === false ? 'Inactive' : null;

/** Every user-editable Vendor Master field, with its screen label, for the
 *  Edit row's Before → After (ADR-197). Exported so the edit-approval engine's
 *  registry entry (vendor-edit-registry.ts) diffs the same set. */
export const VENDOR_FIELDS: readonly DiffField[] = [
  { key: 'name', label: 'Vendor Name' },
  { key: 'contactPerson', label: 'Contact Person' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'gstNumber', label: 'GSTIN' },
  {
    key: 'gstCategory',
    label: 'GST Category',
    format: (v) => gstCategoryLabel(v as string) || null,
  },
  { key: 'addressLine1', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'stateCode', label: 'State Code' },
  { key: 'pincode', label: 'Pincode' },
  { key: 'materialsSupplied', label: 'Materials Supplied' },
  { key: 'rating', label: 'Rating' },
  { key: 'paymentTermsDays', label: 'Payment Terms (days)' },
  { key: 'isActive', label: 'Vendor Status', format: activeLabel },
];

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Escape the ILIKE metacharacters in a user's search term. Without this a user
 *  typing "%" in the Vendor Master search box gets a wildcard pattern instead
 *  of a literal search — i.e. the search box becomes a "show everything"
 *  button. Postgres's DEFAULT LIKE/ILIKE escape character is backslash, so no
 *  explicit ESCAPE clause is needed here (and drizzle's `ilike()` builder,
 *  which this list is written with, cannot emit one) — verified against the
 *  live database.
 *  Deliberately a local copy of the sales-orders / purchase-orders helper
 *  rather than an export across modules: it is three lines, and each list must
 *  be free to change its own search behaviour without dragging the others. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listVendors(
  input: ListVendorsQuery,
  user: AuthContext,
): Promise<ListVendorsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(vendors.companyId, companyId), isNull(vendors.deletedAt)];
    if (input.search) {
      // Search covers every column the Vendor Master list actually shows —
      // Code, Name, Contact, Phone, Email, GSTIN, Address and the Rating
      // badge (the <th> row in apps/web/src/modules/vendors/routes/list.tsx).
      // Deliberately NOT searched:
      //  - materials supplied, city, state, pincode — held on the vendor, but
      //    not on this screen;
      //  - Status — it is a boolean rendered as an "Active"/"Inactive" badge,
      //    and a substring match on "active" also matches "inactive", so it
      //    would return every row. The StatStrip tiles already filter status.
      // No money or quantity column exists on this table, so there is nothing
      // here that could leak a value to someone without price access.
      const term = `%${escapeLikeTerm(input.search)}%`;
      const s = or(
        ilike(vendors.code, term),
        ilike(vendors.name, term),
        ilike(vendors.contactPerson, term),
        ilike(vendors.phone, term),
        ilike(vendors.email, term),
        ilike(vendors.gstNumber, term),
        ilike(vendors.addressLine1, term),
        ilike(vendors.rating, term),
      );
      if (s) conditions.push(s);
    }
    if (typeof input.isActive === 'boolean') {
      conditions.push(eq(vendors.isActive, input.isActive));
    }
    // Sort & Filter (ADR-200): the Vendor Master's column filters + sort,
    // through the list's own whitelist (sf-columns.ts). List AND count.
    const sf = readSf(input.sf);
    conditions.push(sql`TRUE ${sfWhere(VENDOR_SF_COLUMNS, sf)}`);

    const where = and(...conditions);

    // ADR-201: the order always ends on a unique key (code, then id) so a
    // 25-row page never skips or repeats a row — names are not unique.
    const dir = input.sortDir === 'desc' ? desc : asc;
    const baseOrder =
      input.sortBy === 'name'
        ? sql`${dir(vendors.name)}, ${dir(vendors.code)}, ${asc(vendors.id)}`
        : sql`${dir(vendors.code)}, ${asc(vendors.id)}`;

    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(vendors)
        .where(where)
        .orderBy(sfOrderBy(VENDOR_SF_COLUMNS, sf, baseOrder))
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(vendors).where(where),
    ]);

    return {
      vendors: rows as unknown as Vendor[],
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

export async function getVendor(id: string, user: AuthContext): Promise<Vendor> {
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(vendors)
      .where(and(eq(vendors.id, id), isNull(vendors.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Vendor not found. It may have been moved to Trash.');
    return row as unknown as Vendor;
  });
}

/** Next VND-### code in the company series (legacy _nextVendorCode, 3-digit). */
async function nextVendorCode(tx: DbTransaction, companyId: string): Promise<string> {
  // ADR-227: ordered NUMERICALLY, over codes that are actually in the series.
  // It used to be `ORDER BY length(code) DESC, code DESC` — a TEXT comparison,
  // correct only while every code is padded to exactly 3 digits. One
  // hand-typed or imported `VND-ACME` is longer than `VND-041`, so it won
  // the LIMIT 1, the digit match then failed, `next` reset to 1 and every later
  // create was refused for ever. The screen can no longer supply a code to work
  // around it (phase 4a), so the series must be right on its own.
  //
  // Deleted rows are counted on purpose: a used number is never re-issued.
  const rows = (await tx.execute(sql`
    SELECT code FROM public.vendors
    WHERE company_id = ${companyId}::uuid
      AND code ~ '^VND-[0-9]+$'
    ORDER BY (SUBSTRING(code FROM 5))::int DESC
    LIMIT 1
  `)) as unknown as Array<{ code: string }>;
  const last = rows[0]?.code ?? null;
  let next = 1;
  if (last) {
    const m = last.match(/^VND-(\d+)$/);
    if (m) next = Number(m[1]) + 1;
  }
  return `VND-${String(next).padStart(3, '0')}`;
}

/** Preview the next VND-### for the create form (visible before save). Reuses
 *  the insert-path generator so the preview matches the assigned code. */
export async function getNextVendorCode(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({ code: await nextVendorCode(tx, companyId) }));
}

export async function createVendor(
  input: CreateVendorInput,
  user: AuthContext,
): Promise<VendorSaveResponse> {
  // Tier gate (was requireWriteRole, which only knew admin/manager). L2 Data
  // Entry can add a vendor; L1 Viewer and L4 Approver cannot.
  await requireFormAccess(user, 'vendor_create', 'entry');
  const companyId = requireCompany(user);
  // withUniqueRetry re-runs in a fresh transaction if two concurrent creates
  // collide on vendors_company_code_uniq (23505).
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      // GST rules (plan v3 Step 2): warn mode → saved + `warnings`; enforce → 400.
      const settings = await loadMasterRuleSettings(tx, companyId);
      const gst = checkPartyGst(input);
      const warnings = applyMasterRules(
        gst.issues,
        settings.masterRulesMode,
        `Vendor "${input.name.trim()}"`,
      );

      const code = input.code?.trim() || (await nextVendorCode(tx, companyId));
      const existing = await tx
        .select({ id: vendors.id, deletedAt: vendors.deletedAt })
        .from(vendors)
        .where(and(eq(vendors.companyId, companyId), eq(vendors.code, code)))
        .limit(1);
      const dup = existing[0];
      if (dup) {
        if (dup.deletedAt) {
          throw new ConflictError(
            `Vendor Code "${code}" is in Trash. Restore it from Trash instead.`,
          );
        }
        throw new ConflictError(`Vendor Code "${code}" already exists.`);
      }

      const inserted = await tx
        .insert(vendors)
        .values({
          companyId,
          code,
          name: input.name,
          contactPerson: emptyToNull(input.contactPerson),
          email: emptyToNull(input.email),
          phone: emptyToNull(input.phone),
          gstNumber: gst.values.gstNumber,
          gstCategory: input.gstCategory ?? null,
          addressLine1: emptyToNull(input.addressLine1),
          city: emptyToNull(input.city),
          state: gst.values.state,
          stateCode: gst.values.stateCode,
          pincode: emptyToNull(input.pincode),
          materialsSupplied: emptyToNull(input.materialsSupplied),
          rating: emptyToNull(input.rating),
          paymentTermsDays: input.paymentTermsDays ?? null,
          isActive: input.isActive,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning();
      const row = inserted[0] as unknown as Vendor;
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Create,
          entity: 'Vendor',
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

type VendorRow = typeof vendors.$inferSelect;

/**
 * The GST part of an update: the rules run on the MERGED record (what the row
 * will hold after this save), so a warning describes the record, not just the
 * fields sent. The GST fields are written only when one of them was sent — an
 * unrelated edit (a new phone number) does not rewrite State / GSTIN.
 */
function vendorGstUpdate(
  before: VendorRow,
  input: UpdateVendorInput,
): { issues: MasterRuleIssue[]; updates: Record<string, unknown> } {
  const gst = checkPartyGst({
    gstCategory: input.gstCategory !== undefined ? input.gstCategory : before.gstCategory,
    gstNumber: input.gstNumber !== undefined ? input.gstNumber : before.gstNumber,
    stateCode:
      input.stateCode !== undefined
        ? input.stateCode
        : input.state !== undefined
          ? null
          : before.stateCode,
    state: input.state !== undefined ? input.state : input.stateCode === null ? null : before.state,
  });
  const touched =
    input.gstCategory !== undefined ||
    input.gstNumber !== undefined ||
    input.stateCode !== undefined ||
    input.state !== undefined;
  const updates: Record<string, unknown> = {};
  if (touched) {
    if (input.gstCategory !== undefined) updates.gstCategory = input.gstCategory;
    updates.gstNumber = gst.values.gstNumber;
    updates.stateCode = gst.values.stateCode;
    updates.state = gst.values.state;
  }
  return { issues: gst.issues, updates };
}

/** Plain-field part of an update (everything but the GST fields). */
function vendorPlainUpdates(input: UpdateVendorInput): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.contactPerson !== undefined) updates.contactPerson = emptyToNull(input.contactPerson);
  if (input.email !== undefined) updates.email = emptyToNull(input.email);
  if (input.phone !== undefined) updates.phone = emptyToNull(input.phone);
  if (input.addressLine1 !== undefined) updates.addressLine1 = emptyToNull(input.addressLine1);
  if (input.city !== undefined) updates.city = emptyToNull(input.city);
  if (input.pincode !== undefined) updates.pincode = emptyToNull(input.pincode);
  if (input.materialsSupplied !== undefined)
    updates.materialsSupplied = emptyToNull(input.materialsSupplied);
  if (input.rating !== undefined) updates.rating = emptyToNull(input.rating);
  if (input.paymentTermsDays !== undefined) updates.paymentTermsDays = input.paymentTermsDays;
  if (input.isActive !== undefined) updates.isActive = input.isActive;
  return updates;
}

/** Excel column names for a refused row's reason (import template headers). */
const VENDOR_IMPORT_LABELS: Record<string, string> = {
  code: 'Code',
  name: 'Vendor Name',
  contactPerson: 'Contact Person',
  email: 'Email',
  phone: 'Phone',
  gstNumber: 'GSTIN',
  gstCategory: 'GST Category',
  addressLine1: 'Address',
  city: 'City',
  state: 'State',
  stateCode: 'State',
  pincode: 'Pincode',
  materialsSupplied: 'Materials/Services',
  rating: 'Rating',
  paymentTermsDays: 'Payment Terms (days)',
  isActive: 'Status',
};

/**
 * The Excel importer's whole sheet in ONE transaction — ERPNext Data Import
 * behaviour (shared/schemas/master-import.ts):
 *   - mode 'insert' creates new vendors (name must be free; VND-### series
 *     continued in memory); mode 'update' finds each row's vendor by Code and
 *     writes only the filled cells, one History (EDIT) row per vendor;
 *   - EVERY row is parsed on its own — a bad email skips that row with its
 *     reason, the rest go in (audit finding 35);
 *   - the GST rules run per row: warn mode imports the row with its warnings,
 *     enforce mode skips it;
 *   - dryRun = the preview: the same answer, nothing written.
 *
 * Speed (why this exists at all): one access check, one read of the whole
 * master, multi-row INSERT — the per-row POST loop it replaced ran at ~1 row
 * per second.
 */
export async function createVendorsBulk(
  input: BulkCreateVendorsInput,
  user: AuthContext,
): Promise<BulkCreateVendorsResponse> {
  const mode = input.mode ?? 'insert';
  const dryRun = input.dryRun ?? false;
  // Insert raises vendors (`entry`); Update Existing changes saved ones (`edit`).
  await requireFormAccess(user, 'vendor_create', mode === 'update' ? 'edit' : 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const settings = await loadMasterRuleSettings(tx, companyId);
    // One read of the whole master. Deleted rows are included on purpose:
    // their CODE is still taken, so the series skips past them.
    const existingRows = await tx.select().from(vendors).where(eq(vendors.companyId, companyId));
    const takenCodes = new Set(existingRows.map((r) => r.code.trim().toLowerCase()));
    const liveByCode = new Map(
      existingRows.filter((r) => !r.deletedAt).map((r) => [r.code.trim().toLowerCase(), r]),
    );
    const trashCodes = new Set(
      existingRows.filter((r) => r.deletedAt).map((r) => r.code.trim().toLowerCase()),
    );
    // Live name → owning code, so a rename to a taken name is refused and a
    // duplicate INSIDE the sheet is caught too.
    const nameOwner = new Map(
      existingRows
        .filter((r) => !r.deletedAt)
        .map((r) => [r.name.trim().toLowerCase(), r.code.trim().toLowerCase()]),
    );

    let nextSeq = 0;
    for (const r of existingRows) {
      const m = /^VND-(\d+)$/i.exec(r.code.trim());
      if (m) nextSeq = Math.max(nextSeq, Number(m[1]));
    }

    const rows: MasterImportRowResult[] = [];
    const inserts: Array<typeof vendors.$inferInsert> = [];
    const codes: string[] = [];
    const updates: Array<{
      before: VendorRow;
      set: Record<string, unknown>;
      changes: ReturnType<typeof diffFields>;
    }> = [];
    const seenCodes = new Set<string>();

    for (const [i, raw] of input.vendors.entries()) {
      const index = i + 1;
      const rawName = rawRowText(raw, 'name');
      const rawCode = rawRowText(raw, 'code') || null;
      const skip = (reason: string, code: string | null = rawCode, name = rawName): void => {
        rows.push({ index, code, name, action: 'skip', reason });
      };

      if (mode === 'insert') {
        const parsed = createVendorInputSchema.safeParse(raw);
        if (!parsed.success) {
          skip(zodRowReason(parsed.error, VENDOR_IMPORT_LABELS));
          continue;
        }
        const c = parsed.data;
        const name = c.name.trim();
        const nameKey = name.toLowerCase();
        if (nameOwner.has(nameKey)) {
          skip('a Vendor with this name already exists', c.code ?? null, name);
          continue;
        }
        let code = c.code?.trim();
        if (code) {
          if (takenCodes.has(code.toLowerCase())) {
            skip(`Vendor Code "${code}" is already used`, code, name);
            continue;
          }
        } else {
          do {
            nextSeq += 1;
            code = `VND-${String(nextSeq).padStart(3, '0')}`;
          } while (takenCodes.has(code.toLowerCase()));
        }
        const gst = checkPartyGst(c);
        if (settings.masterRulesMode === 'enforce' && gst.issues.length > 0) {
          skip(issueTexts(gst.issues).join(' '), code, name);
          continue;
        }
        takenCodes.add(code.toLowerCase());
        nameOwner.set(nameKey, code.toLowerCase());
        inserts.push({
          companyId,
          code,
          name,
          contactPerson: emptyToNull(c.contactPerson),
          email: emptyToNull(c.email),
          phone: emptyToNull(c.phone),
          gstNumber: gst.values.gstNumber,
          gstCategory: c.gstCategory ?? null,
          addressLine1: emptyToNull(c.addressLine1),
          city: emptyToNull(c.city),
          state: gst.values.state,
          stateCode: gst.values.stateCode,
          pincode: emptyToNull(c.pincode),
          materialsSupplied: emptyToNull(c.materialsSupplied),
          rating: emptyToNull(c.rating),
          paymentTermsDays: c.paymentTermsDays ?? null,
          isActive: c.isActive,
          createdBy: user.id,
          updatedBy: user.id,
        });
        codes.push(code);
        rows.push({
          index,
          code,
          name,
          action: 'insert',
          ...(gst.issues.length ? { warnings: issueTexts(gst.issues) } : {}),
        });
        continue;
      }

      // ── Update Existing ──
      const parsed = updateVendorImportRowSchema.safeParse(dropBlankCells(raw));
      if (!parsed.success) {
        skip(zodRowReason(parsed.error, VENDOR_IMPORT_LABELS));
        continue;
      }
      const { code: codeIn, ...patch } = parsed.data;
      const key = codeIn.toLowerCase();
      if (seenCodes.has(key)) {
        skip(`Code "${codeIn}" is repeated in the sheet`);
        continue;
      }
      seenCodes.add(key);
      const before = liveByCode.get(key);
      if (!before) {
        skip(
          trashCodes.has(key)
            ? `Vendor ${codeIn} is in Trash — restore it first`
            : `No vendor with Code "${codeIn}"`,
        );
        continue;
      }
      if (patch.name !== undefined) {
        const owner = nameOwner.get(patch.name.trim().toLowerCase());
        if (owner && owner !== key) {
          skip(`another Vendor is already named "${patch.name.trim()}"`, before.code, before.name);
          continue;
        }
      }
      const gst = vendorGstUpdate(before, patch);
      if (settings.masterRulesMode === 'enforce' && gst.issues.length > 0) {
        skip(issueTexts(gst.issues).join(' '), before.code, before.name);
        continue;
      }
      const set = { ...vendorPlainUpdates(patch), ...gst.updates };
      const changes = diffFields(before, set, VENDOR_FIELDS);
      if (patch.name !== undefined) {
        nameOwner.delete(before.name.trim().toLowerCase());
        nameOwner.set(patch.name.trim().toLowerCase(), key);
      }
      if (changes.length > 0) updates.push({ before, set, changes });
      rows.push({
        index,
        code: before.code,
        name: patch.name?.trim() ?? before.name,
        action: 'update',
        changedFields: changes.length,
        ...(gst.issues.length ? { warnings: issueTexts(gst.issues) } : {}),
      });
    }

    if (!dryRun) {
      // Chunked: one INSERT carries one parameter per column per row and
      // Postgres caps a statement at 65535.
      const CHUNK = 500;
      for (let i = 0; i < inserts.length; i += CHUNK) {
        await tx.insert(vendors).values(inserts.slice(i, i + CHUNK));
      }
      if (inserts.length > 0) {
        // One line for the whole insert, as the Item Master import does.
        await emitActivityLog(
          tx,
          {
            action: ActivityAction.Create,
            entity: 'Vendor',
            detail: `Excel import — ${inserts.length} vendor(s): ${codes[0]}…${codes[codes.length - 1]}`,
          },
          companyId,
          user,
        );
      }
      // Update Existing: one History row per vendor, Before → After (ADR-197).
      for (const u of updates) {
        await tx
          .update(vendors)
          .set({ ...u.set, updatedBy: user.id })
          .where(eq(vendors.id, u.before.id));
        await emitActivityLog(
          tx,
          {
            action: ActivityAction.Edit,
            entity: 'Vendor',
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

    const skipped: BulkVendorSkip[] = rows
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

export async function updateVendor(
  id: string,
  input: UpdateVendorInput,
  user: AuthContext,
): Promise<VendorSaveResponse> {
  // Access check in the public wrapper, not the tx body, so the edit-approval
  // engine's applyEdit can replay an approved edit for an approver who holds
  // `approve` but not `edit`.
  await requireFormAccess(user, 'vendor_create', 'edit');
  return withUserContext(user, (tx) => updateVendorTx(tx, id, input, user));
}

/**
 * The body of a Vendor edit, inside a caller-supplied transaction. Called by
 * updateVendor (which opens the tx) and by the edit-approval engine's applyEdit
 * (which already holds one). Every §20 guard lives here: the FOR UPDATE lock,
 * assertUnchangedSinceOpened and the GST rule. The caller performs the edit /
 * approve access check.
 */
export async function updateVendorTx(
  tx: DbTransaction,
  id: string,
  input: UpdateVendorInput,
  user: AuthContext,
): Promise<VendorSaveResponse> {
  const companyId = requireCompany(user);
  // The whole row, read BEFORE the update — the "before" of Before → After.
  const existing = await tx
    .select()
    .from(vendors)
    .where(and(eq(vendors.id, id), isNull(vendors.deletedAt)))
    .for('update')
    .limit(1);
  const before = existing[0];
  if (!before) throw new NotFoundError('Vendor not found. It may have been moved to Trash.');
  // R5: refuse the save if someone else edited the vendor after this form opened it.
  assertUnchangedSinceOpened(before.updatedAt, input.expectedUpdatedAt);

  const settings = await loadMasterRuleSettings(tx, companyId);
  const gst = vendorGstUpdate(before, input);
  const warnings = applyMasterRules(gst.issues, settings.masterRulesMode, `Vendor ${before.code}`);

  const updates: Record<string, unknown> = {
    updatedBy: user.id,
    ...vendorPlainUpdates(input),
    ...gst.updates,
  };

  const changes = diffFields(before, updates, VENDOR_FIELDS);
  const updated = await tx.update(vendors).set(updates).where(eq(vendors.id, id)).returning();
  const row = updated[0] as unknown as Vendor;
  if (changes.length > 0) {
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Edit,
        entity: 'Vendor',
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
}

/**
 * The Vendor edit entry point the HTTP route calls. Edit-approval (ADR-202):
 * when the company gate is on and the vendor is still editable (a master is
 * editable while it is not in Trash), the edit is STAGED for approval and a
 * {staged:true, request} result is returned; otherwise it falls through to
 * updateVendor (today's behaviour). A vendor is a single record with no child
 * lines — there is no line guard.
 */
export async function updateVendorOrStage(
  id: string,
  input: UpdateVendorInput,
  user: AuthContext,
): Promise<VendorSaveResponse | DocumentEditStagedResult> {
  await requireFormAccess(user, 'vendor_create', 'edit');
  const companyId = requireCompany(user);

  // Imported dynamically to avoid a static import cycle with vendor-edit-registry
  // (which imports updateVendorTx from this file).
  const { isDocEditApprovalOn, requestDocumentEdit } = await import('../document-edits/service');
  const shouldStage = await withUserContext(user, async (tx) => {
    if (!(await isDocEditApprovalOn(tx, companyId))) return false;
    // "Editable" mirrors vendorEditRegistryEntry.isLive: any live (not-Trash) vendor.
    const rows = await tx
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.id, id), eq(vendors.companyId, companyId), isNull(vendors.deletedAt)))
      .limit(1);
    return rows.length > 0;
  });
  if (shouldStage) {
    const request = await requestDocumentEdit('Vendor', id, input, input.expectedUpdatedAt, user);
    return { staged: true, request };
  }

  return updateVendor(id, input, user);
}

export async function softDeleteVendor(
  id: string,
  reason: string,
  user: AuthContext,
): Promise<{ ok: true }> {
  // Delete is not one of the four tier actions, so it is expressed as the pair
  // that only L5 Department Admin and above hold: edit AND approve. L3 Editor
  // has edit but not approve; L4 Approver has approve but not edit. The screen
  // above this used to hide Delete behind admin-only, which locked out the very
  // tier meant to run the department — the owner decided L5 gets delete rights.
  await requireFormAccess(user, 'vendor_create', 'edit');
  await requireFormAccess(user, 'vendor_create', 'approve');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // The whole row, read BEFORE the update — the "before" of Before → After.
    const existing = await tx
      .select()
      .from(vendors)
      .where(and(eq(vendors.id, id), isNull(vendors.deletedAt)))
      .limit(1);
    const before = existing[0];
    if (!before) throw new NotFoundError('Vendor not found. It may have been moved to Trash.');
    await tx
      .update(vendors)
      .set({ ...softDeleteStamp(user), updatedBy: user.id })
      .where(eq(vendors.id, id));
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Delete,
        entity: 'Vendor',
        entityId: before.id,
        refId: before.code,
        reason,
        detail: `${before.code} — ${before.name}`,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}
