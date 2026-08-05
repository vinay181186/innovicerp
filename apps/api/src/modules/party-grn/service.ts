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
  jobWorkOrderLines,
  jobWorkOrders,
  partyGrn,
  partyGrnLines,
  partyMaterials,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

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
        // ADR-102: the master ties each party material to ONE client + ONE item.
        // Both are checked against the JW line below.
        clientId: partyMaterials.clientId,
        itemId: partyMaterials.itemId,
        itemCodeText: partyMaterials.itemCodeText,
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

    // 4b) Over-receipt guard: cumulative received per JW line (matched by the
    // line number) must not exceed that line's order qty. Lines with no line
    // number are not attributable to a part, so they are not capped here.
    const jwLines = await tx
      .select({
        lineNo: jobWorkOrderLines.lineNo,
        orderQty: jobWorkOrderLines.orderQty,
        partName: jobWorkOrderLines.partName,
        itemId: jobWorkOrderLines.itemId,
        itemCodeText: jobWorkOrderLines.itemCodeText,
      })
      .from(jobWorkOrderLines)
      .where(
        and(eq(jobWorkOrderLines.jobWorkOrderId, jw.id), isNull(jobWorkOrderLines.deletedAt)),
      );
    const lineByNo = new Map(
      jwLines.map((l) => [
        String(l.lineNo),
        {
          orderQty: Number(l.orderQty),
          partName: l.partName,
          itemId: l.itemId,
          itemCodeText: l.itemCodeText,
        },
      ]),
    );
    const existingRows = (await tx.execute(sql`
      SELECT pgl.jw_line_no_text AS "lineNoText",
             COALESCE(SUM(pgl.received_qty), 0)::int AS "received"
      FROM public.party_grn pg
      JOIN public.party_grn_lines pgl ON pgl.party_grn_id = pg.id AND pgl.deleted_at IS NULL
      WHERE pg.job_work_order_id = ${jw.id}::uuid AND pg.deleted_at IS NULL
      GROUP BY pgl.jw_line_no_text
    `)) as unknown as Array<{ lineNoText: string | null; received: number }>;
    const receivedByLineNo = new Map<string, number>();
    for (const r of existingRows) {
      if (r.lineNoText != null) receivedByLineNo.set(String(r.lineNoText).trim(), Number(r.received));
    }

    // 5) Insert lines + update per-material totals
    for (const [idx, ln] of input.lines.entries()) {
      const pm = pmById.get(ln.partyMaterialId);
      if (!pm) {
        throw new NotFoundError(`Party material ${ln.partyMaterialId} not found`);
      }

      // ADR-102: the JWSO line is mandatory and must be a real line on THIS
      // JWSO. Previously it was optional free text, and every check below only
      // ran when it happened to be filled with a matching number — so a blank
      // or mistyped line silently bypassed the order-qty cap entirely.
      const lnKey = String(ln.jwLineNoText ?? '').trim();
      if (!lnKey) {
        throw new ValidationError(
          `Line ${idx + 1}: pick which JWSO line this material is for. ` +
            `${jw.code} has line(s) ${jwLines.map((l) => l.lineNo).join(', ')}.`,
        );
      }
      const jwLine = lineByNo.get(lnKey);
      if (!jwLine) {
        throw new ValidationError(
          `Line ${idx + 1}: ${jw.code} has no line ${lnKey}. ` +
            `Available line(s): ${jwLines.map((l) => l.lineNo).join(', ')}.`,
        );
      }
      const { orderQty, partName, itemId: lineItemId, itemCodeText: lineItemCode } = jwLine;

      // ADR-102: the material must BE that line's part. The party-material
      // master already pins each code to one item (Client → order → item
      // cascade); without this check a LEVER could be received against the
      // SINGLE FIRE CHECK LEVER line, inflating one part's material gate while
      // the real part shows none received.
      if (pm.itemId != null && lineItemId != null && pm.itemId !== lineItemId) {
        throw new ValidationError(
          `Line ${idx + 1}: ${pm.code} is "${pm.name}"` +
            `${pm.itemCodeText ? ` (item ${pm.itemCodeText})` : ''}, but ${jw.code} line ${lnKey} is ` +
            `"${partName}"${lineItemCode ? ` (item ${lineItemCode})` : ''}. ` +
            `Pick the material for this part, or pick the line this material belongs to.`,
        );
      }

      // ADR-102: party material is customer-owned — it cannot be received
      // against a different customer's order.
      if (pm.clientId != null && jw.clientId != null && pm.clientId !== jw.clientId) {
        throw new ValidationError(
          `Line ${idx + 1}: ${pm.code} belongs to a different client than ${jw.code}. ` +
            `Party material can only be received against its own client's order.`,
        );
      }

      // Block receiving more than the line's order qty (cumulative across all
      // GRNs for this JW, including earlier lines in this same receipt).
      {
        const already = receivedByLineNo.get(lnKey) ?? 0;
        const remaining = Math.max(0, orderQty - already);
        if (ln.receivedQty > remaining) {
          const part = partName ? `${partName} (line ${lnKey})` : `Line ${lnKey}`;
          const note =
            already > 0
              ? `Ordered ${orderQty}, already received ${already}, so only ${remaining} more can be received.`
              : `Ordered ${orderQty}, so at most ${orderQty} can be received.`;
          throw new ValidationError(
            `${part}: you entered ${ln.receivedQty}, but ${note} Please reduce the quantity.`,
          );
        }
        receivedByLineNo.set(lnKey, already + ln.receivedQty);
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

// ADR-102 — cancel (reverse) a Party GRN.
//
// Party GRN had create + read only, so a wrong receipt was permanent: the qty
// stayed on the party material's stock AND kept inflating the JWSO line's
// production gate (op-entry caps the first op at party-GRN received qty).
// Cancel soft-deletes the header + lines and takes the qty back off the
// material, which is the same arithmetic createPartyGrn did, reversed.
//
// Refused when the material has already moved on: if reversing would push
// stock below zero, those pieces have been issued to a Job Card and the issue
// must be reversed first. Nothing is partially applied — one transaction.
export async function cancelPartyGrn(
  id: string,
  reason: string,
  user: AuthContext,
): Promise<{ ok: true; code: string; reversedQty: number }> {
  const companyId = requireCompany(user);
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ValidationError('A reason is required to cancel a Party GRN');

  return withUserContext(user, async (tx) => {
    const headRows = await tx
      .select({ id: partyGrn.id, code: partyGrn.code, remarks: partyGrn.remarks })
      .from(partyGrn)
      .where(
        and(
          eq(partyGrn.id, id),
          eq(partyGrn.companyId, companyId),
          isNull(partyGrn.deletedAt),
        ),
      )
      .limit(1);
    const head = headRows[0];
    if (!head) throw new NotFoundError(`Party GRN ${id} not found`);

    const lines = await tx
      .select({
        id: partyGrnLines.id,
        partyMaterialId: partyGrnLines.partyMaterialId,
        partyMaterialCodeText: partyGrnLines.partyMaterialCodeText,
        receivedQty: partyGrnLines.receivedQty,
      })
      .from(partyGrnLines)
      .where(and(eq(partyGrnLines.partyGrnId, id), isNull(partyGrnLines.deletedAt)));

    // Net qty to reverse per material (a receipt may repeat the same code).
    const byMaterial = new Map<string, { code: string; qty: number }>();
    let reversedQty = 0;
    for (const l of lines) {
      reversedQty += l.receivedQty;
      if (l.partyMaterialId == null) continue; // master row deleted — nothing to credit back
      const prev = byMaterial.get(l.partyMaterialId);
      byMaterial.set(l.partyMaterialId, {
        code: l.partyMaterialCodeText,
        qty: (prev?.qty ?? 0) + l.receivedQty,
      });
    }

    // Lock, then check every material can absorb the reversal before writing.
    for (const materialId of byMaterial.keys()) {
      await tx.execute(
        sql`SELECT 1 FROM public.party_materials WHERE id = ${materialId}::uuid FOR UPDATE`,
      );
    }
    for (const [materialId, { code, qty }] of byMaterial) {
      const pmRows = await tx
        .select({ stockQty: partyMaterials.stockQty, receivedQty: partyMaterials.receivedQty })
        .from(partyMaterials)
        .where(eq(partyMaterials.id, materialId))
        .limit(1);
      const pm = pmRows[0];
      if (!pm) continue;
      if (pm.stockQty - qty < 0) {
        throw new ValidationError(
          `Cannot cancel ${head.code}: it received ${qty} of ${code}, but only ${pm.stockQty} ` +
            `are still on hand — the rest has been issued to production. Reverse the material ` +
            `issue first, then cancel this GRN.`,
        );
      }
    }

    const now = new Date();
    for (const [materialId, { qty }] of byMaterial) {
      await tx
        .update(partyMaterials)
        .set({
          stockQty: sql`${partyMaterials.stockQty} - ${qty}`,
          receivedQty: sql`GREATEST(${partyMaterials.receivedQty} - ${qty}, 0)`,
          updatedAt: now,
          updatedBy: user.id,
        })
        .where(eq(partyMaterials.id, materialId));
    }

    await tx
      .update(partyGrnLines)
      .set({ deletedAt: now, updatedAt: now, updatedBy: user.id })
      .where(and(eq(partyGrnLines.partyGrnId, id), isNull(partyGrnLines.deletedAt)));

    await tx
      .update(partyGrn)
      .set({
        deletedAt: now,
        remarks: head.remarks ? `${head.remarks}\n[Cancelled] ${trimmed}` : `[Cancelled] ${trimmed}`,
        updatedAt: now,
        updatedBy: user.id,
      })
      .where(eq(partyGrn.id, id));

    await emitActivityLog(
      tx,
      {
        action: 'CANCEL',
        entity: 'PartyGrn',
        detail: `${head.code} cancelled: ${trimmed} — reversed ${reversedQty} from party stock`,
        refId: head.code,
      },
      companyId,
      user,
    );

    return { ok: true as const, code: head.code, reversedQty };
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
