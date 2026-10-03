// Party Material GRN service (Store slice 2; reworked by ADR-203).
//
// Records client-supplied raw material received against a JWSO. Multi-line per
// receipt. ADR-203 split the receipt into two steps:
//   1. create (this file) — the gate-in: which JWSO line, how many pieces came.
//      NOTHING enters the customer-material register here; every line waits for
//      Incoming QC with accepted = rejected = 0 and qc_at NULL.
//   2. QC (./qc.ts) — books accepted / rejected per line; only the accepted qty
//      is posted to the register (lib/party-stock-ledger, the one writer).
// The customer material of a line is the JWSO line's own `<item>-RM` party
// material (lib/jw-rm) — it is never picked separately, so it cannot mismatch.

import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreatePartyGrnInput,
  DocumentEditStagedResult,
  ListPartyGrnQuery,
  ListPartyGrnResponse,
  PartyGrn,
  PartyGrnDetail,
  PartyGrnLine,
  PartyGrnListItem,
} from '@innovic/shared';
import { clients, jobWorkOrders, partyGrn, partyGrnLines, partyMaterials } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess, requireFormAccess } from '../../lib/access';
import { ActivityAction } from '@innovic/shared';
import { type DiffField, diffFields, softDeleteStamp } from '../../lib/audit-trail';
import type { UpdatePartyGrnInput } from './schema';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { lockDocSeries } from '../../lib/doc-series-lock';
import { assertJwLineOpenForWork, type LockedJwLine, lockJwLine } from '../../lib/jw-line-state';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { postPartyStockMove } from '../../lib/party-stock-ledger';
import { emitActivityLog } from '../activity-log/service';
import { PARTY_GRN_SF_COLUMNS } from './sf-columns';

export function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

/** ADR-203 read gate: the Party GRN screens are read by Party (customer
 *  material) staff and by Incoming QC, who books the QC step on them. */
export async function requirePartyGrnRead(user: AuthContext): Promise<void> {
  await requireAnyFormAccess(user, [
    ['party_create', 'view'],
    ['qc_incoming', 'view'],
  ]);
}

/** A line still waiting for Incoming QC. Lines booked before QC existed
 *  (grandfathered by migration 0173: accepted = received, qc_at NULL) are NOT
 *  pending — their accepted qty is already in the register. */
export const PENDING_QC_SQL = sql.raw(
  '(pgl.qc_at IS NULL AND pgl.accepted_qty = 0 AND pgl.rejected_qty = 0)',
);

export function isPendingQc(l: {
  qcAt: unknown;
  acceptedQty: number;
  rejectedQty: number;
}): boolean {
  return l.qcAt == null && l.acceptedQty === 0 && l.rejectedQty === 0;
}

function dateLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function tsLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

const CODE_PREFIX = 'PGRN-';
const CODE_PAD = 5;

async function nextPartyGrnCode(tx: DbTransaction, companyId: string): Promise<string> {
  // S2: queue behind any other save numbering this series (lib/doc-series-lock).
  await lockDocSeries(tx, companyId, 'party_grn');
  const rows = (await tx.execute(sql`
    SELECT COALESCE(
      MAX(NULLIF(regexp_replace(code, '^${sql.raw(CODE_PREFIX)}', ''), '')::int),
      0
    ) + 1 AS next_num
    FROM public.party_grn
    WHERE company_id = ${companyId}::uuid
      AND code LIKE ${`${CODE_PREFIX}%`}
      AND code ~ ${`^${CODE_PREFIX}\\d+$`}
  `)) as unknown as Array<{ next_num: number }>;
  const next = Number(rows[0]?.next_num ?? 1);
  return `${CODE_PREFIX}${String(next).padStart(CODE_PAD, '0')}`;
}

export async function getNextPartyGrnCode(user: AuthContext): Promise<{ code: string }> {
  await requirePartyGrnRead(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const code = await nextPartyGrnCode(tx, companyId);
    return { code };
  });
}

/** Per-GRN line roll-up, shared by the list rows and the summary. */
const LINE_AGG_SQL = sql`
  LEFT JOIN LATERAL (
    SELECT SUM(pgl.received_qty)::int AS total_received,
           SUM(pgl.accepted_qty)::int AS total_accepted,
           COUNT(*) FILTER (WHERE ${PENDING_QC_SQL})::int AS qc_pending_lines,
           COUNT(*)::int AS lines_count
    FROM public.party_grn_lines pgl
    WHERE pgl.party_grn_id = pg.id AND pgl.deleted_at IS NULL
  ) agg ON true`;

