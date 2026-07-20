// NC Register service (T-040a).
//
// Read + create + light-update + softDelete only. Disposition workflow with
// cascades into jc_ops.reworkQty / op_log / supplementary JC creation lands
// in T-040b (per ADR-017 #7) — those write paths are deliberately NOT in this
// service. Update is restricted to date / reason / reportedBy fields; status
// stays 'pending' until T-040b's dispose action flips it. SoftDelete blocks
// once status leaves 'pending' — disposed/closed NCs are permanent records.

import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { DocumentTraceability, RelatedDoc } from '@innovic/shared';
import { capaRecords, items, jcOps, jobCards, ncRegister, users } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireOpEntryRole } from '../../lib/auth';
import { buildTimeline, section, toIsoDate } from '../../lib/traceability';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
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
  NcRegisterSummary,
  UpdateNcRegisterInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function ncDetail(
  code: string,
  itemCodeText: string | null | undefined,
  rejectedQty: string,
): string {
  const item = itemCodeText && itemCodeText.length > 0 ? itemCodeText : '—';
  return `${code} — ${item} qty=${rejectedQty}`;
}

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

function toNcRegister(
  row: typeof ncRegister.$inferSelect,
  linkedCapaCode: string | null = null,
  itemCode: string | null = null,
  itemName: string | null = null,
): NcRegister {
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
    // Live values resolved from the items master (LEFT JOIN in getNcRegister).
    itemCode,
    itemName,
    soCodeText: row.soCodeText,
    machineCodeText: row.machineCodeText,
    operatorText: row.operatorText,
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
    linkedCapaCode,
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: maybeTsLike(row.deletedAt),
  };
}

// Look up the CAPA code whose ncRefs jsonb array contains this NC code.
// Mirrors legacy `_capaForNC` (HTML L22758). nc_refs is jsonb (a JSON array),
// so use the @> containment operator with a jsonb array literal.
async function lookupLinkedCapaCode(
  tx: DbTransaction,
  companyId: string,
  ncCode: string,
): Promise<string | null> {
  const rows = await tx.execute(sql`
    SELECT code
    FROM public.capa_records
    WHERE company_id = ${companyId}::uuid
      AND deleted_at IS NULL
      AND nc_refs @> ${JSON.stringify([ncCode])}::jsonb
    ORDER BY created_at ASC
    LIMIT 1
  `);
  const list = rows as unknown as Array<{ code: string }>;
  return list[0]?.code ?? null;
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
        nc.operator_text AS "operatorText",
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
        i.name AS "itemName",
        cap.code AS "linkedCapaCode"
      FROM public.nc_register nc
      LEFT JOIN public.job_cards jc
        ON jc.id = nc.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.jc_ops jo
        ON jo.id = nc.jc_op_id AND jo.deleted_at IS NULL
      LEFT JOIN public.items i
        ON i.id = nc.item_id AND i.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT c.code
        FROM public.capa_records c
        WHERE c.company_id = nc.company_id
          AND c.deleted_at IS NULL
          AND c.nc_refs @> to_jsonb(ARRAY[nc.code])
        ORDER BY c.created_at ASC
        LIMIT 1
      ) cap ON TRUE
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
    operatorText: (r['operatorText'] as string | null) ?? null,
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
    linkedCapaCode: (r['linkedCapaCode'] as string | null) ?? null,
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
      .select({
        nc: ncRegister,
        itemCode: items.code,
        itemName: items.name,
      })
      .from(ncRegister)
      // Resolve item code/name from the live items master, not the stale
      // *Text snapshot columns. Mirrors the LIST reader's join (and GRN detail).
      .leftJoin(items, and(eq(items.id, ncRegister.itemId), isNull(items.deletedAt)))
      .where(
        and(
          eq(ncRegister.id, id),
          eq(ncRegister.companyId, companyId),
          isNull(ncRegister.deletedAt),
        ),
      )
      .limit(1);
    const found = rows[0];
    if (!found) throw new NotFoundError(`NC ${id} not found`);
    const row = found.nc;
    const linkedCapaCode = await lookupLinkedCapaCode(tx, companyId, row.code);
    return toNcRegister(row, linkedCapaCode, found.itemCode, found.itemName);
  });
}

