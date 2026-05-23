// Party Material GRN service (Store slice 2).
//
// Records client-supplied raw material received against a JW order. Multi-line
// per receipt. Each line increments party_materials.stock_qty + received_qty.
// Mirrors legacy renderPartyGRN + addPartyGRN (HTML L24251 / L24298).

import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreatePartyGrnInput,
  ListPartyGrnQuery,
  ListPartyGrnResponse,
  PartyGrn,
  PartyGrnDetail,
  PartyGrnLine,
  PartyGrnListItem,
} from '@innovic/shared';
import {
  jobWorkOrders,
  partyGrn,
  partyGrnLines,
  partyMaterials,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
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

async function nextPartyGrnCode(
  tx: Parameters<Parameters<typeof withUserContext>[1]>[0],
  companyId: string,
): Promise<string> {
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
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const code = await nextPartyGrnCode(tx, companyId);
    return { code };
  });
}

export async function listPartyGrn(
  input: ListPartyGrnQuery,
  user: AuthContext,
): Promise<ListPartyGrnResponse> {
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
    const fromFrag = input.fromDate
      ? sql`AND pg.grn_date >= ${input.fromDate}::date`
      : sql``;
    const toFrag = input.toDate ? sql`AND pg.grn_date <= ${input.toDate}::date` : sql``;

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
        COALESCE(agg.lines_count, 0)::int AS "linesCount"
      FROM public.party_grn pg
      LEFT JOIN public.clients c ON c.id = pg.client_id AND c.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT SUM(received_qty)::int AS total_received,
               COUNT(*)::int AS lines_count
        FROM public.party_grn_lines pgl
        WHERE pgl.party_grn_id = pg.id AND pgl.deleted_at IS NULL
      ) agg ON true
      WHERE pg.company_id = ${companyId}::uuid
        AND pg.deleted_at IS NULL
        ${searchFrag}
        ${jwFrag}
        ${clientFrag}
        ${fromFrag}
        ${toFrag}
      ORDER BY pg.grn_date DESC, pg.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [eq(partyGrn.companyId, companyId), isNull(partyGrn.deletedAt)];
    const totalRows = await tx
      .select({ value: count() })
      .from(partyGrn)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    // Summary (3 tiles) across ALL non-deleted party_grn for the company.
    const today = new Date().toISOString().slice(0, 10);
    const sumRows = (await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total_grns,
        COALESCE(SUM(agg.total_received), 0)::int AS total_received,
        COUNT(*) FILTER (WHERE pg.grn_date = ${today}::date)::int AS today_count
      FROM public.party_grn pg
      LEFT JOIN LATERAL (
        SELECT SUM(received_qty)::int AS total_received
        FROM public.party_grn_lines pgl
        WHERE pgl.party_grn_id = pg.id AND pgl.deleted_at IS NULL
      ) agg ON true
      WHERE pg.company_id = ${companyId}::uuid
        AND pg.deleted_at IS NULL
    `)) as unknown as Array<Record<string, unknown>>;
    const sum = sumRows[0] ?? {};
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
    linesCount: Number(r['linesCount'] ?? 0),
  };
}

export async function getPartyGrnDetail(
  id: string,
  user: AuthContext,
): Promise<PartyGrnDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
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
    if (!hRow) throw new NotFoundError(`Party GRN ${id} not found`);

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
    const totalReceivedQty = lines.reduce((s, l) => s + l.receivedQty, 0);

    return {
      ...toListItem(hRow),
      totalReceivedQty,
      linesCount: lines.length,
      lines,
    };
  });
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
    remarks: row.remarks,
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt != null ? tsLike(row.deletedAt) : null,
  };
}

export async function createPartyGrn(
  input: CreatePartyGrnInput,
  user: AuthContext,
): Promise<PartyGrn> {
  const companyId = requireCompany(user);
  const userId = user.id;
  if (input.lines.length === 0) {
    throw new ValidationError('At least one line is required');
  }

  return withUserContext(user, async (tx) => {
    // 1) Validate JW
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
    if (!jw) throw new NotFoundError(`Job Work Order ${input.jobWorkOrderId} not found`);

    // 2) Validate all party materials exist + lock for stock update
    const materialIds = Array.from(new Set(input.lines.map((l) => l.partyMaterialId)));
    const pmRows = await tx
      .select({
        id: partyMaterials.id,
        code: partyMaterials.code,
        name: partyMaterials.name,
        stockQty: partyMaterials.stockQty,
        receivedQty: partyMaterials.receivedQty,
      })
      .from(partyMaterials)
      .where(
        and(
          eq(partyMaterials.companyId, companyId),
          isNull(partyMaterials.deletedAt),
        ),
      );
    const pmById = new Map(pmRows.map((p) => [p.id, p]));
    for (const id of materialIds) {
      if (!pmById.has(id)) {
        throw new NotFoundError(`Party material ${id} not found`);
      }
    }

    // 3) Lock the rows we'll update
    for (const id of materialIds) {
      await tx.execute(
        sql`SELECT 1 FROM public.party_materials WHERE id = ${id}::uuid FOR UPDATE`,
      );
    }

    // 4) Insert header
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
        clientCodeText: null,
        clientPoNo: jw.clientPoNo ?? null,
        dcNo: input.dcNo ?? null,
        remarks: input.remarks ?? null,
        receivedByText: user.email ?? user.id,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const header = headerInserted[0];
    if (!header) throw new ValidationError('Failed to insert party GRN header');

    // 5) Insert lines + update per-material totals
    for (const [idx, ln] of input.lines.entries()) {
      const pm = pmById.get(ln.partyMaterialId);
      if (!pm) {
        throw new NotFoundError(`Party material ${ln.partyMaterialId} not found`);
      }
      await tx.insert(partyGrnLines).values({
        companyId,
        partyGrnId: header.id,
        lineNo: idx + 1,
        partyMaterialId: pm.id,
        partyMaterialCodeText: pm.code,
        partyMaterialName: pm.name,
        receivedQty: ln.receivedQty,
        jwLineNoText: ln.jwLineNoText ?? null,
        remarks: ln.remarks ?? null,
        createdBy: userId,
        updatedBy: userId,
      });

      await tx
        .update(partyMaterials)
        .set({
          stockQty: pm.stockQty + ln.receivedQty,
          receivedQty: pm.receivedQty + ln.receivedQty,
          updatedAt: new Date(),
          updatedBy: userId,
        })
        .where(eq(partyMaterials.id, pm.id));
      // Update local cache so subsequent same-id lines accumulate
      pm.stockQty += ln.receivedQty;
      pm.receivedQty += ln.receivedQty;
    }

    return rowToPartyGrn(header);
  });
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