export async function listPartyGrn(
  input: ListPartyGrnQuery,
  user: AuthContext,
): Promise<ListPartyGrnResponse> {
  await requirePartyGrnRead(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (
          pg.code ILIKE ${term}
          OR pg.jw_code_text ILIKE ${term}
          OR pg.client_code_text ILIKE ${term}
          OR pg.client_po_no ILIKE ${term}
          OR c.name ILIKE ${term}
          OR EXISTS (
            SELECT 1 FROM public.party_grn_lines pgl
            WHERE pgl.party_grn_id = pg.id
              AND pgl.deleted_at IS NULL
              AND (pgl.party_material_code_text ILIKE ${term}
                   OR pgl.party_material_name ILIKE ${term})
          )
        )`
      : sql``;
    const jwFrag = input.jobWorkOrderId
      ? sql`AND pg.job_work_order_id = ${input.jobWorkOrderId}::uuid`
      : sql``;
    const clientFrag = input.clientId ? sql`AND pg.client_id = ${input.clientId}::uuid` : sql``;
    const fromFrag = input.fromDate ? sql`AND pg.grn_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND pg.grn_date <= ${input.toDate}::date` : sql``;
    // Sort & Filter (ADR-200): the screen's column filters + sort, through the
    // list's own field whitelist (sf-columns.ts). Applied to the rows AND the
    // total/summary query.
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(PARTY_GRN_SF_COLUMNS, sf);
    const orderBy = sfOrderBy(PARTY_GRN_SF_COLUMNS, sf, sql`pg.grn_date DESC, pg.code DESC`);

    const result = await tx.execute(sql`
      SELECT
        pg.id, pg.company_id AS "companyId", pg.code,
        pg.grn_date AS "grnDate",
        pg.job_work_order_id AS "jobWorkOrderId",
        pg.jw_code_text AS "jwCodeText",
        pg.client_id AS "clientId",
        pg.client_code_text AS "clientCodeText",
        pg.client_po_no AS "clientPoNo",
        pg.dc_no AS "dcNo",
        pg.remarks,
        pg.received_by_text AS "receivedByText",
        pg.created_at AS "createdAt", pg.created_by AS "createdBy",
        pg.updated_at AS "updatedAt", pg.updated_by AS "updatedBy",
        pg.deleted_at AS "deletedAt",
        c.name AS "clientName",
        COALESCE(agg.total_received, 0)::int AS "totalReceivedQty",
        COALESCE(agg.total_accepted, 0)::int AS "totalAcceptedQty",
        COALESCE(agg.qc_pending_lines, 0)::int AS "qcPendingLines",
        COALESCE(agg.lines_count, 0)::int AS "linesCount"
      FROM public.party_grn pg
      LEFT JOIN public.clients c ON c.id = pg.client_id AND c.deleted_at IS NULL
      ${LINE_AGG_SQL}
      WHERE pg.company_id = ${companyId}::uuid
        AND pg.deleted_at IS NULL
        ${searchFrag}
        ${jwFrag}
        ${clientFrag}
        ${fromFrag}
        ${toFrag}
        ${sfFrag}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    // Total + summary follow the same filters as the rows (search box included),
    // so the count beside the title and the pager agree with what is listed.
    // "Today" is the IST calendar day, not UTC (UTC was yesterday before 05:30).
    const sumRows = (await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total_grns,
        COALESCE(SUM(agg.total_received), 0)::int AS total_received,
        COUNT(*) FILTER (
          WHERE pg.grn_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
        )::int AS today_count
      FROM public.party_grn pg
      LEFT JOIN public.clients c ON c.id = pg.client_id AND c.deleted_at IS NULL
      ${LINE_AGG_SQL}
      WHERE pg.company_id = ${companyId}::uuid
        AND pg.deleted_at IS NULL
        ${searchFrag}
        ${jwFrag}
        ${clientFrag}
        ${fromFrag}
        ${toFrag}
        ${sfFrag}
    `)) as unknown as Array<Record<string, unknown>>;
    const sum = sumRows[0] ?? {};
    const total = Number(sum['total_grns'] ?? 0);
    const summary = {
      totalGrns: Number(sum['total_grns'] ?? 0),
      totalReceived: Number(sum['total_received'] ?? 0),
      today: Number(sum['today_count'] ?? 0),
    };

    const itemsOut = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items: itemsOut, total, limit: input.limit, offset: input.offset, summary };
  });
}

function toListItem(r: Record<string, unknown>): PartyGrnListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    grnDate: dateLike(r['grnDate']),
    jobWorkOrderId: (r['jobWorkOrderId'] as string | null) ?? null,
    jwCodeText: (r['jwCodeText'] as string | null) ?? null,
    clientId: (r['clientId'] as string | null) ?? null,
    clientCodeText: (r['clientCodeText'] as string | null) ?? null,
    clientPoNo: (r['clientPoNo'] as string | null) ?? null,
    dcNo: (r['dcNo'] as string | null) ?? null,
    remarks: (r['remarks'] as string | null) ?? null,
    receivedByText: (r['receivedByText'] as string | null) ?? null,
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: r['deletedAt'] != null ? tsLike(r['deletedAt']) : null,
    clientName: (r['clientName'] as string | null) ?? null,
    totalReceivedQty: Number(r['totalReceivedQty'] ?? 0),
    totalAcceptedQty: Number(r['totalAcceptedQty'] ?? 0),
    qcPendingLines: Number(r['qcPendingLines'] ?? 0),
    linesCount: Number(r['linesCount'] ?? 0),
  };
}

/** Header + lines of one live Party GRN, inside the caller's transaction (the
 *  QC step returns it without needing the Party read gate a second time). */
export async function loadPartyGrnDetail(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<PartyGrnDetail> {
  const headerRows = await tx.execute(sql`
    SELECT
      pg.id, pg.company_id AS "companyId", pg.code,
      pg.grn_date AS "grnDate",
      pg.job_work_order_id AS "jobWorkOrderId",
      pg.jw_code_text AS "jwCodeText",
      pg.client_id AS "clientId",
      pg.client_code_text AS "clientCodeText",
      pg.client_po_no AS "clientPoNo",
      pg.dc_no AS "dcNo",
      pg.remarks,
      pg.received_by_text AS "receivedByText",
      pg.created_at AS "createdAt", pg.created_by AS "createdBy",
      pg.updated_at AS "updatedAt", pg.updated_by AS "updatedBy",
      pg.deleted_at AS "deletedAt",
      c.name AS "clientName"
    FROM public.party_grn pg
    LEFT JOIN public.clients c ON c.id = pg.client_id AND c.deleted_at IS NULL
    WHERE pg.id = ${id}::uuid
      AND pg.company_id = ${companyId}::uuid
      AND pg.deleted_at IS NULL
    LIMIT 1
  `);
  const hRow = (headerRows as unknown as Array<Record<string, unknown>>)[0];
  if (!hRow) throw new NotFoundError('Party GRN not found. Refresh the page.');

  const lineRows = await tx
    .select()
    .from(partyGrnLines)
    .where(
      and(
        eq(partyGrnLines.partyGrnId, id),
        eq(partyGrnLines.companyId, companyId),
        isNull(partyGrnLines.deletedAt),
      ),
    )
    .orderBy(partyGrnLines.lineNo);

  const lines: PartyGrnLine[] = lineRows.map(rowToLine);
  return {
    ...toListItem(hRow),
    totalReceivedQty: lines.reduce((s, l) => s + l.receivedQty, 0),
    totalAcceptedQty: lines.reduce((s, l) => s + l.acceptedQty, 0),
    qcPendingLines: lineRows.filter(isPendingQc).length,
    linesCount: lines.length,
    lines,
  };
}

export async function getPartyGrnDetail(id: string, user: AuthContext): Promise<PartyGrnDetail> {
  await requirePartyGrnRead(user);
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => loadPartyGrnDetail(tx, companyId, id));
}

function rowToLine(row: typeof partyGrnLines.$inferSelect): PartyGrnLine {
  return {
    id: row.id,
    companyId: row.companyId,
    partyGrnId: row.partyGrnId,
    lineNo: row.lineNo,
    partyMaterialId: row.partyMaterialId,
    partyMaterialCodeText: row.partyMaterialCodeText,
    partyMaterialName: row.partyMaterialName,
    receivedQty: row.receivedQty,
    jwLineNoText: row.jwLineNoText,
    // R2 + R4 (ADR-194): real FK to the JWSO line + incoming-QC split.
    jwLineId: row.jwLineId,
    acceptedQty: row.acceptedQty,
    rejectedQty: row.rejectedQty,
    rejectReason: row.rejectReason,
    qcBy: row.qcBy,
    qcAt: row.qcAt != null ? tsLike(row.qcAt) : null,
    // ADR-203 (D3): rejected pieces already sent back on a Customer Material Return.
    rejectedReturnedQty: row.rejectedReturnedQty,
    remarks: row.remarks,
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt != null ? tsLike(row.deletedAt) : null,
  };
}

/** What a JWSO line has already taken in from the customer, for the ADR-203
 *  receipt cap: Σ accepted on QC'd lines + Σ received on lines still waiting
 *  for QC. Rejected pieces do not use up the order (the customer re-sends).
 *  Call ONLY under lockJwLine for that line (CLAUDE.md §20.3). */
export async function jwLineCommittedQty(tx: DbTransaction, jwLineId: string): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(SUM(CASE WHEN ${PENDING_QC_SQL} THEN pgl.received_qty
                             ELSE pgl.accepted_qty END), 0)::int AS qty
      FROM public.party_grn_lines pgl
      JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
     WHERE pgl.jw_line_id = ${jwLineId}::uuid AND pgl.deleted_at IS NULL
  `)) as unknown as Array<{ qty: number }>;
  return Number(rows[0]?.qty ?? 0);
}

