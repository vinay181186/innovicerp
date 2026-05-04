// NC Register service (T-040a).
//
// Read + create + light-update + softDelete only. Disposition workflow with
// cascades into jc_ops.reworkQty / op_log / supplementary JC creation lands
// in T-040b (per ADR-017 #7) — those write paths are deliberately NOT in this
// service. Update is restricted to date / reason / reportedBy fields; status
// stays 'pending' until T-040b's dispose action flips it. SoftDelete blocks
// once status leaves 'pending' — disposed/closed NCs are permanent records.

import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { items, jcOps, jobCards, ncRegister, users } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireOpEntryRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import {
  closeNcReworkCascade,
  type DisposeNcContext,
  type DisposeNcResult,
  disposeNcCascade,
} from './cascades';
import type {
  CloseNcReworkInput,
  CreateNcRegisterInput,
  DisposeNcInput,
  ListNcRegisterQuery,
  ListNcRegisterResponse,
  NcRegister,
  NcRegisterListItem,
  UpdateNcRegisterInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

// ─── FK validation helpers ────────────────────────────────────────────────

async function assertJobCardExists(
  tx: DbTransaction,
  jobCardId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: jobCards.id })
    .from(jobCards)
    .where(
      and(
        eq(jobCards.id, jobCardId),
        eq(jobCards.companyId, companyId),
        isNull(jobCards.deletedAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`Job card ${jobCardId} not found in this company`);
  }
}

async function assertJcOpExists(
  tx: DbTransaction,
  jcOpId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: jcOps.id })
    .from(jcOps)
    .where(and(eq(jcOps.id, jcOpId), eq(jcOps.companyId, companyId), isNull(jcOps.deletedAt)))
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`JC op ${jcOpId} not found in this company`);
  }
}

async function assertItemExists(
  tx: DbTransaction,
  itemId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.companyId, companyId), isNull(items.deletedAt)))
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`Item ${itemId} not found in this company`);
  }
}

async function getItemCode(
  tx: DbTransaction,
  itemId: string,
  companyId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ code: items.code })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.companyId, companyId), isNull(items.deletedAt)))
    .limit(1);
  return rows[0]?.code ?? null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function dateLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function tsLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function maybeTsLike(v: unknown): string | null {
  if (v == null) return null;
  return tsLike(v);
}

function maybeDateLike(v: unknown): string | null {
  if (v == null) return null;
  return dateLike(v);
}

function toNcRegister(row: typeof ncRegister.$inferSelect): NcRegister {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    ncDate: row.ncDate,
    jobCardId: row.jobCardId,
    jcOpId: row.jcOpId,
    opSeq: row.opSeq,
    operationText: row.operationText,
    qcOperationText: row.qcOperationText,
    itemId: row.itemId,
    itemCodeText: row.itemCodeText,
    itemNameText: row.itemNameText,
    soCodeText: row.soCodeText,
    machineCodeText: row.machineCodeText,
    rejectedQty: row.rejectedQty,
    reasonCategory: row.reasonCategory,
    reason: row.reason,
    disposition: row.disposition,
    dispositionDate: row.dispositionDate,
    dispositionByText: row.dispositionByText,
    dispositionRemarks: row.dispositionRemarks,
    reworkJcCodeText: row.reworkJcCodeText,
    reworkOpSeq: row.reworkOpSeq,
    reworkDoneQty: row.reworkDoneQty,
    scrapCost: row.scrapCost,
    status: row.status,
    reportedByText: row.reportedByText,
    timeLogged: maybeTsLike(row.timeLogged),
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: maybeTsLike(row.deletedAt),
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listNcRegister(
  input: ListNcRegisterQuery,
  user: AuthContext,
): Promise<ListNcRegisterResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (nc.code ILIKE ${term} OR nc.reason ILIKE ${term} OR nc.item_name_text ILIKE ${term} OR nc.item_code_text ILIKE ${term})`
      : sql``;
    const statusFrag = input.status ? sql`AND nc.status = ${input.status}::nc_status` : sql``;
    const reasonFrag = input.reasonCategory
      ? sql`AND nc.reason_category = ${input.reasonCategory}::nc_reason_category`
      : sql``;
    const jcFrag = input.jobCardId ? sql`AND nc.job_card_id = ${input.jobCardId}::uuid` : sql``;
    const fromFrag = input.fromDate ? sql`AND nc.nc_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND nc.nc_date <= ${input.toDate}::date` : sql``;

    const result = await tx.execute(sql`
      SELECT
        nc.id, nc.company_id AS "companyId", nc.code,
        nc.nc_date AS "ncDate",
        nc.job_card_id AS "jobCardId", nc.jc_op_id AS "jcOpId", nc.op_seq AS "opSeq",
        nc.operation_text AS "operationText", nc.qc_operation_text AS "qcOperationText",
        nc.item_id AS "itemId", nc.item_code_text AS "itemCodeText",
        nc.item_name_text AS "itemNameText",
        nc.so_code_text AS "soCodeText", nc.machine_code_text AS "machineCodeText",
        nc.rejected_qty::text AS "rejectedQty",
        nc.reason_category AS "reasonCategory", nc.reason,
        nc.disposition,
        nc.disposition_date AS "dispositionDate",
        nc.disposition_by_text AS "dispositionByText",
        nc.disposition_remarks AS "dispositionRemarks",
        nc.rework_jc_code_text AS "reworkJcCodeText",
        nc.rework_op_seq AS "reworkOpSeq",
        nc.rework_done_qty::text AS "reworkDoneQty",
        nc.scrap_cost::text AS "scrapCost",
        nc.status,
        nc.reported_by_text AS "reportedByText",
        nc.time_logged AS "timeLogged",
        nc.created_at AS "createdAt", nc.created_by AS "createdBy",
        nc.updated_at AS "updatedAt", nc.updated_by AS "updatedBy",
        nc.deleted_at AS "deletedAt",
        jc.code AS "jcCode",
        jo.op_seq AS "jcOpSeqResolved",
        jo.operation AS "jcOpOperation",
        i.code AS "itemCode",
        i.name AS "itemName"
      FROM public.nc_register nc
      LEFT JOIN public.job_cards jc
        ON jc.id = nc.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.jc_ops jo
        ON jo.id = nc.jc_op_id AND jo.deleted_at IS NULL
      LEFT JOIN public.items i
        ON i.id = nc.item_id AND i.deleted_at IS NULL
      WHERE nc.company_id = ${companyId}::uuid
        AND nc.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${reasonFrag}
        ${jcFrag}
        ${fromFrag}
        ${toFrag}
      ORDER BY nc.nc_date DESC, nc.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [eq(ncRegister.companyId, companyId), isNull(ncRegister.deletedAt)];
    if (input.status) conditions.push(eq(ncRegister.status, input.status));
    if (input.reasonCategory) conditions.push(eq(ncRegister.reasonCategory, input.reasonCategory));
    if (input.jobCardId) conditions.push(eq(ncRegister.jobCardId, input.jobCardId));
    const totalRows = await tx
      .select({ value: count() })
      .from(ncRegister)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    const rowsList = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items: rowsList, total, limit: input.limit, offset: input.offset };
  });
}

