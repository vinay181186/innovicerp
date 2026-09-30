import { and, asc, count, desc, eq, ilike, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import {
  ActivityAction,
  checkPartyGst,
  gstCategoryLabel,
  type MasterImportRowResult,
  type MasterRuleIssue,
} from '@innovic/shared';
import { clients } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { type DiffField, diffFields, softDeleteStamp } from '../../lib/audit-trail';
import { requireWriteRole } from '../../lib/auth';
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
import { createClientInputSchema, updateClientImportRowSchema } from './schema';
import type {
  BulkClientSkip,
  BulkCreateClientsInput,
  BulkCreateClientsResponse,
  Client,
  ClientSaveResponse,
  CreateClientInput,
  ListClientsQuery,
  ListClientsResponse,
  UpdateClientInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

const activeLabel = (v: unknown): string | null =>
  v === true ? 'Active' : v === false ? 'Inactive' : null;

/** Every user-editable Customer Master field, with its screen label, for the
 *  Edit row's Before → After (ADR-197). Entity 'Client' is not yet in the
 *  shared ACTIVITY_ENTITIES list (shared frozen for this build). */
const CLIENT_FIELDS: readonly DiffField[] = [
  { key: 'name', label: 'Customer' },
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
  { key: 'contactPerson', label: 'Contact Person' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'paymentDays', label: 'Payment Days' },
  { key: 'isActive', label: 'Status', format: activeLabel },
];

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Escape the ILIKE metacharacters in a user's search term. Without this a user
 *  typing "%" in the Client Master search box gets a wildcard pattern instead
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

export async function listClients(
  input: ListClientsQuery,
  user: AuthContext,
): Promise<ListClientsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(clients.companyId, companyId), isNull(clients.deletedAt)];
    if (input.search) {
      // Search covers every column the Client Master list actually shows —
      // Code, Client Name, Address, Contact and Email (the column defs in
      // apps/web/src/modules/clients/routes/list.tsx).
      // Deliberately NOT searched:
      //  - phone, GST number, city, state, pincode — held on the client, but
      //    not on this screen;
      //  - Status — it is a boolean rendered as an "active"/"inactive" badge,
      //    and a substring match on "active" also matches "inactive", so it
      //    would return every row. The StatStrip tiles already filter status.
      // No money or quantity column exists on this table, so there is nothing
      // here that could leak a value to someone without price access.
      const term = `%${escapeLikeTerm(input.search)}%`;
      const s = or(
        ilike(clients.code, term),
        ilike(clients.name, term),
        ilike(clients.addressLine1, term),
        ilike(clients.contactPerson, term),
        ilike(clients.email, term),
      );
      if (s) conditions.push(s);
    }
    if (typeof input.isActive === 'boolean') {
      conditions.push(eq(clients.isActive, input.isActive));
    }

    const where = and(...conditions);

    const dir = input.sortDir === 'desc' ? desc : asc;
    const sortCol = input.sortBy === 'name' ? clients.name : clients.code;
    const orderBy = dir(sortCol);

    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(clients)
        .where(where)
        .orderBy(orderBy)
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(clients).where(where),
    ]);

    return {
      clients: rows as unknown as Client[],
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

export async function getClient(id: string, user: AuthContext): Promise<Client> {
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Customer not found. It may have been moved to Trash.');
    return row as unknown as Client;
  });
}

/** Next CLI-### code in the company series. Server-authoritative so client
 *  codes auto-generate instead of being typed manually (bug 5.1). */
async function nextClientCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = await tx
    .select({ code: clients.code })
    .from(clients)
    .where(and(eq(clients.companyId, companyId), like(clients.code, 'CLI-%')))
    .orderBy(sql`length(${clients.code}) desc`, sql`${clients.code} desc`)
    .limit(1);
  const last = rows[0]?.code ?? null;
  let next = 1;
  if (last) {
    const m = last.match(/^CLI-(\d+)$/i);
    if (m) next = Number(m[1]) + 1;
  }
  return `CLI-${String(next).padStart(3, '0')}`;
}

/** Preview the next CLI-### for the create form, so the auto-generated code is
 *  visible before save. Reuses the same generator the insert path uses, so the
 *  previewed number matches what createClient assigns. */
export async function getNextClientCode(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({ code: await nextClientCode(tx, companyId) }));
}

/**
 * One customer per name. Refuse a name that a LIVE customer (not in Trash)
 * already carries, compared trimmed and case-insensitively — the same rule the
 * Excel import (createClientsBulk) has always applied. Without it "ABC
 * Industries" typed twice got CLI-012 and CLI-013 and split its SOs/invoices
 * over two customers. The 409 carries the existing customer so the quick-add
 * pop-ups can offer "Use this customer" instead of a dead end.
 * `exceptId` lets a rename keep its own name.
 */