export async function createPartyGrn(
  input: CreatePartyGrnInput,
  user: AuthContext,
): Promise<PartyGrn> {
  // Tier gate. Booking client material in is a create, so L2 Data Entry and up.
  await requireFormAccess(user, 'party_create', 'entry');
  const companyId = requireCompany(user);
  const userId = user.id;
  if (input.lines.length === 0) {
    throw new ValidationError('Add at least one row.');
  }

  return withUserContext(user, async (tx) => {
    // 1) The JWSO (header) — must be live in this company.
    const jwRows = await tx
      .select({
        id: jobWorkOrders.id,
        code: jobWorkOrders.code,
        clientId: jobWorkOrders.clientId,
        clientPoNo: jobWorkOrders.clientPoNo,
      })
      .from(jobWorkOrders)
      .where(
        and(
          eq(jobWorkOrders.id, input.jobWorkOrderId),
          eq(jobWorkOrders.companyId, companyId),
          isNull(jobWorkOrders.deletedAt),
        ),
      )
      .limit(1);
    const jw = jwRows[0];
    if (!jw) throw new NotFoundError('Selected JWSO was not found. Please select the JWSO again.');

    let clientCode: string | null = null;
    if (jw.clientId) {
      const cRows = await tx
        .select({ code: clients.code })
        .from(clients)
        .where(and(eq(clients.id, jw.clientId), eq(clients.companyId, companyId)))
        .limit(1);
      clientCode = cRows[0]?.code ?? null;
    }

    // 2) Lock every JWSO line named on the receipt, in id order so two receipts
    //    naming the same lines can never deadlock, BEFORE summing anything.
    const lineIds = Array.from(new Set(input.lines.map((l) => l.jwLineId))).sort();
    const lockedById = new Map<string, LockedJwLine>();
    for (const lineId of lineIds) {
      const line = await lockJwLine(tx, companyId, lineId);
      if (line.jobWorkOrderId !== jw.id) {
        throw new ValidationError(
          `Ln ${line.lineNo} belongs to ${line.jwCode}, not ${jw.code}. Pick a line of ${jw.code}.`,
        );
      }
      assertJwLineOpenForWork(line, 'receive customer material');
      if (!line.partyMaterialId) {
        throw new ValidationError(
          `${line.jwCode} Ln ${line.lineNo} has no customer RM — open and save the JWSO first.`,
        );
      }
      lockedById.set(lineId, line);
    }

    // 3) The customer material of each line (the line's own -RM party material).
    const pmById = new Map<
      string,
      { id: string; code: string; name: string; clientId: string | null }
    >();
    for (const line of lockedById.values()) {
      const pmId = line.partyMaterialId!;
      if (pmById.has(pmId)) continue;
      const pmRows = await tx
        .select({
          id: partyMaterials.id,
          code: partyMaterials.code,
          name: partyMaterials.name,
          clientId: partyMaterials.clientId,
        })
        .from(partyMaterials)
        .where(
          and(
            eq(partyMaterials.id, pmId),
            eq(partyMaterials.companyId, companyId),
            isNull(partyMaterials.deletedAt),
          ),
        )
        .limit(1);
      const pm = pmRows[0];
      if (!pm) {
        throw new ValidationError(
          `${line.jwCode} Ln ${line.lineNo}: its customer RM was removed — open and save the JWSO first.`,
        );
      }
      // Party material is customer-owned — never received against another
      // customer's order.
      if (pm.clientId !== jw.clientId) {
        throw new ConflictError(
          `${pm.code} belongs to another Customer than ${jw.code}. ` +
            `Customer material can only be received against its own Customer's order.`,
        );
      }
      pmById.set(pm.id, pm);
    }

    // 4) Cap per line, under the line lock: Σ accepted + Σ waiting-for-QC
    //    received + this receipt ≤ order qty.
    const thisReceipt = new Map<string, number>();
    for (const ln of input.lines) {
      thisReceipt.set(ln.jwLineId, (thisReceipt.get(ln.jwLineId) ?? 0) + ln.receivedQty);
    }
    for (const [lineId, qty] of thisReceipt) {
      const line = lockedById.get(lineId)!;
      const already = await jwLineCommittedQty(tx, lineId);
      const open = Math.max(0, line.orderQty - already);
      if (qty > open) {
        throw new ValidationError(
          `${line.jwCode} Ln ${line.lineNo}: Received (${qty}) cannot be more than Pending (${open}) — ` +
            `Order Qty ${line.orderQty}, already received ${already} (accepted, or waiting for Incoming QC). ` +
            `Rejected pieces do not count.`,
        );
      }
    }

    // 5) Header.
    const code = await nextPartyGrnCode(tx, companyId);
    const headerInserted = await tx
      .insert(partyGrn)
      .values({
        companyId,
        code,
        grnDate: input.grnDate,
        jobWorkOrderId: jw.id,
        jwCodeText: jw.code,
        clientId: jw.clientId ?? null,
        clientCodeText: clientCode,
        clientPoNo: jw.clientPoNo ?? null,
        dcNo: input.dcNo ?? null,
        remarks: input.remarks ?? null,
        receivedByText: user.fullName?.trim() || user.email || user.id,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const header = headerInserted[0];
    if (!header) throw new ValidationError('Could not save Party GRN. Try again.');

    // 6) Lines — waiting for Incoming QC. Nothing is posted to the register.
    for (const [idx, ln] of input.lines.entries()) {
      const line = lockedById.get(ln.jwLineId)!;
      const pm = pmById.get(line.partyMaterialId!)!;
      await tx.insert(partyGrnLines).values({
        companyId,
        partyGrnId: header.id,
        lineNo: idx + 1,
        partyMaterialId: pm.id,
        partyMaterialCodeText: pm.code,
        partyMaterialName: pm.name,
        receivedQty: ln.receivedQty,
        // Snapshot of the JWSO line number; jw_line_id is the real link.
        jwLineNoText: String(line.lineNo),
        jwLineId: line.id,
        acceptedQty: 0,
        rejectedQty: 0,
        rejectReason: null,
        qcBy: null,
        qcAt: null,
        remarks: ln.remarks ?? null,
        createdBy: userId,
        updatedBy: userId,
      });
    }

    const totalReceived = input.lines.reduce((a, l) => a + l.receivedQty, 0);
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Create,
        entity: 'PartyGrn',
        entityId: header.id,
        refId: header.code,
        qty: totalReceived,
        detail:
          `${header.code} · ${input.lines.length} line(s), ${totalReceived} pcs received against ` +
          `${header.jwCodeText ?? ''} — waiting for Incoming QC`,
      },
      companyId,
      user,
    );

    return rowToPartyGrn(header);
  });
}

