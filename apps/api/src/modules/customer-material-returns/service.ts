// Customer Material Return service (ADR-203, owner D3).
//
// IN-CMR-##### — the challan that sends the CUSTOMER'S OWN material back. Not
// the JW Return (JW Dispatch), which sends back finished parts. Two kinds of
// line, both tied to a JWSO line, both using that line's customer RM
// (job_work_order_lines.party_material_id):
//   good     — spare accepted pieces from the customer-material register.
//              Capped at the line's register balance (./party-material-issues/
//              register.ts) and at the material's stock (the ledger writer).
//              Posts 'return'/out on the line; bumps party_materials.returned_qty.
//   rejected — pieces Incoming QC rejected on a Party GRN line and held since.
//              They never entered the register, so nothing is posted; the GRN
//              line's rejected_returned_qty rises (conditional UPDATE with the
//              cap in its WHERE).
// Every cap is checked under the JWSO line's row lock (lockJwLine). Returns
// are allowed on closed / short-closed lines — returning the customer's
// material is not new work.
// Cancel (edit + approve) is a conditional status flip, then every line is
// reversed. Counters never clamp — a counter that would go negative throws.

import { sql } from 'drizzle-orm';
import type {
  CreateCustomerMaterialReturnInput,
  CustomerMaterialReturn,
  CustomerMaterialReturnDetail,
  CustomerMaterialReturnKind,
  CustomerMaterialReturnLine,
  CustomerMaterialReturnableRow,
  ListCustomerMaterialReturnsQuery,
  ListCustomerMaterialReturnsResponse,
} from '@innovic/shared';
import { ActivityAction } from '@innovic/shared';
import { customerMaterialReturnLines, customerMaterialReturns } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { lockDocSeries } from '../../lib/doc-series-lock';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { type LockedJwLine, lockJwLine } from '../../lib/jw-line-state';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { postPartyStockMove } from '../../lib/party-stock-ledger';
import { emitActivityLog } from '../activity-log/service';
import { jwLineRegister } from '../party-material-issues/register';
import { CUSTOMER_MATERIAL_RETURN_SF_COLUMNS } from './sf-columns';