async function assertClientNameFree(
  tx: DbTransaction,
  companyId: string,
  name: string,
  exceptId?: string,
): Promise<void> {
  const key = name.trim().toLowerCase();
  if (!key) return;
  const conds: SQL[] = [
    eq(clients.companyId, companyId),
    isNull(clients.deletedAt),
    sql`lower(trim(${clients.name})) = ${key}`,
  ];
  if (exceptId) conds.push(sql`${clients.id} <> ${exceptId}`);
  const rows = await tx
    .select({ id: clients.id, code: clients.code, name: clients.name })
    .from(clients)
    .where(and(...conds))
    .limit(1);
  const dup = rows[0];
  if (dup) {
    throw new ConflictError(
      `A customer named "${dup.name}" already exists (${dup.code}). Use that customer instead of adding it again.`,
      { existingClient: { id: dup.id, code: dup.code, name: dup.name } },
    );
  }
}

export async function createClient(
  input: CreateClientInput,
  user: AuthContext,
): Promise<ClientSaveResponse> {
  requireWriteRole(user);
  await requireFormAccess(user, 'client_create', 'entry');
  const companyId = requireCompany(user);
  // withUniqueRetry re-runs in a fresh transaction if two concurrent creates
  // collide on clients_company_code_uniq (23505) — e.g. both auto-generate the
  // same CLI-### — so the loser retries with the next code instead of 500ing.
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      // GST rules (plan v3 Step 2): warn mode → saved + `warnings`; enforce → 400.
      const settings = await loadMasterRuleSettings(tx, companyId);
      const gst = checkPartyGst(input);
      const warnings = applyMasterRules(
        gst.issues,
        settings.masterRulesMode,
        `Customer "${input.name.trim()}"`,
      );

      const code = input.code?.trim() || (await nextClientCode(tx, companyId));
      const existing = await tx
        .select({ id: clients.id, deletedAt: clients.deletedAt })
        .from(clients)
        .where(and(eq(clients.companyId, companyId), eq(clients.code, code)))
        .limit(1);
      const dup = existing[0];
      if (dup) {
        if (dup.deletedAt) {
          throw new ConflictError(
            `Customer Code "${code}" is in Trash. Restore it from Trash instead.`,
          );
        }
        throw new ConflictError(`Customer Code "${code}" already exists.`);
      }
      await assertClientNameFree(tx, companyId, input.name);

      const inserted = await tx
        .insert(clients)
        .values({
          companyId,
          code,
          name: input.name.trim(),
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
          paymentDays: input.paymentDays ?? null,
          isActive: input.isActive,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning();
      const row = inserted[0] as unknown as Client;
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Create,
          entity: 'Client',
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

type ClientRow = typeof clients.$inferSelect;

/**
 * The GST part of an update: the rules run on the MERGED record (what the row
 * will hold after this save), so a warning describes the record, not just the
 * fields sent. The GST fields are written only when one of them was sent — an
 * unrelated edit (a new phone number) does not rewrite State / GSTIN.
 */
function clientGstUpdate(
  before: ClientRow,
  input: UpdateClientInput,
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
function clientPlainUpdates(input: UpdateClientInput): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.contactPerson !== undefined) updates.contactPerson = emptyToNull(input.contactPerson);
  if (input.email !== undefined) updates.email = emptyToNull(input.email);
  if (input.phone !== undefined) updates.phone = emptyToNull(input.phone);
  if (input.addressLine1 !== undefined) updates.addressLine1 = emptyToNull(input.addressLine1);
  if (input.city !== undefined) updates.city = emptyToNull(input.city);
  if (input.pincode !== undefined) updates.pincode = emptyToNull(input.pincode);
  if (input.paymentDays !== undefined) updates.paymentDays = input.paymentDays;
  if (input.isActive !== undefined) updates.isActive = input.isActive;
  return updates;
}

/** Excel column names for a refused row's reason (import template headers). */
const CLIENT_IMPORT_LABELS: Record<string, string> = {
  code: 'Code',
  name: 'Customer Name',
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
  paymentDays: 'Payment Days',
  isActive: 'Status',
};

/**
 * The Excel importer's whole sheet in ONE transaction — ERPNext Data Import
 * behaviour (shared/schemas/master-import.ts):
 *   - mode 'insert' creates new customers (name must be free; CLI-### series
 *     continued in memory); mode 'update' finds each row's customer by Code and
 *     writes only the filled cells, one History (EDIT) row per customer;
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
export async function createClientsBulk(
  input: BulkCreateClientsInput,
  user: AuthContext,
): Promise<BulkCreateClientsResponse> {
  const mode = input.mode ?? 'insert';
  const dryRun = input.dryRun ?? false;
  requireWriteRole(user);
  // Insert raises customers (`entry`); Update Existing changes saved ones (`edit`).
  await requireFormAccess(user, 'client_create', mode === 'update' ? 'edit' : 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const settings = await loadMasterRuleSettings(tx, companyId);
    // One read of the whole master. Deleted rows are included on purpose:
    // their CODE is still taken, so the series skips past them.
    const existingRows = await tx.select().from(clients).where(eq(clients.companyId, companyId));
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
      const m = /^CLI-(\d+)$/i.exec(r.code.trim());
      if (m) nextSeq = Math.max(nextSeq, Number(m[1]));
    }

    const rows: MasterImportRowResult[] = [];
    const inserts: Array<typeof clients.$inferInsert> = [];
    const codes: string[] = [];
    const updates: Array<{
      before: ClientRow;
      set: Record<string, unknown>;
      changes: ReturnType<typeof diffFields>;
    }> = [];
    const seenCodes = new Set<string>();

    for (const [i, raw] of input.clients.entries()) {
      const index = i + 1;
      const rawName = rawRowText(raw, 'name');
      const rawCode = rawRowText(raw, 'code') || null;
      const skip = (reason: string, code: string | null = rawCode, name = rawName): void => {
        rows.push({ index, code, name, action: 'skip', reason });
      };

      if (mode === 'insert') {
        const parsed = createClientInputSchema.safeParse(raw);
        if (!parsed.success) {
          skip(zodRowReason(parsed.error, CLIENT_IMPORT_LABELS));
          continue;
        }
        const c = parsed.data;
        const name = c.name.trim();
        const nameKey = name.toLowerCase();
        if (nameOwner.has(nameKey)) {
          skip('a Customer with this name already exists', c.code ?? null, name);
          continue;
        }
        let code = c.code?.trim();
        if (code) {
          if (takenCodes.has(code.toLowerCase())) {
            skip(`Customer Code "${code}" is already used`, code, name);
            continue;
          }
        } else {
          do {
            nextSeq += 1;
            code = `CLI-${String(nextSeq).padStart(3, '0')}`;
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
          paymentDays: c.paymentDays ?? null,
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
      const parsed = updateClientImportRowSchema.safeParse(dropBlankCells(raw));
      if (!parsed.success) {
        skip(zodRowReason(parsed.error, CLIENT_IMPORT_LABELS));
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
            ? `Customer ${codeIn} is in Trash — restore it first`
            : `No customer with Code "${codeIn}"`,
        );
        continue;
      }
      if (patch.name !== undefined) {
        const owner = nameOwner.get(patch.name.trim().toLowerCase());
        if (owner && owner !== key) {
          skip(
            `another Customer is already named "${patch.name.trim()}"`,
            before.code,
            before.name,
          );
          continue;
        }
      }
      const gst = clientGstUpdate(before, patch);
      if (settings.masterRulesMode === 'enforce' && gst.issues.length > 0) {
        skip(issueTexts(gst.issues).join(' '), before.code, before.name);
        continue;
      }
      const set = { ...clientPlainUpdates(patch), ...gst.updates };
      const changes = diffFields(before, set, CLIENT_FIELDS);
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
        await tx.insert(clients).values(inserts.slice(i, i + CHUNK));
      }
      if (inserts.length > 0) {
        // One line for the whole insert, as the Item Master import does.
        await emitActivityLog(
          tx,
          {
            action: ActivityAction.Create,
            entity: 'Client',
            detail: `Excel import — ${inserts.length} customer(s): ${codes[0]}…${codes[codes.length - 1]}`,
          },
          companyId,
          user,
        );
      }
      // Update Existing: one History row per customer, Before → After (ADR-197).
      for (const u of updates) {
        await tx
          .update(clients)
          .set({ ...u.set, updatedBy: user.id })
          .where(eq(clients.id, u.before.id));
        await emitActivityLog(
          tx,
          {
            action: ActivityAction.Edit,
            entity: 'Client',
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

    const skipped: BulkClientSkip[] = rows
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

export async function updateClient(
  id: string,
  input: UpdateClientInput,
  user: AuthContext,
): Promise<ClientSaveResponse> {
  requireWriteRole(user);
  await requireFormAccess(user, 'client_create', 'edit');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // The whole row, read BEFORE the update — the "before" of Before → After.
    const existing = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .limit(1);
    const before = existing[0];
    if (!before) throw new NotFoundError('Customer not found. It may have been moved to Trash.');
    if (input.name !== undefined) await assertClientNameFree(tx, companyId, input.name, id);

    const settings = await loadMasterRuleSettings(tx, companyId);
    const gst = clientGstUpdate(before, input);
    const warnings = applyMasterRules(
      gst.issues,
      settings.masterRulesMode,
      `Customer ${before.code}`,
    );

    const updates: Record<string, unknown> = {
      updatedBy: user.id,
      ...clientPlainUpdates(input),
      ...gst.updates,
    };

    const changes = diffFields(before, updates, CLIENT_FIELDS);
    const updated = await tx.update(clients).set(updates).where(eq(clients.id, id)).returning();
    const row = updated[0] as unknown as Client;
    if (changes.length > 0) {
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Edit,
          entity: 'Client',
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

export async function softDeleteClient(
  id: string,
  reason: string,
  user: AuthContext,
): Promise<{ ok: true }> {
  requireWriteRole(user);
  await requireFormAccess(user, 'client_create', 'edit');
  await requireFormAccess(user, 'client_create', 'approve');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // The whole row, read BEFORE the update — the "before" of Before → After.
    const existing = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .limit(1);
    const before = existing[0];
    if (!before) throw new NotFoundError('Customer not found. It may have been moved to Trash.');
    await tx
      .update(clients)
      .set({ ...softDeleteStamp(user), updatedBy: user.id })
      .where(eq(clients.id, id));
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Delete,
        entity: 'Client',
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