/** Pieces of a JWSO line's customer material still in the register, from the
 *  documents: Σ accepted (QC'd GRN lines) − Σ issued net of returns to store −
 *  Σ good returned to the customer. A GRN cancel may not take back more. */
async function jwLineRegisterBalance(
  tx: DbTransaction,
  jwLineId: string,
  partyMaterialId: string,
): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT
      (SELECT COALESCE(SUM(pgl.accepted_qty), 0)
         FROM public.party_grn_lines pgl
         JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
        WHERE pgl.jw_line_id = ${jwLineId}::uuid AND pgl.party_material_id = ${partyMaterialId}::uuid
          AND pgl.deleted_at IS NULL)
      - (SELECT COALESCE(SUM(mi.qty - mi.returned_to_store_qty), 0)
           FROM public.party_material_issues mi
          WHERE mi.jw_line_id = ${jwLineId}::uuid AND mi.party_material_id = ${partyMaterialId}::uuid
            AND mi.deleted_at IS NULL)
      - (SELECT COALESCE(SUM(cl.qty), 0)
           FROM public.customer_material_return_lines cl
           JOIN public.customer_material_returns c ON c.id = cl.return_id
          WHERE cl.jw_line_id = ${jwLineId}::uuid AND cl.party_material_id = ${partyMaterialId}::uuid
            AND cl.kind = 'good' AND cl.deleted_at IS NULL
            AND c.deleted_at IS NULL AND c.status <> 'cancelled')
      AS balance
  `)) as unknown as Array<{ balance: number | string }>;
  return Number(rows[0]?.balance ?? 0);
}

// ADR-102 / ADR-203 — cancel (reverse) a Party GRN.
//
// Soft-deletes the header + lines. Lines already through Incoming QC have their
// accepted qty taken back out of the register (a 'reversal'/out row per line,
// carrying its JWSO line); lines still waiting for QC never entered it and are
// just cancelled. Refused when rejected pieces were already sent back to the
// customer, or when the accepted pieces have moved on (issued to a Job Card or
// returned) — reverse those first. One transaction; nothing partly applied.
export async function cancelPartyGrn(
  id: string,
  reason: string,
  user: AuthContext,
): Promise<{ ok: true; code: string; reversedQty: number }> {
  // Cancel reverses a received quantity, so it needs edit AND approve (L5+).
  await requireFormAccess(user, 'party_create', 'edit');
  await requireFormAccess(user, 'party_create', 'approve');
  const companyId = requireCompany(user);
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ValidationError('Reason is required to cancel a Party GRN.');

  return withUserContext(user, async (tx) => {
    // Lock the header, THEN re-check it is live — two cancels (or a cancel and
    // a QC) on the same GRN queue here and the second one sees deleted_at.
    const headRows = (await tx.execute(sql`
      SELECT id, code, remarks, deleted_at AS "deletedAt"
        FROM public.party_grn
       WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
       FOR UPDATE
    `)) as unknown as Array<{
      id: string;
      code: string;
      remarks: string | null;
      deletedAt: unknown;
    }>;
    const head = headRows[0];
    if (!head) throw new NotFoundError('Party GRN not found. Refresh the page.');
    if (head.deletedAt != null) {
      throw new ConflictError(`${head.code} is already cancelled. Refresh the page.`);
    }

    const lines = await tx
      .select({
        id: partyGrnLines.id,
        lineNo: partyGrnLines.lineNo,
        jwLineId: partyGrnLines.jwLineId,
        partyMaterialId: partyGrnLines.partyMaterialId,
        partyMaterialCodeText: partyGrnLines.partyMaterialCodeText,
        acceptedQty: partyGrnLines.acceptedQty,
        rejectedQty: partyGrnLines.rejectedQty,
        rejectedReturnedQty: partyGrnLines.rejectedReturnedQty,
        qcAt: partyGrnLines.qcAt,
      })
      .from(partyGrnLines)
      .where(and(eq(partyGrnLines.partyGrnId, id), isNull(partyGrnLines.deletedAt)))
      .orderBy(partyGrnLines.lineNo)
      // Code review fix: lock the lines — a Customer Material Return taking
      // their rejected pieces locks the same rows, so the two serialise.
      .for('update');

    // Rejected pieces already handed back on a Customer Material Return cannot
    // be un-received — cancel that return first.
    const sentBack = lines.filter((l) => l.rejectedReturnedQty > 0);
    if (sentBack.length > 0) {
      throw new ConflictError(
        `Cannot cancel ${head.code}: rejected pieces of ` +
          sentBack.map((l) => `Ln ${l.lineNo} (${l.rejectedReturnedQty})`).join(', ') +
          ` were already sent back on a Customer Material Return. Cancel that return first.`,
      );
    }

    // Only QC'd lines put anything into the register.
    const toReverse = lines.filter(
      (l) => !isPendingQc(l) && l.acceptedQty > 0 && l.partyMaterialId != null,
    );

    // Lock the JWSO lines (id order), then check each line's register balance
    // can absorb what this GRN put in.
    const needByLine = new Map<string, { qty: number; pmId: string; code: string }>();
    for (const l of toReverse) {
      if (l.jwLineId == null) continue; // legacy line with no JWSO link — material-level check only
      const key = `${l.jwLineId}|${l.partyMaterialId}`;
      const prev = needByLine.get(key);
      needByLine.set(key, {
        qty: (prev?.qty ?? 0) + l.acceptedQty,
        pmId: l.partyMaterialId!,
        code: l.partyMaterialCodeText,
      });
    }
    const jwLineIds = Array.from(new Set(toReverse.map((l) => l.jwLineId).filter(Boolean))).sort();
    const lockedLines = new Map<string, LockedJwLine>();
    for (const lineId of jwLineIds) {
      lockedLines.set(lineId!, await lockJwLine(tx, companyId, lineId!));
    }
    for (const [key, need] of needByLine) {
      const jwLineId = key.split('|')[0]!;
      const balance = await jwLineRegisterBalance(tx, jwLineId, need.pmId);
      if (balance < need.qty) {
        const jl = lockedLines.get(jwLineId);
        const where = jl ? `${jl.jwCode} Ln ${jl.lineNo}` : 'its JWSO line';
        throw new ConflictError(
          `Cannot cancel ${head.code}: it put ${need.qty} of ${need.code} into the register for ${where}, ` +
            `but only ${balance} are still there — the rest has been issued to a Job Card or returned to ` +
            `the customer. Reverse those first, then cancel this GRN.`,
        );
      }
    }

    // Post one reversal per QC'd line; the writer refuses if the material's
    // overall balance cannot cover it.
    const now = new Date();
    let reversedQty = 0;
    const byMaterial = new Map<string, number>();
    for (const l of toReverse) {
      await postPartyStockMove(tx, {
        companyId,
        partyMaterialId: l.partyMaterialId!,
        jwLineId: l.jwLineId,
        movement: 'reversal',
        direction: 'out',
        qty: l.acceptedQty,
        sourceDocType: 'party_grn',
        sourceDocId: id,
        remarks: `${head.code} Ln ${l.lineNo} cancelled: ${trimmed}`,
        userId: user.id,
        qtyLabel: 'Reversal Qty',
      });
      reversedQty += l.acceptedQty;
      byMaterial.set(l.partyMaterialId!, (byMaterial.get(l.partyMaterialId!) ?? 0) + l.acceptedQty);
    }

    // Lower the received_qty lifetime counter. No clamp — a counter that would
    // go negative means the books disagree, and that must stop the cancel.
    for (const [materialId, qty] of byMaterial) {
      const upd = (await tx.execute(sql`
        UPDATE public.party_materials
           SET received_qty = received_qty - ${qty}, updated_at = now(), updated_by = ${user.id}::uuid
         WHERE id = ${materialId}::uuid AND received_qty >= ${qty}
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      if (upd.length === 0) {
        throw new ConflictError(
          `Cannot cancel ${head.code}: the received total of its customer material is lower than ` +
            `${qty} — the figures disagree. Ask an admin to check the customer material register.`,
        );
      }
    }

    const stamp = softDeleteStamp(user);
    await tx
      .update(partyGrnLines)
      .set({ ...stamp, updatedAt: now, updatedBy: user.id })
      .where(and(eq(partyGrnLines.partyGrnId, id), isNull(partyGrnLines.deletedAt)));

    await tx
      .update(partyGrn)
      .set({
        ...stamp,
        remarks: head.remarks
          ? `${head.remarks}\n[Cancelled] ${trimmed}`
          : `[Cancelled] ${trimmed}`,
        updatedAt: now,
        updatedBy: user.id,
      })
      .where(and(eq(partyGrn.id, id), isNull(partyGrn.deletedAt)));

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Cancel,
        entity: 'PartyGrn',
        entityId: head.id,
        refId: head.code,
        qty: reversedQty,
        reason: trimmed,
        detail: `${head.code} cancelled — reversed ${reversedQty} from the customer material register`,
      },
      companyId,
      user,
    );

    return { ok: true as const, code: head.code, reversedQty };
  });
}