function toListItem(r: Record<string, unknown>): NcRegisterListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    ncDate: dateLike(r['ncDate']),
    jobCardId: r['jobCardId'] as string,
    jcOpId: (r['jcOpId'] as string | null) ?? null,
    opSeq: r['opSeq'] != null ? Number(r['opSeq']) : null,
    operationText: (r['operationText'] as string | null) ?? null,
    qcOperationText: (r['qcOperationText'] as string | null) ?? null,
    itemId: r['itemId'] as string,
    itemCodeText: r['itemCodeText'] as string,
    itemNameText: (r['itemNameText'] as string | null) ?? null,
    soCodeText: (r['soCodeText'] as string | null) ?? null,
    machineCodeText: (r['machineCodeText'] as string | null) ?? null,
    rejectedQty: r['rejectedQty'] as string,
    reasonCategory: r['reasonCategory'] as NcRegister['reasonCategory'],
    reason: (r['reason'] as string | null) ?? null,
    disposition: (r['disposition'] as NcRegister['disposition']) ?? null,
    dispositionDate: maybeDateLike(r['dispositionDate']),
    dispositionByText: (r['dispositionByText'] as string | null) ?? null,
    dispositionRemarks: (r['dispositionRemarks'] as string | null) ?? null,
    reworkJcCodeText: (r['reworkJcCodeText'] as string | null) ?? null,
    reworkOpSeq: r['reworkOpSeq'] != null ? Number(r['reworkOpSeq']) : null,
    reworkDoneQty: (r['reworkDoneQty'] as string | null) ?? null,
    scrapCost: r['scrapCost'] as string,
    status: r['status'] as NcRegister['status'],
    reportedByText: (r['reportedByText'] as string | null) ?? null,
    timeLogged: maybeTsLike(r['timeLogged']),
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: maybeTsLike(r['deletedAt']),
    jcCode: (r['jcCode'] as string | null) ?? null,
    jcOpSeqResolved: r['jcOpSeqResolved'] != null ? Number(r['jcOpSeqResolved']) : null,
    jcOpOperation: (r['jcOpOperation'] as string | null) ?? null,
    itemCode: (r['itemCode'] as string | null) ?? null,
    itemName: (r['itemName'] as string | null) ?? null,
  };
}

export async function getNcRegister(id: string, user: AuthContext): Promise<NcRegister> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.id, id),
          eq(ncRegister.companyId, companyId),
          isNull(ncRegister.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError(`NC ${id} not found`);
    return toNcRegister(row);
  });
}

// ─── Writes ───────────────────────────────────────────────────────────────