// ─── Related documents (read-only traceability) ────────────────────────────
//
// GET /nc-register/:id/related. Mirrors getSalesOrderRelated: one
// withUserContext transaction, an existence check, then company-scoped +
// soft-delete-filtered subqueries shaped into a DocumentTraceability. Never
// writes.
//
// Upstream (what this NC was raised FROM):
//   - nc_register.job_card_id → job_cards (the JC on the shop floor)
//   - nc_register.item_id     → items [MASTER]
// Downstream (generated from disposition):
//   - job_cards.parent_nc_id = :id  (supplementary / rework JCs)
// Related (soft link — NOT an FK):
//   - capa_records whose nc_refs jsonb array contains this NC's code
export async function getNcRegisterRelated(
  id: string,
  user: AuthContext,
): Promise<DocumentTraceability> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const headers = await tx
      .select({
        id: ncRegister.id,
        code: ncRegister.code,
        ncDate: ncRegister.ncDate,
        status: ncRegister.status,
        jobCardId: ncRegister.jobCardId,
        jcOpId: ncRegister.jcOpId,
        opSeq: ncRegister.opSeq,
        itemId: ncRegister.itemId,
      })
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.id, id),
          eq(ncRegister.companyId, companyId),
          isNull(ncRegister.deletedAt),
        ),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError(`NC ${id} not found`);

    // ── Upstream: the source Job Card ───────────────────────────────────────
    const jcRows = header.jobCardId
      ? await tx
          .select({
            id: jobCards.id,
            code: jobCards.code,
            date: jobCards.jcDate,
            closedAt: jobCards.closedAt,
          })
          .from(jobCards)
          .where(
            and(
              eq(jobCards.id, header.jobCardId),
              eq(jobCards.companyId, companyId),
              isNull(jobCards.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const jc = jcRows[0] ?? null;

    // ── Upstream: the source Item (master) ──────────────────────────────────
    const itemRows = header.itemId
      ? await tx
          .select({ id: items.id, code: items.code, name: items.name })
          .from(items)
          .where(
            and(
              eq(items.id, header.itemId),
              eq(items.companyId, companyId),
              isNull(items.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const item = itemRows[0] ?? null;

    // ── Downstream: rework / supplementary Job Cards created from this NC ────
    const reworkRows = await tx
      .select({
        id: jobCards.id,
        code: jobCards.code,
        date: jobCards.jcDate,
        closedAt: jobCards.closedAt,
      })
      .from(jobCards)
      .where(
        and(
          eq(jobCards.companyId, companyId),
          isNull(jobCards.deletedAt),
          eq(jobCards.parentNcId, id),
        ),
      )
      .orderBy(desc(jobCards.jcDate));

    // ── Related: CAPA records referencing this NC's code ────────────────────
    // Soft link only — capa_records.nc_refs is a jsonb text-array, not an FK.
    // Same @> containment pattern as lookupLinkedCapaCode above. CAPA has no
    // detail route → routeKind null (reference-only rows).
    const capaRows = await tx
      .select({
        id: capaRecords.id,
        code: capaRecords.code,
        status: capaRecords.status,
        date: capaRecords.capaDate,
      })
      .from(capaRecords)
      .where(
        and(
          eq(capaRecords.companyId, companyId),
          isNull(capaRecords.deletedAt),
          sql`${capaRecords.ncRefs} @> ${JSON.stringify([header.code])}::jsonb`,
        ),
      )
      .orderBy(asc(capaRecords.code));

    const row = (
      id_: string,
      code: string,
      status: string | null,
      date: unknown,
      extra?: { linkId?: string; label?: string },
    ): RelatedDoc => ({
      id: id_,
      code,
      status,
      date: toIsoDate(date),
      linkId: extra?.linkId ?? null,
      label: extra?.label ?? null,
    });

    // ── Upstream sections ───────────────────────────────────────────────────
    const jobCardSection = section(
      'job-card',
      'Job Card',
      '📋',
      'job-card',
      // Plain header FK → link by the JC's own id (linkId null). job_cards has
      // no status column; derive closed/open from closed_at. If the NC pins a
      // specific op, surface its seq as the row label.
      jc
        ? [
            row(jc.id, jc.code, jc.closedAt ? 'closed' : 'open', jc.date, {
              ...(header.jcOpId && header.opSeq != null ? { label: `Op${header.opSeq}` } : {}),
            }),
          ]
        : [],
    );
    const itemSection = section(
      'item',
      'Item',
      '📦',
      'item',
      item ? [row(item.id, item.code, null, null, { label: item.name })] : [],
    );

    // ── Downstream sections ─────────────────────────────────────────────────
    const reworkSection = section(
      'rework-jc',
      'Rework Job Cards',
      '📋',
      'job-card',
      reworkRows.map((r) => row(r.id, r.code, r.closedAt ? 'closed' : 'open', r.date)),
    );

    // ── Related sections (lateral soft links) ───────────────────────────────
    const capaSection = section(
      'capa',
      'CAPA (referenced)',
      '🛡',
      null,
      capaRows.map((r) => row(r.id, r.code, r.status, r.date)),
    );

    const upstream = [jobCardSection, itemSection];
    const downstream = [reworkSection];
    const related = [capaSection];
    return {
      self: { module: 'nc-register', code: header.code },
      upstream,
      downstream,
      related,
      timeline: buildTimeline(
        {
          ts: toIsoDate(header.ncDate),
          label: 'NC raised',
          code: header.code,
          routeKind: 'nc',
          linkId: id,
        },
        [...upstream, ...downstream],
      ),
    };
  });
}

// ─── Summary (company-wide stat cards — legacy HTML L22508-22519) ───────────

export async function getNcRegisterSummary(user: AuthContext): Promise<NcRegisterSummary> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const result = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE status = 'pending')::int AS "pending",
        COALESCE(SUM(rejected_qty), 0)::float8 AS "totalQty",
        COALESCE(SUM(rejected_qty) FILTER (WHERE disposition = 'rework'), 0)::float8 AS "reworkQty",
        COALESCE(SUM(rejected_qty) FILTER (WHERE disposition = 'scrap'), 0)::float8 AS "scrapQty"
      FROM public.nc_register
      WHERE company_id = ${companyId}::uuid
        AND deleted_at IS NULL
    `);
    const row = (result as unknown as Array<Record<string, unknown>>)[0] ?? {};
    return {
      total: Number(row['total'] ?? 0),
      pending: Number(row['pending'] ?? 0),
      totalQty: Number(row['totalQty'] ?? 0),
      reworkQty: Number(row['reworkQty'] ?? 0),
      scrapQty: Number(row['scrapQty'] ?? 0),
    };
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
        operatorText: input.operatorText ?? null,
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
    const row = inserted[0]!;
    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'NonConformance',
        detail: ncDetail(row.code, row.itemCodeText, row.rejectedQty),
        refId: row.code,
      },
      companyId,
      user,
    );
    return toNcRegister(row);
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
    if (input.operatorText !== undefined) updates['operatorText'] = input.operatorText ?? null;

    await tx.update(ncRegister).set(updates).where(eq(ncRegister.id, id));

    const reread = await tx.select().from(ncRegister).where(eq(ncRegister.id, id)).limit(1);
    const row = reread[0]!;
    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'NonConformance',
        detail: ncDetail(row.code, row.itemCodeText, row.rejectedQty),
        refId: row.code,
      },
      companyId,
      user,
    );
    return toNcRegister(row);
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
    const row = nc[0]!;
    // Detail captures the disposition action + key result side-effect
    // (supplementary JC code on make_fresh, scrap cost on scrap, etc.).
    const sideEffect =
      input.action === 'make_fresh' && result.newJcCode
        ? `; supplementary JC ${result.newJcCode}`
        : input.action === 'scrap' && input.scrapCost !== undefined
          ? `; scrapCost=${input.scrapCost}`
          : '';
    await emitActivityLog(
      tx,
      {
        action: 'NC_DISPOSE',
        entity: 'NonConformance',
        detail: `${row.code} — ${input.action.toUpperCase()} qty=${row.rejectedQty}${sideEffect}`,
        refId: row.code,
      },
      companyId,
      user,
    );
    // make_fresh creates a supplementary JC inside the cascade — emit a
    // JobCard CREATE row so the new JC's audit history starts at this
    // moment instead of empty. NC_DISPOSE detail already mentions the
    // supplementary code; this gives the new JC a row keyed by its own
    // code so the JC filter shows the creation event.
    if (input.action === 'make_fresh' && result.newJcCode) {
      await emitActivityLog(
        tx,
        {
          action: 'CREATE',
          entity: 'JobCard',
          detail: `${result.newJcCode} — Supplementary for ${row.code} (${row.rejectedQty} pcs)`,
          refId: result.newJcCode,
        },
        companyId,
        user,
      );
    }
    return { result, nc: toNcRegister(row) };
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
    const row = nc[0]!;
    await emitActivityLog(
      tx,
      {
        action: 'NC_CLOSE_REWORK',
        entity: 'NonConformance',
        detail: `${row.code} — REWORK CLOSED${input.reworkDoneQty !== undefined ? ` qty=${input.reworkDoneQty}` : ''}`,
        refId: row.code,
      },
      companyId,
      user,
    );
    return toNcRegister(row);
  });
}

export async function softDeleteNcRegister(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireOpEntryRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({
        id: ncRegister.id,
        code: ncRegister.code,
        itemCodeText: ncRegister.itemCodeText,
        rejectedQty: ncRegister.rejectedQty,
        status: ncRegister.status,
      })
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.id, id),
          eq(ncRegister.companyId, companyId),
          isNull(ncRegister.deletedAt),
        ),
      )
      .limit(1);
    const row = existing[0];
    if (!row) {
      throw new NotFoundError(`NC ${id} not found`);
    }
    if (row.status !== 'pending') {
      throw new ConflictError(
        `NC ${id} is ${row.status} — disposed/closed NCs are permanent records and cannot be deleted`,
      );
    }
    await tx
      .update(ncRegister)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(ncRegister.id, id));
    await emitActivityLog(
      tx,
      {
        action: 'DELETE',
        entity: 'NonConformance',
        detail: ncDetail(row.code, row.itemCodeText, row.rejectedQty),
        refId: row.code,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}