// ─── Edit (ADR-202 Phase 3) ──────────────────────────────────────────────────
//
// RECORD/HEADER level enrolment of Party GRN in edit-approval. Editable: the
// header's own fields (GRN Date, Customer Challan No., Remarks, Received By) and,
// on a line STILL WAITING for Incoming QC only, its Received Qty and Remarks. A
// line already through QC is frozen (accepted/rejected booked, stock posted), so
// editing it is refused. Raising a waiting line's Received Qty re-checks the
// JWSO-line receipt cap under that line's lock (§20.3). Header edits and a
// waiting-line qty change touch NO stock — nothing enters the customer-material
// register until QC (postPartyStockMove), which this path never calls.

/** The header fields the edit diff / History compare, with docs/NAMING.md labels. */
export const PARTY_GRN_HEADER_FIELDS: readonly DiffField[] = [
  { key: 'grnDate', label: 'GRN Date' },
  { key: 'dcNo', label: 'Customer Challan No.' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'receivedByText', label: 'Received By' },
];

/** The editable attrs of a waiting-QC line. */
const PARTY_GRN_LINE_FIELDS: readonly DiffField[] = [
  { key: 'receivedQty', label: 'Received Qty' },
  { key: 'remarks', label: 'Remarks' },
];

/**
 * The body of a Party GRN edit, inside a caller-supplied transaction. Called by
 * updatePartyGrn (which opens the tx and ran the access check) and by the
 * edit-approval engine's applyEdit, which already holds a tx with the GRN row
 * locked. Locks the header + lines, refuses a line that is not on the GRN or has
 * already been through Incoming QC, re-checks the receipt cap when a waiting
 * line's qty is raised, and logs a before → after Edit (ADR-197).
 */