export async function createNcRegister(
  input: CreateNcRegisterInput,
  user: AuthContext,
): Promise<NcRegister> {
  requireOpEntryRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const dup = await tx
      .select({ id: ncRegister.id })
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.companyId, companyId),
          eq(ncRegister.code, input.code),
          isNull(ncRegister.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(`NC code "${input.code}" already exists`);
    }

    await assertJobCardExists(tx, input.jobCardId, companyId);
    await assertItemExists(tx, input.itemId, companyId);
    if (input.jcOpId) await assertJcOpExists(tx, input.jcOpId, companyId);

    // Snapshot itemCodeText from the items row so the durable text matches the
    // master at creation time. Same pattern as legacy auto-NC capture.
    const itemCode = await getItemCode(tx, input.itemId, companyId);

    const inserted = await tx
      .insert(ncRegister)
      .values({
        companyId,
        code: input.code,
        ncDate: input.ncDate,
        jobCardId: input.jobCardId,
        jcOpId: input.jcOpId ?? null,
        opSeq: input.opSeq ?? null,
        operationText: input.operationText ?? null,
        qcOperationText: input.qcOperationText ?? null,
        itemId: input.itemId,
        itemCodeText: itemCode ?? '',
        itemNameText: input.itemNameText ?? null,
        soCodeText: input.soCodeText ?? null,
        machineCodeText: input.machineCodeText ?? null,
        rejectedQty: input.rejectedQty.toFixed(2),
        reasonCategory: input.reasonCategory,
        reason: input.reason ?? null,
        // Disposition fields stay null until T-040b's dispose action.
        status: 'pending',
        reportedByText: input.reportedByText ?? null,
        timeLogged: new Date(),
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    return toNcRegister(inserted[0]!);
  });
}

export async function updateNcRegister(
  id: string,
  input: UpdateNcRegisterInput,
  user: AuthContext,
): Promise<NcRegister> {
  requireOpEntryRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: ncRegister.id, status: ncRegister.status })
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.id, id),
          eq(ncRegister.companyId, companyId),
          isNull(ncRegister.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      throw new NotFoundError(`NC ${id} not found`);
    }
    if (existing[0]!.status !== 'pending') {
      throw new ConflictError(
        `NC ${id} is ${existing[0]!.status} — only pending NCs can be edited (use disposition workflow for closed NCs)`,
      );
    }

    const updates: Record<string, unknown> = { updatedBy: user.id };
    if (input.ncDate !== undefined) updates['ncDate'] = input.ncDate;
    if (input.reasonCategory !== undefined) updates['reasonCategory'] = input.reasonCategory;
    if (input.reason !== undefined) updates['reason'] = input.reason ?? null;
    if (input.reportedByText !== undefined)
      updates['reportedByText'] = input.reportedByText ?? null;

    await tx.update(ncRegister).set(updates).where(eq(ncRegister.id, id));

    const reread = await tx.select().from(ncRegister).where(eq(ncRegister.id, id)).limit(1);
    return toNcRegister(reread[0]!);
  });
}

// ─── T-040b: dispose + close-rework actions ──────────────────────────────

async function resolveUserName(tx: DbTransaction, userId: string): Promise<string> {
  const rows = await tx
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  // users table has email but no name field — use email's local part as the
  // user-facing name (matches the existing seed admin pattern).
  const email = rows[0]?.email ?? '';
  const localPart = email.split('@')[0];
  return localPart && localPart.length > 0 ? localPart : email;
}

export async function disposeNcRegister(
  id: string,
  input: DisposeNcInput,
  user: AuthContext,
): Promise<{ result: DisposeNcResult; nc: NcRegister }> {
  requireOpEntryRole(user);
  const companyId = (() => {
    if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
    return user.companyId;
  })();

  return withUserContext(user, async (tx) => {
    const userName = await resolveUserName(tx, user.id);
    const ctx: DisposeNcContext = { companyId, userId: user.id, userName };
    const result = await disposeNcCascade(tx, id, input, ctx);
    const nc = await tx.select().from(ncRegister).where(eq(ncRegister.id, id)).limit(1);
    return { result, nc: toNcRegister(nc[0]!) };
  });
}

export async function closeNcRework(
  id: string,
  input: CloseNcReworkInput,
  user: AuthContext,
): Promise<NcRegister> {
  requireOpEntryRole(user);
  const companyId = (() => {
    if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
    return user.companyId;
  })();

  return withUserContext(user, async (tx) => {
    const userName = await resolveUserName(tx, user.id);
    const ctx: DisposeNcContext = { companyId, userId: user.id, userName };
    await closeNcReworkCascade(tx, id, input.reworkDoneQty, ctx);
    const nc = await tx.select().from(ncRegister).where(eq(ncRegister.id, id)).limit(1);
    return toNcRegister(nc[0]!);
  });
}

export async function softDeleteNcRegister(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireOpEntryRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: ncRegister.id, status: ncRegister.status })
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.id, id),
          eq(ncRegister.companyId, companyId),
          isNull(ncRegister.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      throw new NotFoundError(`NC ${id} not found`);
    }
    if (existing[0]!.status !== 'pending') {
      throw new ConflictError(
        `NC ${id} is ${existing[0]!.status} — disposed/closed NCs are permanent records and cannot be deleted`,
      );
    }
    await tx
      .update(ncRegister)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(ncRegister.id, id));
    return { ok: true };
  });
}