const ENTITY = 'CustomerMaterialReturn';
const CODE_PREFIX = 'IN-CMR-';
const CODE_PAD = 5;

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dateLike(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function tsLike(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

async function nextReturnCode(tx: DbTransaction, companyId: string): Promise<string> {
  // S2: queue behind any other save numbering this series (lib/doc-series-lock).
  await lockDocSeries(tx, companyId, 'customer_material_returns');
  const rows = (await tx.execute(sql`
    SELECT COALESCE(
      MAX(NULLIF(regexp_replace(code, '^${sql.raw(CODE_PREFIX)}', ''), '')::int),
      0
    ) + 1 AS next_num
    FROM public.customer_material_returns
    WHERE company_id = ${companyId}::uuid
      AND code ~ ${`^${CODE_PREFIX}\\d+$`}
  `)) as unknown as Array<{ next_num: number }>;
  const next = Number(rows[0]?.next_num ?? 1);
  return `${CODE_PREFIX}${String(next).padStart(CODE_PAD, '0')}`;
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** FROM + joins shared by the list, its count and the detail header. */
const HEADER_FROM = sql`
  FROM public.customer_material_returns r
  LEFT JOIN public.job_work_orders jw ON jw.id = r.job_work_order_id
  LEFT JOIN public.clients cl ON cl.id = r.client_id
  LEFT JOIN LATERAL (
    SELECT SUM(l.qty)::int AS total_qty
      FROM public.customer_material_return_lines l
     WHERE l.return_id = r.id AND l.deleted_at IS NULL
  ) agg ON true
`;

const HEADER_COLUMNS = sql`
  r.id, r.code, r.return_date AS "returnDate",
  r.job_work_order_id AS "jobWorkOrderId", jw.code AS "jwCode",
  r.client_id AS "clientId", cl.name AS "clientName",
  r.vehicle_no AS "vehicleNo", r.remarks, r.status,
  r.cancel_reason AS "cancelReason", r.cancelled_at AS "cancelledAt",
  COALESCE(agg.total_qty, 0)::int AS "totalQty",
  r.created_at AS "createdAt", r.created_by AS "createdBy"
`;

function toHeader(r: Record<string, unknown>): CustomerMaterialReturn {
  return {
    id: r['id'] as string,
    code: r['code'] as string,
    returnDate: dateLike(r['returnDate']),
    jobWorkOrderId: r['jobWorkOrderId'] as string,
    jwCode: (r['jwCode'] as string | null) ?? null,
    clientId: (r['clientId'] as string | null) ?? null,
    clientName: (r['clientName'] as string | null) ?? null,
    vehicleNo: (r['vehicleNo'] as string | null) ?? null,
    remarks: (r['remarks'] as string | null) ?? null,
    status: r['status'] === 'cancelled' ? 'cancelled' : 'issued',
    cancelReason: (r['cancelReason'] as string | null) ?? null,
    cancelledAt: r['cancelledAt'] != null ? tsLike(r['cancelledAt']) : null,
    totalQty: Number(r['totalQty'] ?? 0),
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
  };
}

export async function listCustomerMaterialReturns(
  input: ListCustomerMaterialReturnsQuery,
  user: AuthContext,
): Promise<ListCustomerMaterialReturnsResponse> {
  await requireFormAccess(user, 'party_create', 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Search: Return No., JWSO No., Customer, Vehicle No. No quantities (a
    // digit would match nearly every row).
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (
          r.code ILIKE ${term} ESCAPE '\\'
          OR jw.code ILIKE ${term} ESCAPE '\\'
          OR cl.name ILIKE ${term} ESCAPE '\\'
          OR r.vehicle_no ILIKE ${term} ESCAPE '\\'
        )`
      : sql``;
    const jwFrag = input.jobWorkOrderId
      ? sql`AND r.job_work_order_id = ${input.jobWorkOrderId}::uuid`
      : sql``;
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(CUSTOMER_MATERIAL_RETURN_SF_COLUMNS, sf);
    const orderBy = sfOrderBy(
      CUSTOMER_MATERIAL_RETURN_SF_COLUMNS,
      sf,
      sql`r.return_date DESC, r.code DESC, r.id DESC`,
    );
    const whereFrag = sql`
      WHERE r.company_id = ${companyId}::uuid
        AND r.deleted_at IS NULL
        ${searchFrag}
        ${jwFrag}
        ${sfFrag}
    `;

    // ONE predicate for the page and the count, so the pager agrees with the rows.
    const rows = (await tx.execute(sql`
      SELECT ${HEADER_COLUMNS}
      ${HEADER_FROM}
      ${whereFrag}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as Array<Record<string, unknown>>;
    const totals = (await tx.execute(sql`
      SELECT COUNT(*)::int AS n
      ${HEADER_FROM}
      ${whereFrag}
    `)) as unknown as Array<{ n: number }>;

    return {
      items: rows.map(toHeader),
      total: Number(totals[0]?.n ?? 0),
      limit: input.limit,
      offset: input.offset,
    };
  });
}

async function loadDetail(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CustomerMaterialReturnDetail> {
  const head = (await tx.execute(sql`
    SELECT ${HEADER_COLUMNS}
    ${HEADER_FROM}
    WHERE r.id = ${id}::uuid AND r.company_id = ${companyId}::uuid AND r.deleted_at IS NULL
    LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;
  const h = head[0];
  if (!h) throw new NotFoundError('Customer Material Return not found. Refresh the page.');

  const lineRows = (await tx.execute(sql`
    SELECT l.id, l.line_no AS "lineNo", l.kind, l.jw_line_id AS "jwLineId",
           jwl.line_no AS "jwLineNo",
           COALESCE(i.code, jwl.item_code_text) AS "partCode",
           l.party_material_id AS "partyMaterialId", pm.code AS "partyMaterialCode",
           COALESCE(ri.code, pm.item_code_text) AS "rmItemCode",
           COALESCE(ri.name, pm.name) AS "rmItemName",
           l.party_grn_line_id AS "partyGrnLineId", pg.code AS "partyGrnCode",
           l.qty
      FROM public.customer_material_return_lines l
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = l.jw_line_id
      LEFT JOIN public.items i ON i.id = jwl.item_id
      LEFT JOIN public.party_materials pm ON pm.id = l.party_material_id
      LEFT JOIN public.items ri ON ri.id = pm.item_id
      LEFT JOIN public.party_grn_lines pgl ON pgl.id = l.party_grn_line_id
      LEFT JOIN public.party_grn pg ON pg.id = pgl.party_grn_id
     WHERE l.return_id = ${id}::uuid
       AND l.company_id = ${companyId}::uuid
       AND l.deleted_at IS NULL
     ORDER BY l.line_no
  `)) as unknown as Array<Record<string, unknown>>;

  const lines: CustomerMaterialReturnLine[] = lineRows.map((r) => ({
    id: r['id'] as string,
    lineNo: Number(r['lineNo']),
    kind: r['kind'] as CustomerMaterialReturnKind,
    jwLineId: r['jwLineId'] as string,
    jwLineNo: r['jwLineNo'] != null ? Number(r['jwLineNo']) : null,
    partCode: (r['partCode'] as string | null) ?? null,
    partyMaterialId: r['partyMaterialId'] as string,
    partyMaterialCode: (r['partyMaterialCode'] as string | null) ?? null,
    rmItemCode: (r['rmItemCode'] as string | null) ?? null,
    rmItemName: (r['rmItemName'] as string | null) ?? null,
    partyGrnLineId: (r['partyGrnLineId'] as string | null) ?? null,
    partyGrnCode: (r['partyGrnCode'] as string | null) ?? null,
    qty: Number(r['qty']),
  }));
  return { ...toHeader(h), lines };
}

export async function getCustomerMaterialReturnDetail(
  id: string,
  user: AuthContext,
): Promise<CustomerMaterialReturnDetail> {
  await requireFormAccess(user, 'party_create', 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => loadDetail(tx, companyId, id));
}

/** What can still go back to the customer on one JWSO — feeds the create
 *  modal. good: one row per line with a customer RM and a positive register
 *  balance (also capped by the material's stock). rejected: one row per
 *  QC'd Party GRN line still holding rejected pieces. */
export async function listCustomerMaterialReturnable(
  jobWorkOrderId: string,
  user: AuthContext,
): Promise<CustomerMaterialReturnableRow[]> {
  await requireFormAccess(user, 'party_create', 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const jw = (await tx.execute(sql`
      SELECT id FROM public.job_work_orders
       WHERE id = ${jobWorkOrderId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
    `)) as unknown as Array<{ id: string }>;
    if (!jw[0])
      throw new NotFoundError('Selected JWSO was not found. Please select the JWSO again.');

    const lineRows = (await tx.execute(sql`
      SELECT jwl.id AS "jwLineId", jwl.line_no AS "jwLineNo",
             COALESCE(i.code, jwl.item_code_text) AS "partCode",
             pm.id AS "partyMaterialId", pm.code AS "partyMaterialCode",
             COALESCE(ri.code, pm.item_code_text) AS "rmItemCode",
             pm.stock_qty::int AS "stockQty"
        FROM public.job_work_order_lines jwl
        JOIN public.party_materials pm ON pm.id = jwl.party_material_id
        LEFT JOIN public.items i ON i.id = jwl.item_id
        LEFT JOIN public.items ri ON ri.id = pm.item_id
       WHERE jwl.job_work_order_id = ${jobWorkOrderId}::uuid
         AND jwl.company_id = ${companyId}::uuid
         AND jwl.deleted_at IS NULL
       ORDER BY jwl.line_no
    `)) as unknown as Array<{
      jwLineId: string;
      jwLineNo: number;
      partCode: string | null;
      partyMaterialId: string;
      partyMaterialCode: string;
      rmItemCode: string | null;
      stockQty: number;
    }>;

    const out: CustomerMaterialReturnableRow[] = [];
    for (const l of lineRows) {
      const reg = await jwLineRegister(tx, companyId, l.jwLineId);
      const returnable = Math.min(reg.balance, Number(l.stockQty));
      if (returnable <= 0) continue;
      out.push({
        kind: 'good',
        jwLineId: l.jwLineId,
        jwLineNo: Number(l.jwLineNo),
        partCode: l.partCode ?? null,
        partyMaterialId: l.partyMaterialId,
        partyMaterialCode: l.partyMaterialCode,
        rmItemCode: l.rmItemCode ?? null,
        partyGrnLineId: null,
        partyGrnCode: null,
        returnableQty: returnable,
      });
    }

    const rejRows = (await tx.execute(sql`
      SELECT pgl.id AS "partyGrnLineId", pg.code AS "partyGrnCode",
             jwl.id AS "jwLineId", jwl.line_no AS "jwLineNo",
             COALESCE(i.code, jwl.item_code_text) AS "partCode",
             pm.id AS "partyMaterialId", pm.code AS "partyMaterialCode",
             COALESCE(ri.code, pm.item_code_text) AS "rmItemCode",
             (pgl.rejected_qty - pgl.rejected_returned_qty)::int AS held
        FROM public.party_grn_lines pgl
        JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
        JOIN public.job_work_order_lines jwl ON jwl.id = pgl.jw_line_id AND jwl.deleted_at IS NULL
        JOIN public.party_materials pm ON pm.id = jwl.party_material_id
        LEFT JOIN public.items i ON i.id = jwl.item_id
        LEFT JOIN public.items ri ON ri.id = pm.item_id
       WHERE jwl.job_work_order_id = ${jobWorkOrderId}::uuid
         AND pgl.company_id = ${companyId}::uuid
         AND pgl.deleted_at IS NULL
         AND pgl.qc_at IS NOT NULL
         AND pgl.rejected_qty - pgl.rejected_returned_qty > 0
       ORDER BY jwl.line_no, pg.code, pgl.line_no
    `)) as unknown as Array<{
      partyGrnLineId: string;
      partyGrnCode: string;
      jwLineId: string;
      jwLineNo: number;
      partCode: string | null;
      partyMaterialId: string;
      partyMaterialCode: string;
      rmItemCode: string | null;
      held: number;
    }>;
    for (const r of rejRows) {
      out.push({
        kind: 'rejected',
        jwLineId: r.jwLineId,
        jwLineNo: Number(r.jwLineNo),
        partCode: r.partCode ?? null,
        partyMaterialId: r.partyMaterialId,
        partyMaterialCode: r.partyMaterialCode,
        rmItemCode: r.rmItemCode ?? null,
        partyGrnLineId: r.partyGrnLineId,
        partyGrnCode: r.partyGrnCode,
        returnableQty: Number(r.held),
      });
    }
    return out;
  });
}

// ── Writes ─────────────────────────────────────────────────────────────────

/** Lock every JWSO line once, in id order — two returns touching the same
 *  lines always queue in the same order, so they cannot deadlock. */
async function lockLines(
  tx: DbTransaction,
  companyId: string,
  lineIds: readonly string[],
): Promise<Map<string, LockedJwLine>> {
  const out = new Map<string, LockedJwLine>();
  for (const lineId of Array.from(new Set(lineIds)).sort()) {
    out.set(lineId, await lockJwLine(tx, companyId, lineId));
  }
  return out;
}

/** Lower party_materials.returned_qty; throws instead of going negative. */
async function lowerReturnedQty(
  tx: DbTransaction,
  partyMaterialId: string,
  qty: number,
  userId: string,
  label: string,
): Promise<void> {
  const rows = (await tx.execute(sql`
    UPDATE public.party_materials
       SET returned_qty = returned_qty - ${qty}, updated_at = now(), updated_by = ${userId}::uuid
     WHERE id = ${partyMaterialId}::uuid AND returned_qty >= ${qty}
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new ConflictError(
      `${label}: the material's Returned total is less than ${qty}, so it cannot be lowered. ` +
        `The customer-material figures disagree — ask an administrator to check this material.`,
    );
  }
}

export async function createCustomerMaterialReturn(
  input: CreateCustomerMaterialReturnInput,
  user: AuthContext,
): Promise<CustomerMaterialReturnDetail> {
  await requireFormAccess(user, 'party_create', 'entry');
  const companyId = requireCompany(user);
  const userId = user.id;
  if (input.lines.length === 0) throw new ValidationError('Add at least one row.');

  return withUserContext(user, async (tx) => {
    const jwRows = (await tx.execute(sql`
      SELECT id, code, client_id AS "clientId"
        FROM public.job_work_orders
       WHERE id = ${input.jobWorkOrderId}::uuid
         AND company_id = ${companyId}::uuid
         AND deleted_at IS NULL
    `)) as unknown as Array<{ id: string; code: string; clientId: string | null }>;
    const jw = jwRows[0];
    if (!jw) throw new NotFoundError('Selected JWSO was not found. Please select the JWSO again.');

    // Lock every JWSO line first (the parent of every cap below). NOT asserted
    // open — the customer's material may go back after a line closes.
    const lines = await lockLines(
      tx,
      companyId,
      input.lines.map((l) => l.jwLineId),
    );
    for (const [idx, ln] of input.lines.entries()) {
      const line = lines.get(ln.jwLineId)!;
      if (line.jobWorkOrderId !== jw.id) {
        throw new ValidationError(
          `Row #${idx + 1}: ${line.jwCode} Ln ${line.lineNo} is not a line of ${jw.code}.`,
        );
      }
      if (!line.partyMaterialId) {
        throw new ValidationError(
          `Row #${idx + 1}: ${line.jwCode} Ln ${line.lineNo} has no customer RM — open and save the JWSO first.`,
        );
      }
      if (ln.kind === 'rejected' && !ln.partyGrnLineId) {
        throw new ValidationError(
          `Row #${idx + 1}: pick the Party GRN the deviated pieces came in on.`,
        );
      }
      if (ln.kind === 'good' && ln.partyGrnLineId) {
        throw new ValidationError(
          `Row #${idx + 1}: a good-material row is not tied to a Party GRN — leave the GRN blank.`,
        );
      }
    }

    const code = await nextReturnCode(tx, companyId);
    const inserted = await tx
      .insert(customerMaterialReturns)
      .values({
        companyId,
        code,
        returnDate: input.returnDate,
        jobWorkOrderId: jw.id,
        clientId: jw.clientId,
        vehicleNo: input.vehicleNo || null,
        remarks: input.remarks || null,
        status: 'issued',
        createdBy: userId,
        updatedBy: userId,
      })
      .returning({ id: customerMaterialReturns.id });
    const header = inserted[0];
    if (!header) throw new ValidationError('Could not save Customer Material Return. Try again.');

    const summary: string[] = [];
    let totalQty = 0;
    for (const [idx, ln] of input.lines.entries()) {
      const line = lines.get(ln.jwLineId)!;
      const partyMaterialId = line.partyMaterialId!;
      const where = `${line.jwCode} Ln ${line.lineNo}`;

      if (ln.kind === 'good') {
        // Recomputed per row: rows inserted above on the same line are already
        // in the sum, so two rows on one line cannot both take the balance.
        const reg = await jwLineRegister(tx, companyId, line.id);
        if (ln.qty > reg.balance) {
          throw new ValidationError(
            `Row #${idx + 1}: Qty (${ln.qty}) cannot be more than the good customer material left ` +
              `for ${where} (${Math.max(0, reg.balance)}) — Accepted ${reg.accepted}, ` +
              `Issued to Job Cards (net of returns to store) ${reg.netIssued}, ` +
              `already Returned to customer ${reg.goodReturned}.`,
          );
        }
        await tx.insert(customerMaterialReturnLines).values({
          companyId,
          returnId: header.id,
          lineNo: idx + 1,
          kind: 'good',
          jwLineId: line.id,
          partyMaterialId,
          partyGrnLineId: null,
          qty: ln.qty,
          createdBy: userId,
          updatedBy: userId,
        });
        // The ledger writer refuses an 'out' beyond the material's stock.
        const move = await postPartyStockMove(tx, {
          companyId,
          partyMaterialId,
          jwLineId: line.id,
          movement: 'return',
          direction: 'out',
          qty: ln.qty,
          sourceDocType: 'customer_material_return',
          sourceDocId: header.id,
          remarks: `${code} · returned to customer (${where})`,
          userId,
          qtyLabel: 'Return Qty',
        });
        await tx.execute(sql`
          UPDATE public.party_materials
             SET returned_qty = returned_qty + ${ln.qty}, updated_at = now(), updated_by = ${userId}::uuid
           WHERE id = ${partyMaterialId}::uuid
        `);
        summary.push(`${where} good ${ln.qty} of ${move.partyMaterialCode}`);
      } else {
        const grnRows = (await tx.execute(sql`
          SELECT pgl.id, pgl.jw_line_id AS "jwLineId", pgl.qc_at AS "qcAt",
                 pgl.rejected_qty::int AS "rejectedQty",
                 pgl.rejected_returned_qty::int AS "rejectedReturnedQty",
                 pg.code AS "grnCode"
            FROM public.party_grn_lines pgl
            JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
           WHERE pgl.id = ${ln.partyGrnLineId!}::uuid
             AND pgl.company_id = ${companyId}::uuid
             AND pgl.deleted_at IS NULL
           FOR UPDATE OF pgl
        `)) as unknown as Array<{
          id: string;
          jwLineId: string | null;
          qcAt: unknown;
          rejectedQty: number;
          rejectedReturnedQty: number;
          grnCode: string;
        }>;
        const g = grnRows[0];
        if (!g) {
          throw new NotFoundError(
            `Row #${idx + 1}: the Party GRN line was not found — it may have been cancelled. Refresh and pick again.`,
          );
        }
        if (g.jwLineId !== line.id) {
          throw new ValidationError(
            `Row #${idx + 1}: ${g.grnCode} did not receive material for ${where}.`,
          );
        }
        if (g.qcAt == null) {
          throw new ValidationError(
            `Row #${idx + 1}: ${g.grnCode} is still waiting for Incoming QC — nothing is deviated yet.`,
          );
        }
        // Cap in the WHERE: 0 rows = the held pieces were taken by someone else.
        const bumped = (await tx.execute(sql`
          UPDATE public.party_grn_lines
             SET rejected_returned_qty = rejected_returned_qty + ${ln.qty},
                 updated_at = now(), updated_by = ${userId}::uuid
           WHERE id = ${g.id}::uuid
             AND deleted_at IS NULL
             AND rejected_returned_qty + ${ln.qty} <= rejected_qty
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        if (bumped.length === 0) {
          const held = Number(g.rejectedQty) - Number(g.rejectedReturnedQty);
          throw new ConflictError(
            `Row #${idx + 1}: Qty (${ln.qty}) cannot be more than the deviated pieces still held on ` +
              `${g.grnCode} for ${where} (${Math.max(0, held)}) — Deviated ${g.rejectedQty}, ` +
              `already returned ${g.rejectedReturnedQty}.`,
          );
        }
        await tx.insert(customerMaterialReturnLines).values({
          companyId,
          returnId: header.id,
          lineNo: idx + 1,
          kind: 'rejected',
          jwLineId: line.id,
          partyMaterialId,
          partyGrnLineId: g.id,
          qty: ln.qty,
          createdBy: userId,
          updatedBy: userId,
        });
        summary.push(`${where} deviated ${ln.qty} (${g.grnCode})`);
      }
      totalQty += ln.qty;
    }

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Create,
        entity: ENTITY,
        entityId: header.id,
        refId: code,
        qty: totalQty,
        detail: `${code} · ${input.lines.length} line(s), ${totalQty} pcs back to the customer against ${jw.code}: ${summary.join('; ')}`,
      },
      companyId,
      user,
    );

    return loadDetail(tx, companyId, header.id);
  });
}

export async function cancelCustomerMaterialReturn(
  id: string,
  reason: string,
  user: AuthContext,
): Promise<CustomerMaterialReturnDetail> {
  // Cancel puts material back on our books — the pair only L5/L6 hold.
  await requireFormAccess(user, 'party_create', 'edit');
  await requireFormAccess(user, 'party_create', 'approve');
  const companyId = requireCompany(user);
  const trimmed = (reason ?? '').trim();
  if (!trimmed)
    throw new ValidationError('Reason is required to cancel a Customer Material Return.');

  return withUserContext(user, async (tx) => {
    // §20.2: the status flip IS the guard — 0 rows means it is not 'issued'.
    const flipped = (await tx.execute(sql`
      UPDATE public.customer_material_returns
         SET status = 'cancelled', cancel_reason = ${trimmed}, cancelled_at = now(),
             cancelled_by = ${user.id}::uuid, updated_at = now(), updated_by = ${user.id}::uuid
       WHERE id = ${id}::uuid
         AND company_id = ${companyId}::uuid
         AND deleted_at IS NULL
         AND status = 'issued'
      RETURNING code
    `)) as unknown as Array<{ code: string }>;
    const head = flipped[0];
    if (!head) {
      const now = (await tx.execute(sql`
        SELECT r.code, r.status, r.cancelled_at AS "cancelledAt", u.full_name AS "byName"
          FROM public.customer_material_returns r
          LEFT JOIN public.users u ON u.id = r.cancelled_by
         WHERE r.id = ${id}::uuid AND r.company_id = ${companyId}::uuid AND r.deleted_at IS NULL
      `)) as unknown as Array<{
        code: string;
        status: string;
        cancelledAt: unknown;
        byName: string | null;
      }>;
      const n = now[0];
      if (!n) throw new NotFoundError('Customer Material Return not found. Refresh the page.');
      throw new ConflictError(
        `${n.code} is already cancelled` +
          (n.byName ? ` by ${n.byName}` : '') +
          (n.cancelledAt != null ? ` at ${tsLike(n.cancelledAt)}` : '') +
          `. Refresh the page.`,
      );
    }

    const lineRows = (await tx.execute(sql`
      SELECT l.id, l.kind, l.jw_line_id AS "jwLineId", l.party_material_id AS "partyMaterialId",
             l.party_grn_line_id AS "partyGrnLineId", l.qty::int AS qty, pm.code AS "pmCode"
        FROM public.customer_material_return_lines l
        LEFT JOIN public.party_materials pm ON pm.id = l.party_material_id
       WHERE l.return_id = ${id}::uuid AND l.deleted_at IS NULL
       ORDER BY l.line_no
    `)) as unknown as Array<{
      id: string;
      kind: string;
      jwLineId: string;
      partyMaterialId: string;
      partyGrnLineId: string | null;
      qty: number;
      pmCode: string | null;
    }>;

    await lockLines(
      tx,
      companyId,
      lineRows.map((l) => l.jwLineId),
    );

    let reversedQty = 0;
    for (const l of lineRows) {
      const qty = Number(l.qty);
      if (l.kind === 'good') {
        await postPartyStockMove(tx, {
          companyId,
          partyMaterialId: l.partyMaterialId,
          jwLineId: l.jwLineId,
          movement: 'reversal',
          direction: 'in',
          qty,
          sourceDocType: 'customer_material_return',
          sourceDocId: id,
          remarks: `${head.code} cancelled: ${trimmed}`,
          userId: user.id,
          qtyLabel: 'Reversal Qty',
        });
        await lowerReturnedQty(tx, l.partyMaterialId, qty, user.id, l.pmCode ?? head.code);
      } else {
        if (!l.partyGrnLineId) {
          throw new ConflictError(
            `${head.code}: a deviated row has no Party GRN line — cannot reverse it.`,
          );
        }
        const lowered = (await tx.execute(sql`
          UPDATE public.party_grn_lines
             SET rejected_returned_qty = rejected_returned_qty - ${qty},
                 updated_at = now(), updated_by = ${user.id}::uuid
           WHERE id = ${l.partyGrnLineId}::uuid AND rejected_returned_qty >= ${qty}
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        if (lowered.length === 0) {
          throw new ConflictError(
            `${head.code}: the Party GRN line's returned-deviated total is less than ${qty}, so it cannot be lowered. ` +
              `Ask an administrator to check this GRN.`,
          );
        }
      }
      reversedQty += qty;
    }

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Cancel,
        entity: ENTITY,
        entityId: id,
        refId: head.code,
        qty: reversedQty,
        reason: trimmed,
        changes: [
          { field: 'status', label: 'Return Status', before: 'issued', after: 'cancelled' },
        ],
        detail: `${head.code} cancelled — ${reversedQty} pcs back on our books`,
      },
      companyId,
      user,
    );

    return loadDetail(tx, companyId, id);
  });
}