export async function updatePartyGrnTx(
  tx: DbTransaction,
  id: string,
  input: UpdatePartyGrnInput,
  user: AuthContext,
): Promise<PartyGrnDetail> {
  const companyId = requireCompany(user);

  // Lock the header, then confirm it is live (not cancelled).
  const headRows = (await tx.execute(sql`
    SELECT id, code, grn_date AS "grnDate", dc_no AS "dcNo", remarks,
           received_by_text AS "receivedByText", deleted_at AS "deletedAt"
      FROM public.party_grn
     WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
     FOR UPDATE
  `)) as unknown as Array<{
    id: string;
    code: string;
    grnDate: unknown;
    dcNo: string | null;
    remarks: string | null;
    receivedByText: string | null;
    deletedAt: unknown;
  }>;
  const head = headRows[0];
  if (!head) throw new NotFoundError('Party GRN not found. Refresh the page.');
  if (head.deletedAt != null) {
    throw new ConflictError(`${head.code} is cancelled — it cannot be edited.`);
  }

  // Lock every live line (the waiting-QC check and any line edit read these; the
  // lock serialises against a concurrent QC or cancel of the same GRN).
  const lineRows = await tx
    .select()
    .from(partyGrnLines)
    .where(and(eq(partyGrnLines.partyGrnId, id), isNull(partyGrnLines.deletedAt)))
    .orderBy(partyGrnLines.lineNo)
    .for('update');
  const lineById = new Map(lineRows.map((l) => [l.id, l]));

  // ── Header ────────────────────────────────────────────────────────────────
  const beforeHeader: Record<string, unknown> = {
    grnDate: dateLike(head.grnDate),
    dcNo: head.dcNo,
    remarks: head.remarks,
    receivedByText: head.receivedByText,
  };
  const headerSet: Record<string, unknown> = {};
  if (input.grnDate !== undefined) headerSet['grnDate'] = input.grnDate;
  if (input.dcNo !== undefined) headerSet['dcNo'] = input.dcNo ?? null;
  if (input.remarks !== undefined) headerSet['remarks'] = input.remarks ?? null;
  if (input.receivedByText !== undefined) {
    headerSet['receivedByText'] = input.receivedByText ?? null;
  }

  // ── Lines (waiting-QC only) ─────────────────────────────────────────────────
  const now = new Date();
  const editedLines: Array<{
    lineNo: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }> = [];
  for (const li of input.lines ?? []) {
    const current = lineById.get(li.id);
    if (!current) {
      throw new ConflictError(`A line in this edit is not on ${head.code}. Refresh the page.`);
    }
    const at = `${head.code} Ln ${current.lineNo}`;
    // Only a line still waiting for Incoming QC may be edited.
    if (!isPendingQc(current)) {
      throw new ConflictError(
        `${at} has already been through Incoming QC — its received qty and remarks can no longer be changed.`,
      );
    }

    const before: Record<string, unknown> = {
      receivedQty: current.receivedQty,
      remarks: current.remarks,
    };
    const after: Record<string, unknown> = { ...before };
    const lineSet: Record<string, unknown> = {};

    if (li.remarks !== undefined) {
      lineSet['remarks'] = li.remarks ?? null;
      after['remarks'] = li.remarks ?? null;
    }

    if (li.receivedQty !== undefined && li.receivedQty !== current.receivedQty) {
      if (!current.jwLineId) {
        throw new ConflictError(
          `${at} has no JWSO line — it was booked before ADR-203 and cannot be edited.`,
        );
      }
      // §20.3 — lock the JWSO line, THEN re-check the receipt cap and that the
      // new qty cannot fall below what has already been consumed downstream.
      const jwLine = await lockJwLine(tx, companyId, current.jwLineId);
      // committed = Σ accepted on QC'd lines + Σ received on waiting lines (this
      // line's OLD received included); swap in the new received for this line.
      const committedNow = await jwLineCommittedQty(tx, current.jwLineId);
      const committedOther = committedNow - current.receivedQty;
      const committedAfter = committedOther + li.receivedQty;
      if (committedAfter > jwLine.orderQty) {
        const open = Math.max(0, jwLine.orderQty - committedOther);
        throw new ConflictError(
          `${at}: Received (${li.receivedQty}) cannot be more than Pending (${open}) — ` +
            `Order Qty ${jwLine.orderQty}, already ${committedOther} on other lines ` +
            `(accepted, or waiting for Incoming QC). Rejected pieces do not count.`,
        );
      }
      if (current.partyMaterialId) {
        const registerBalance = await jwLineRegisterBalance(
          tx,
          current.jwLineId,
          current.partyMaterialId,
        );
        if (committedAfter < registerBalance) {
          throw new ConflictError(
            `${at}: cannot lower Received to ${li.receivedQty} — ${registerBalance} of this ` +
              `customer material have already been accepted and issued to a Job Card or returned. ` +
              `Reverse those first.`,
          );
        }
      }
      lineSet['receivedQty'] = li.receivedQty;
      after['receivedQty'] = li.receivedQty;
    }

    if (Object.keys(lineSet).length > 0) {
      // Conditional on still-pending (§20.2): a QC booked a moment ago (qc_at set)
      // must not have its received qty overwritten.
      const booked = await tx
        .update(partyGrnLines)
        .set({ ...lineSet, updatedAt: now, updatedBy: user.id })
        .where(
          and(
            eq(partyGrnLines.id, current.id),
            isNull(partyGrnLines.qcAt),
            eq(partyGrnLines.acceptedQty, 0),
            eq(partyGrnLines.rejectedQty, 0),
            isNull(partyGrnLines.deletedAt),
          ),
        )
        .returning({ id: partyGrnLines.id });
      if (booked.length === 0) {
        throw new ConflictError(`${at} was QC'd a moment ago. Refresh the page.`);
      }
      editedLines.push({ lineNo: current.lineNo, before, after });
    }
  }

  // Apply header + stamp (always bump updatedBy/updatedAt).
  await tx
    .update(partyGrn)
    .set({ ...headerSet, updatedAt: now, updatedBy: user.id })
    .where(and(eq(partyGrn.id, id), isNull(partyGrn.deletedAt)));

  // ── Audit (ADR-197) — one Edit for the header, one per edited line ──────────
  const afterHeader: Record<string, unknown> = {
    grnDate: 'grnDate' in headerSet ? headerSet['grnDate'] : beforeHeader['grnDate'],
    dcNo: 'dcNo' in headerSet ? headerSet['dcNo'] : beforeHeader['dcNo'],
    remarks: 'remarks' in headerSet ? headerSet['remarks'] : beforeHeader['remarks'],
    receivedByText:
      'receivedByText' in headerSet ? headerSet['receivedByText'] : beforeHeader['receivedByText'],
  };
  const headerChanges = diffFields(beforeHeader, afterHeader, PARTY_GRN_HEADER_FIELDS);
  if (headerChanges.length > 0) {
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Edit,
        entity: 'PartyGrn',
        entityId: head.id,
        refId: head.code,
        changes: headerChanges,
        detail: `Edited ${head.code}`,
      },
      companyId,
      user,
    );
  }
  for (const e of editedLines) {
    const changes = diffFields(e.before, e.after, PARTY_GRN_LINE_FIELDS);
    if (changes.length === 0) continue;
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Edit,
        entity: 'PartyGrn',
        entityId: head.id,
        refId: head.code,
        lineRef: `Line ${e.lineNo}`,
        changes,
        detail: `${head.code} Line ${e.lineNo} edited`,
      },
      companyId,
      user,
    );
  }

  return loadPartyGrnDetail(tx, companyId, id);
}

/**
 * Public Party GRN edit. Changing a saved GRN is `edit` (L5+), not the create
 * tier — checked HERE, not in the tx body, so the edit-approval engine's
 * applyEdit (ADR-202) can replay an approved edit for an approver who holds
 * `approve` but not the edit tier.
 */
export async function updatePartyGrn(
  id: string,
  input: UpdatePartyGrnInput,
  user: AuthContext,
): Promise<PartyGrnDetail> {
  await requireFormAccess(user, 'party_create', 'edit');
  return withUserContext(user, (tx) => updatePartyGrnTx(tx, id, input, user));
}

/**
 * The Party GRN edit entry point the PATCH route calls (ADR-202 Phase 3). When
 * the Document Edit Approval gate is ON and the GRN is LIVE (not cancelled and at
 * least one line still waiting for Incoming QC), the edit is staged for approval
 * and the request row is returned; otherwise it applies directly. A change to a
 * line that is not on the GRN or already QC'd is refused with a clear message
 * instead of being silently dropped (the registry only stages waiting-QC keys).
 */
export async function updatePartyGrnOrStage(
  id: string,
  input: UpdatePartyGrnInput,
  user: AuthContext,
): Promise<PartyGrnDetail | DocumentEditStagedResult> {
  await requireFormAccess(user, 'party_create', 'edit');
  const companyId = requireCompany(user);

  // Engine imported dynamically to avoid a static import cycle with
  // party-grn-edit-registry (which imports updatePartyGrnTx from this file).
  const { isDocEditApprovalOn, requestDocumentEdit } = await import('../document-edits/service');
  const shouldStage = await withUserContext(user, async (tx) => {
    if (!(await isDocEditApprovalOn(tx, companyId))) return false;
    const lines = await tx
      .select({
        id: partyGrnLines.id,
        lineNo: partyGrnLines.lineNo,
        qcAt: partyGrnLines.qcAt,
        acceptedQty: partyGrnLines.acceptedQty,
        rejectedQty: partyGrnLines.rejectedQty,
      })
      .from(partyGrnLines)
      .innerJoin(partyGrn, eq(partyGrn.id, partyGrnLines.partyGrnId))
      .where(
        and(
          eq(partyGrnLines.partyGrnId, id),
          eq(partyGrnLines.companyId, companyId),
          isNull(partyGrnLines.deletedAt),
          isNull(partyGrn.deletedAt),
        ),
      );
    if (lines.length === 0) return false; // gone / cancelled — direct path reports it
    // "Live" = at least one line still waiting for Incoming QC. A fully QC-closed
    // GRN edits directly, like a draft (header-only, lines are frozen anyway).
    if (!lines.some(isPendingQc)) return false;
    // Refuse a change to a line that is no longer editable, rather than drop it.
    const byId = new Map(lines.map((l) => [l.id, l]));
    for (const li of input.lines ?? []) {
      const c = byId.get(li.id);
      if (!c) {
        throw new ConflictError('A line in this edit is not on this Party GRN. Refresh the page.');
      }
      if (!isPendingQc(c)) {
        throw new ConflictError(
          `Line ${c.lineNo} has already been through Incoming QC — it can no longer be edited.`,
        );
      }
    }
    return true;
  });

  if (shouldStage) {
    const request = await requestDocumentEdit('PartyGrn', id, input, input.expectedUpdatedAt, user);
    return { staged: true, request };
  }
  return updatePartyGrn(id, input, user);
}

function rowToPartyGrn(row: typeof partyGrn.$inferSelect): PartyGrn {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    grnDate: dateLike(row.grnDate),
    jobWorkOrderId: row.jobWorkOrderId,
    jwCodeText: row.jwCodeText,
    clientId: row.clientId,
    clientCodeText: row.clientCodeText,
    clientPoNo: row.clientPoNo,
    dcNo: row.dcNo,
    remarks: row.remarks,
    receivedByText: row.receivedByText,
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt != null ? tsLike(row.deletedAt) : null,
  };
}
