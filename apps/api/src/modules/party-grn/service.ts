// Party Material GRN service (Store slice 2; reworked by ADR-203).
//
// Records client-supplied raw material received against a JWSO. Multi-line per
// receipt. ADR-203 split the receipt into two steps:
//   1. create (this file) — the gate-in: which JWSO line, how many pieces came.
//      NOTHING enters the customer-material register here; every line waits for
//      Incoming QC with accepted = rejected = 0 and qc_at NULL.
//      Incoming QC may take a line in parts (0233): QC Pending Qty =
//      received − accepted − rejected (./qc-state.ts).
//   2. QC (./qc.ts) — books accepted / rejected per line; only the accepted qty
//      is posted to the register (lib/party-stock-ledger, the one writer).
// The customer material of a line is the JWSO line's own `<item>-RM` party
// material (lib/jw-rm) — it is never picked separately, so it cannot mismatch.

import { type SQL, and, eq, isNull, sql } from 'drizzle-orm';
import type {
  CancelBlocker,
  CancelEffect,
  CreatePartyGrnInput,
  DocumentEditStagedResult,
  ListPartyGrnQuery,
  ListPartyGrnResponse,
  PartyGrn,
  PartyGrnDetail,
  PartyGrnLine,
  PartyGrnListItem,
} from '@innovic/shared';
import {
  clients,
  jobWorkOrderLines,
  jobWorkOrders,
  partyGrn,
  partyGrnLines,
  partyMaterials,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess, requireFormAccess } from '../../lib/access';
import { blockerRefusal } from '../cancel-requests/messages';
import { assertNoPendingCancel } from '../cancel-requests/pending-guard';
import { ActivityAction, NC_STATUS_LABELS } from '@innovic/shared';
import { type DiffField, diffFields, softDeleteStamp } from '../../lib/audit-trail';
import type { UpdatePartyGrnInput } from './schema';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { lockDocSeries } from '../../lib/doc-series-lock';
import { assertPartyGrnDcNoFree } from '../../lib/party-grn-dc-unique';
import { assertJwLineOpenForWork, type LockedJwLine, lockJwLine } from '../../lib/jw-line-state';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { postPartyStockMove } from '../../lib/party-stock-ledger';
import { labelOf } from '../../lib/status-labels';
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

// Partial Incoming QC (0233): the two line predicates live in ./qc-state.ts —
// QC untouched (edit / stage gate only) and QC open (QC Pending Qty > 0).
import {
  QC_OPEN_SQL,
  QC_PENDING_QTY_SQL,
  isQcOpen,
  isQcUntouched,
  qcPendingQtyOf,
  qcUntouchedCond,
} from './qc-state';

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

/** The lines that belong to header `pg` as it stands: a live GRN's live lines;
 *  a cancelled GRN's lines cancelled WITH it (the cancel stamps header and
 *  lines with one deleted_at — a line removed earlier keeps its own, older
 *  stamp and does not come back). For a live header this is exactly
 *  `pgl.deleted_at IS NULL`. */
export const PGL_OF_HEADER_SQL = sql.raw(
  '(pgl.deleted_at IS NULL OR (pg.deleted_at IS NOT NULL AND pgl.deleted_at = pg.deleted_at))',
);

/** Per-GRN line roll-up, shared by the list rows and the summary. A cancelled
 *  GRN waits for nothing, so its lines never count as waiting for QC. */
export const LINE_AGG_SQL = sql`
  LEFT JOIN LATERAL (
    SELECT SUM(pgl.received_qty)::int AS total_received,
           SUM(pgl.accepted_qty)::int AS total_accepted,
           COUNT(*) FILTER (WHERE ${QC_OPEN_SQL} AND pgl.deleted_at IS NULL)::int
             AS qc_pending_lines,
           COALESCE(SUM(${QC_PENDING_QTY_SQL}) FILTER (WHERE pgl.deleted_at IS NULL), 0)::int
             AS total_qc_pending,
           COUNT(*)::int AS lines_count
    FROM public.party_grn_lines pgl
    WHERE pgl.party_grn_id = pg.id AND ${PGL_OF_HEADER_SQL}
  ) agg ON true`;

/** ADR-235: live GRNs, plus — when the list / detail asks — the Cancelled ones. */
export function headerScopeSql(includeCancelled: boolean): SQL {
  return includeCancelled
    ? sql`(pg.deleted_at IS NULL OR pg.cancelled_at IS NOT NULL)`
    : sql`pg.deleted_at IS NULL`;
}

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
              AND ${PGL_OF_HEADER_SQL}
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
    const scopeFrag = headerScopeSql(input.includeCancelled === true);
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
        pg.cancel_reason AS "cancelReason", pg.cancelled_at AS "cancelledAt",
        c.name AS "clientName",
        COALESCE(agg.total_received, 0)::int AS "totalReceivedQty",
        COALESCE(agg.total_accepted, 0)::int AS "totalAcceptedQty",
        COALESCE(agg.qc_pending_lines, 0)::int AS "qcPendingLines",
        COALESCE(agg.total_qc_pending, 0)::int AS "totalQcPendingQty",
        COALESCE(agg.lines_count, 0)::int AS "linesCount"
      FROM public.party_grn pg
      LEFT JOIN public.clients c ON c.id = pg.client_id AND c.deleted_at IS NULL
      ${LINE_AGG_SQL}
      WHERE pg.company_id = ${companyId}::uuid
        AND ${scopeFrag}
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
    // ADR-235: `total` (the pager) counts every listed row; the summary figures
    // count live GRNs only — a Cancelled GRN received nothing.
    const sumRows = (await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total_rows,
        COUNT(*) FILTER (WHERE pg.deleted_at IS NULL)::int AS total_grns,
        COALESCE(SUM(agg.total_received) FILTER (WHERE pg.deleted_at IS NULL), 0)::int
          AS total_received,
        COUNT(*) FILTER (
          WHERE pg.deleted_at IS NULL
            AND pg.grn_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
        )::int AS today_count
      FROM public.party_grn pg
      LEFT JOIN public.clients c ON c.id = pg.client_id AND c.deleted_at IS NULL
      ${LINE_AGG_SQL}
      WHERE pg.company_id = ${companyId}::uuid
        AND ${scopeFrag}
        ${searchFrag}
        ${jwFrag}
        ${clientFrag}
        ${fromFrag}
        ${toFrag}
        ${sfFrag}
    `)) as unknown as Array<Record<string, unknown>>;
    const sum = sumRows[0] ?? {};
    const total = Number(sum['total_rows'] ?? 0);
    const summary = {
      totalGrns: Number(sum['total_grns'] ?? 0),
      totalReceived: Number(sum['total_received'] ?? 0),
      today: Number(sum['today_count'] ?? 0),
    };

    const itemsOut = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items: itemsOut, total, limit: input.limit, offset: input.offset, summary };
  });
}

export function toListItem(r: Record<string, unknown>): PartyGrnListItem {
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
    cancelReason: (r['cancelReason'] as string | null) ?? null,
    cancelledAt: r['cancelledAt'] != null ? tsLike(r['cancelledAt']) : null,
    clientName: (r['clientName'] as string | null) ?? null,
    totalReceivedQty: Number(r['totalReceivedQty'] ?? 0),
    totalAcceptedQty: Number(r['totalAcceptedQty'] ?? 0),
    qcPendingLines: Number(r['qcPendingLines'] ?? 0),
    totalQcPendingQty: Number(r['totalQcPendingQty'] ?? 0),
    linesCount: Number(r['linesCount'] ?? 0),
  };
}

/** Header + lines of one live Party GRN, inside the caller's transaction (the
 *  QC step returns it without needing the Party read gate a second time).
 *  `includeCancelled` (the detail page only, ADR-235) also returns a Cancelled
 *  GRN, read-only, with the lines cancelled with it. */
export async function loadPartyGrnDetail(
  tx: DbTransaction,
  companyId: string,
  id: string,
  opts: { includeCancelled?: boolean } = {},
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
      pg.cancel_reason AS "cancelReason", pg.cancelled_at AS "cancelledAt",
      c.name AS "clientName"
    FROM public.party_grn pg
    LEFT JOIN public.clients c ON c.id = pg.client_id AND c.deleted_at IS NULL
    WHERE pg.id = ${id}::uuid
      AND pg.company_id = ${companyId}::uuid
      AND ${headerScopeSql(opts.includeCancelled === true)}
    LIMIT 1
  `);
  const hRow = (headerRows as unknown as Array<Record<string, unknown>>)[0];
  if (!hRow) throw new NotFoundError('Party GRN not found. Refresh the page.');
  const isCancelled = hRow['deletedAt'] != null;

  // ADR-236: POL off the JWSO line each GRN line was received against.
  // LEFT JOIN on the JWSO line's primary key (pgl.jw_line_id is a single FK),
  // so it can never multiply the GRN lines; no deleted_at filter, matching the
  // QC register's read of the same line (qc-history/register-party.ts).
  const joined = await tx
    .select({ line: partyGrnLines, clientPoLineNo: jobWorkOrderLines.clientPoLineNo })
    .from(partyGrnLines)
    .leftJoin(jobWorkOrderLines, eq(jobWorkOrderLines.id, partyGrnLines.jwLineId))
    .where(
      and(
        eq(partyGrnLines.partyGrnId, id),
        eq(partyGrnLines.companyId, companyId),
        // A cancelled GRN: the lines cancelled with it (same deleted_at stamp).
        isCancelled
          ? sql`${partyGrnLines.deletedAt} = (
              SELECT pgh.deleted_at FROM public.party_grn pgh WHERE pgh.id = ${id}::uuid
            )`
          : isNull(partyGrnLines.deletedAt),
      ),
    )
    .orderBy(partyGrnLines.lineNo);
  // A cancelled GRN waits for nothing: its lines show no QC Pending Qty.
  const open = joined.filter((r) => !isCancelled && isQcOpen(r.line)).length;
  const lines: PartyGrnLine[] = joined.map((r) => {
    const l = rowToLine(r.line, r.clientPoLineNo ?? null);
    return isCancelled ? { ...l, qcPendingQty: 0 } : l;
  });
  return {
    ...toListItem(hRow),
    totalReceivedQty: lines.reduce((s, l) => s + l.receivedQty, 0),
    totalAcceptedQty: lines.reduce((s, l) => s + l.acceptedQty, 0),
    qcPendingLines: open,
    totalQcPendingQty: lines.reduce((s, l) => s + l.qcPendingQty, 0),
    linesCount: lines.length,
    lines,
  };
}

export async function getPartyGrnDetail(id: string, user: AuthContext): Promise<PartyGrnDetail> {
  await requirePartyGrnRead(user);
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) =>
    loadPartyGrnDetail(tx, companyId, id, { includeCancelled: true }),
  );
}

function rowToLine(
  row: typeof partyGrnLines.$inferSelect,
  clientPoLineNo: string | null,
): PartyGrnLine {
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
    clientPoLineNo,
    acceptedQty: row.acceptedQty,
    rejectedQty: row.rejectedQty,
    rejectReason: row.rejectReason,
    qcRemarks: row.qcRemarks,
    qcBy: row.qcBy,
    qcAt: row.qcAt != null ? tsLike(row.qcAt) : null,
    // ADR-203 (D3): rejected pieces already sent back on a Customer Material Return.
    rejectedReturnedQty: row.rejectedReturnedQty,
    // Partial Incoming QC (0233): received − accepted − rejected.
    qcPendingQty: qcPendingQtyOf(row),
    remarks: row.remarks,
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt != null ? tsLike(row.deletedAt) : null,
  };
}

/** THE committed-qty rule (ADR-203, widened by ADR-247) — what a JWSO line has
 *  already taken in from the customer, as ONE scalar SQL expression over the
 *  line id `jwLineIdSql` (a bound `${id}::uuid` or a correlated column such as
 *  `l.id`). Every reader uses this — the Party GRN receipt cap, the JWSO
 *  "receivable" picker filter and the Order Qty floor — so they cannot drift:
 *    Σ (received − rejected) on live lines — partial Incoming QC (0233): the
 *    accepted pieces PLUS the pieces still waiting for QC (a line received 60,
 *    6 accepted, counts 60; an untouched line counts its received; a fully
 *    inspected one its accepted)
 *  + Σ rejected_qty of live NCs still 'pending' raised on a live line of a
 *    live Party GRN for this JWSO line (ADR-247: deviated pieces stay
 *    committed until the NC is decided; Return to Customer / Scrap reopen the
 *    line, Use As Is moves the pieces into accepted).
 *  Other deviated pieces do not use up the order (the customer re-sends). */
export function partyCommittedQtySql(jwLineIdSql: SQL): SQL {
  return sql`((
      SELECT COALESCE(SUM(pgl.received_qty - pgl.rejected_qty), 0)
        FROM public.party_grn_lines pgl
        JOIN public.party_grn pgc ON pgc.id = pgl.party_grn_id AND pgc.deleted_at IS NULL
       WHERE pgl.jw_line_id = ${jwLineIdSql} AND pgl.deleted_at IS NULL
    ) + (
      SELECT COALESCE(SUM(ncc.rejected_qty), 0)
        FROM public.nc_register ncc
        JOIN public.party_grn_lines pglc ON pglc.id = ncc.party_grn_line_id
             AND pglc.deleted_at IS NULL
        JOIN public.party_grn pgn ON pgn.id = pglc.party_grn_id AND pgn.deleted_at IS NULL
       WHERE pglc.jw_line_id = ${jwLineIdSql}
         AND ncc.deleted_at IS NULL
         AND ncc.status = 'pending'
    ))::int`;
}

/** The committed qty of one JWSO line (partyCommittedQtySql). Call ONLY under
 *  lockJwLine for that line (CLAUDE.md §20.3). */
export async function jwLineCommittedQty(tx: DbTransaction, jwLineId: string): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT ${partyCommittedQtySql(sql`${jwLineId}::uuid`)} AS qty
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
            `Deviated pieces do not count.`,
        );
      }
    }

    // 5) Header. Customer Challan No. must be free for this customer (§20 lock
    //    inside the helper serialises two saves of the same number).
    await assertPartyGrnDcNoFree(tx, companyId, jw.clientId ?? null, input.dcNo);
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

// ─── Cancel (ADR-102 / ADR-203; ADR-235: only via an approved Cancel Request) ─
//
// Soft-deletes the header + lines (one deleted_at stamp, so a cancelled GRN's
// own lines are exactly those carrying its header's deleted_at) and records
// cancel_reason / cancelled_at / cancelled_by on the header (0218) — the list
// shows it as Cancelled. Lines already through Incoming QC have their accepted
// qty taken back out of the register (a 'reversal'/out row per line, carrying
// its JWSO line); lines still waiting for QC never entered it and are just
// cancelled. Refused (partyGrnCancelBlockers) when rejected pieces were already
// sent back to the customer, or when the accepted pieces have moved on (issued
// to a Job Card or returned) — reverse those first. ADR-247: every live NC
// raised on its lines that is not already closed is closed with the GRN (an
// already-closed one — scrapped — stays as it is). Use As Is pieces were moved
// into accepted_qty, so the register reversal below (with its balance check)
// takes them back too. One transaction; nothing partly applied.

/** Read the Party GRN header — cancelled ones included (a cancel stamps
 *  deleted_at). `forUpdate` locks it (request / approve / the worker); the
 *  preview reads without a lock. null = not in this company. */
export async function lockPartyGrnForCancel(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<{
  id: string;
  code: string;
  deletedAt: unknown;
  cancelledAt: unknown;
} | null> {
  const rows = (await tx.execute(sql`
    SELECT id, code, deleted_at AS "deletedAt", cancelled_at AS "cancelledAt"
      FROM public.party_grn
     WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
     ${forUpdate ? sql`FOR UPDATE` : sql``}
  `)) as unknown as Array<{ id: string; code: string; deletedAt: unknown; cancelledAt: unknown }>;
  return rows[0] ?? null;
}

/** The live lines a cancel reads (blockers, effects and the worker alike). */
async function partyGrnCancelLines(tx: DbTransaction, companyId: string, id: string) {
  return tx
    .select({
      id: partyGrnLines.id,
      lineNo: partyGrnLines.lineNo,
      jwLineId: partyGrnLines.jwLineId,
      partyMaterialId: partyGrnLines.partyMaterialId,
      partyMaterialCodeText: partyGrnLines.partyMaterialCodeText,
      receivedQty: partyGrnLines.receivedQty,
      acceptedQty: partyGrnLines.acceptedQty,
      rejectedQty: partyGrnLines.rejectedQty,
      rejectedReturnedQty: partyGrnLines.rejectedReturnedQty,
      qcAt: partyGrnLines.qcAt,
    })
    .from(partyGrnLines)
    .where(
      and(
        eq(partyGrnLines.partyGrnId, id),
        eq(partyGrnLines.companyId, companyId),
        isNull(partyGrnLines.deletedAt),
      ),
    )
    .orderBy(partyGrnLines.lineNo);
}

type PartyGrnCancelLine = Awaited<ReturnType<typeof partyGrnCancelLines>>[number];

/** Only QC'd lines put anything into the register. */
function linesToReverse(lines: readonly PartyGrnCancelLine[]): PartyGrnCancelLine[] {
  return lines.filter((l) => !isQcUntouched(l) && l.acceptedQty > 0 && l.partyMaterialId != null);
}

/** Σ accepted this GRN put in, per JWSO line + material (legacy lines with no
 *  JWSO link get the material-level check of the ledger writer only). */
function needByJwLine(
  toReverse: readonly PartyGrnCancelLine[],
): Map<string, { jwLineId: string; qty: number; pmId: string; code: string }> {
  const out = new Map<string, { jwLineId: string; qty: number; pmId: string; code: string }>();
  for (const l of toReverse) {
    if (l.jwLineId == null) continue;
    const key = `${l.jwLineId}|${l.partyMaterialId}`;
    const prev = out.get(key);
    out.set(key, {
      jwLineId: l.jwLineId,
      qty: (prev?.qty ?? 0) + l.acceptedQty,
      pmId: l.partyMaterialId!,
      code: l.partyMaterialCodeText,
    });
  }
  return out;
}

/**
 * THE Party GRN cancel refusal rule (one place — the worker, under its locks,
 * and the Cancel preview both call it). Each blocker names the document that
 * must be undone first:
 *  · deviated pieces of a line already sent back on a live Customer Material
 *    Return — cancel that return first;
 *  · a JWSO line's register balance cannot absorb what this GRN put in — the
 *    pieces were issued to a Job Card (Party Material Issue) or returned to
 *    the customer (Customer Material Return); every live one holding that
 *    material on that line is named.
 * A count with no document behind it is reported as out of step.
 */
export async function partyGrnCancelBlockers(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelBlocker[]> {
  const out: CancelBlocker[] = [];
  const lines = await partyGrnCancelLines(tx, companyId, id);

  // 1) Deviated pieces already handed back cannot be un-received.
  const sentBack = lines.filter((l) => l.rejectedReturnedQty > 0);
  if (sentBack.length > 0) {
    const cmrs = (await tx.execute(sql`
      SELECT cl.party_grn_line_id AS "lineId", r.id AS "cmrId", r.code AS "cmrCode",
             SUM(cl.qty)::int AS qty
        FROM public.customer_material_return_lines cl
        JOIN public.customer_material_returns r ON r.id = cl.return_id
       WHERE cl.party_grn_line_id IN (${sql.join(
         sentBack.map((l) => sql`${l.id}::uuid`),
         sql`, `,
       )})
         AND cl.kind = 'rejected' AND cl.deleted_at IS NULL
         AND r.company_id = ${companyId}::uuid
         AND r.deleted_at IS NULL AND r.status <> 'cancelled'
       GROUP BY cl.party_grn_line_id, r.id, r.code
       ORDER BY r.code
    `)) as unknown as Array<{ lineId: string; cmrId: string; cmrCode: string; qty: number }>;
    for (const l of sentBack) {
      const mine = cmrs.filter((c) => c.lineId === l.id);
      for (const c of mine) {
        out.push({
          docLabel: 'Customer Material Return',
          docNo: c.cmrCode,
          href: '/customer-material-returns',
          reason: `sent back ${Number(c.qty)} deviated pcs of Ln ${l.lineNo}`,
        });
      }
      if (mine.length === 0) {
        out.push({
          docLabel: 'Party GRN',
          docNo: `Ln ${l.lineNo}`,
          href: null,
          reason:
            `its Returned deviated count (${l.rejectedReturnedQty}) has no live Customer Material ` +
            `Return behind it — the count is out of step; report this to the administrator`,
        });
      }
    }
  }

  // 2) The register must still hold what this GRN put in, per JWSO line.
  for (const need of needByJwLine(linesToReverse(lines)).values()) {
    const balance = await jwLineRegisterBalance(tx, need.jwLineId, need.pmId);
    if (balance >= need.qty) continue;
    const jl = (
      (await tx.execute(sql`
        SELECT l.line_no AS "lineNo", jw.id AS "jwId", jw.code AS "jwCode"
          FROM public.job_work_order_lines l
          JOIN public.job_work_orders jw ON jw.id = l.job_work_order_id
         WHERE l.id = ${need.jwLineId}::uuid
      `)) as unknown as Array<{ lineNo: number; jwId: string; jwCode: string }>
    )[0];
    const where = jl ? `${jl.jwCode} Ln ${jl.lineNo}` : 'its JWSO line';
    const tail = `— this GRN needs ${need.qty} back, only ${balance} left in the register`;
    const issues = (await tx.execute(sql`
      SELECT mi.code, mi.jc_code_text AS "jcCode",
             (mi.qty - mi.returned_to_store_qty)::int AS net
        FROM public.party_material_issues mi
       WHERE mi.jw_line_id = ${need.jwLineId}::uuid
         AND mi.party_material_id = ${need.pmId}::uuid
         AND mi.company_id = ${companyId}::uuid
         AND mi.deleted_at IS NULL
         AND mi.qty - mi.returned_to_store_qty > 0
       ORDER BY mi.code
    `)) as unknown as Array<{ code: string; jcCode: string | null; net: number }>;
    const returns = (await tx.execute(sql`
      SELECT r.code, SUM(cl.qty)::int AS qty
        FROM public.customer_material_return_lines cl
        JOIN public.customer_material_returns r ON r.id = cl.return_id
       WHERE cl.jw_line_id = ${need.jwLineId}::uuid
         AND cl.party_material_id = ${need.pmId}::uuid
         AND cl.kind = 'good' AND cl.deleted_at IS NULL
         AND r.company_id = ${companyId}::uuid
         AND r.deleted_at IS NULL AND r.status <> 'cancelled'
       GROUP BY r.code
       ORDER BY r.code
    `)) as unknown as Array<{ code: string; qty: number }>;
    for (const mi of issues) {
      out.push({
        docLabel: 'Party Material Issue',
        docNo: mi.code,
        href: null,
        reason: `issued ${Number(mi.net)} of ${need.code} (${where}) to ${mi.jcCode ?? 'a Job Card'} ${tail}`,
      });
    }
    for (const r of returns) {
      out.push({
        docLabel: 'Customer Material Return',
        docNo: r.code,
        href: '/customer-material-returns',
        reason: `returned ${Number(r.qty)} of ${need.code} (${where}) to the customer ${tail}`,
      });
    }
    if (issues.length === 0 && returns.length === 0) {
      out.push({
        docLabel: 'JWSO',
        docNo: where,
        href: jl ? `/job-work-orders/${jl.jwId}` : null,
        reason:
          `its customer material register holds only ${balance} of ${need.code}, less than the ` +
          `${need.qty} this GRN put in, with no issue or return to explain it — the figures are out ` +
          `of step; report this to the administrator`,
      });
    }
  }
  return out;
}

/** What the cancel will do — the Cancel preview's lines. */
export async function partyGrnCancelEffects(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelEffect[]> {
  const lines = await partyGrnCancelLines(tx, companyId, id);
  if (lines.length === 0) return [];
  const jwIds = Array.from(new Set(lines.flatMap((l) => (l.jwLineId ? [l.jwLineId] : []))));
  const jwLines =
    jwIds.length > 0
      ? ((await tx.execute(sql`
          SELECT l.id, l.line_no AS "lineNo", jw.code AS "jwCode"
            FROM public.job_work_order_lines l
            JOIN public.job_work_orders jw ON jw.id = l.job_work_order_id
           WHERE l.id IN (${sql.join(
             jwIds.map((x) => sql`${x}::uuid`),
             sql`, `,
           )})
        `)) as unknown as Array<{ id: string; lineNo: number; jwCode: string }>)
      : [];
  const jwById = new Map(jwLines.map((j) => [j.id, j]));
  const ncs = (await tx.execute(sql`
    SELECT nc.code, nc.status::text AS status, nc.rejected_qty::int AS "rejectedQty",
           nc.party_grn_line_id AS "lineId"
      FROM public.nc_register nc
      JOIN public.party_grn_lines pgl ON pgl.id = nc.party_grn_line_id
     WHERE pgl.party_grn_id = ${id}::uuid
       AND pgl.deleted_at IS NULL
       AND nc.company_id = ${companyId}::uuid
       AND nc.deleted_at IS NULL
       AND nc.status <> 'closed'
     ORDER BY nc.code
  `)) as unknown as Array<{ code: string; status: string; rejectedQty: number; lineId: string }>;

  const out: CancelEffect[] = [];
  for (const l of lines) {
    const at = `Ln ${l.lineNo} ${l.partyMaterialCodeText}`;
    if (l.acceptedQty > 0 && l.partyMaterialId != null) {
      out.push({
        kind: 'stock',
        text: `${at} — ${l.acceptedQty} leaves the customer material register`,
        qty: -l.acceptedQty,
      });
    }
    // What the line held against its JWSO line's Order Qty (partyCommittedQtySql):
    // received − rejected (accepted + still waiting for QC, partial QC 0233)
    // + pieces of a pending NC.
    const committed =
      l.receivedQty -
      l.rejectedQty +
      ncs
        .filter((n) => n.lineId === l.id && n.status === 'pending')
        .reduce((s, n) => s + Number(n.rejectedQty), 0);
    const jl = l.jwLineId ? jwById.get(l.jwLineId) : undefined;
    if (jl && committed > 0) {
      out.push({
        kind: 'reopen',
        text: `${jl.jwCode} Ln ${jl.lineNo} — ${committed} pcs can be received from the customer again`,
        qty: committed,
      });
    }
  }
  for (const nc of ncs) {
    out.push({ kind: 'note', text: `${nc.code} will be closed`, qty: null });
  }
  return out;
}

/**
 * The ONE Party GRN cancel writer, run only by an approved Cancel Request
 * (ADR-235). In-tx body, no rights check — the Cancel Request checks the ticks.
 */
export async function cancelPartyGrnTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  reason: string,
  user: AuthContext,
): Promise<{ code: string; reversedQty: number }> {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ValidationError('Reason is required to cancel a Party GRN.');

  // Lock the header, THEN re-check it is live — two cancels (or a cancel and
  // a QC) on the same GRN queue here and the second one sees deleted_at.
  const head = await lockPartyGrnForCancel(tx, companyId, id, true);
  if (!head) throw new NotFoundError('Party GRN not found. Refresh the page.');
  if (head.deletedAt != null || head.cancelledAt != null) {
    throw new ConflictError(`${head.code} is already cancelled. Refresh the page.`);
  }

  // ADR-247: the NCs raised on its lines, locked BEFORE the lines (an NC
  // disposition locks the NC first too, so the two queue instead of crossing).
  const ncs = (await tx.execute(sql`
    SELECT nc.id, nc.code, nc.status::text AS status, nc.rejected_qty::int AS "rejectedQty"
      FROM public.nc_register nc
      JOIN public.party_grn_lines pgl ON pgl.id = nc.party_grn_line_id
     WHERE pgl.party_grn_id = ${id}::uuid
       AND pgl.deleted_at IS NULL
       AND nc.company_id = ${companyId}::uuid
       AND nc.deleted_at IS NULL
       AND nc.status <> 'closed'
     ORDER BY nc.id
     FOR UPDATE OF nc
  `)) as unknown as Array<{ id: string; code: string; status: string; rejectedQty: number }>;

  // Code review fix: lock the lines — a Customer Material Return taking their
  // rejected pieces locks the same rows, so the two serialise.
  await tx
    .select({ id: partyGrnLines.id })
    .from(partyGrnLines)
    .where(and(eq(partyGrnLines.partyGrnId, id), isNull(partyGrnLines.deletedAt)))
    .orderBy(partyGrnLines.lineNo)
    .for('update');
  const lines = await partyGrnCancelLines(tx, companyId, id);
  const toReverse = linesToReverse(lines);

  // Lock the JWSO lines (id order) so no issue / return can move the register
  // between the refusal rule below and the reversal.
  const jwLineIds = Array.from(
    new Set(toReverse.flatMap((l) => (l.jwLineId ? [l.jwLineId] : []))),
  ).sort();
  for (const lineId of jwLineIds) await lockJwLine(tx, companyId, lineId);

  // The refusal rule, under the locks — before anything moves.
  const blockers = await partyGrnCancelBlockers(tx, companyId, id);
  if (blockers.length > 0) {
    throw new ConflictError(blockerRefusal(head.code, blockers), { blockers });
  }

  // Post one reversal per QC'd line; the writer refuses if the material's
  // overall balance cannot cover it.
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

  // ADR-247: close every still-open NC on its lines (§20.2 — conditional on
  // the status read under the lock above; 0 rows = it moved, stop the cancel).
  const ncNote = `Party GRN ${head.code} cancelled`;
  for (const nc of ncs) {
    const closed = (await tx.execute(sql`
      UPDATE public.nc_register
         SET status = 'closed',
             -- Nothing left open on it: the receipt it came from is void.
             failed_qty = rejected_qty - cleared_qty,
             disposition_remarks = ${ncNote},
             closed_at = now(), closed_by = ${user.id}::uuid,
             updated_at = now(), updated_by = ${user.id}::uuid
       WHERE id = ${nc.id}::uuid AND status::text = ${nc.status} AND deleted_at IS NULL
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    if (closed.length === 0) {
      throw new ConflictError(`NC ${nc.code} changed a moment ago. Refresh the page.`);
    }
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Close,
        entity: 'NonConformance',
        entityId: nc.id,
        refId: nc.code,
        qty: nc.rejectedQty,
        changes: [
          {
            field: 'status',
            label: 'Status',
            before: labelOf(NC_STATUS_LABELS, nc.status),
            after: labelOf(NC_STATUS_LABELS, 'closed'),
          },
        ],
        detail: `${nc.code} — Closed: ${ncNote}`,
      },
      companyId,
      user,
    );
  }

  // ONE stamp for header and lines: a cancelled GRN's own lines are exactly
  // those whose deleted_at equals the header's (lines removed earlier keep
  // their own, older stamp). cancelled_at is the same instant (ADR-235, 0218).
  const stamp = softDeleteStamp(user);
  await tx
    .update(partyGrnLines)
    .set({ ...stamp, updatedAt: stamp.deletedAt, updatedBy: user.id })
    .where(and(eq(partyGrnLines.partyGrnId, id), isNull(partyGrnLines.deletedAt)));

  const cancelled = await tx
    .update(partyGrn)
    .set({
      ...stamp,
      cancelReason: trimmed,
      cancelledAt: stamp.deletedAt,
      cancelledBy: user.id,
      updatedAt: stamp.deletedAt,
      updatedBy: user.id,
    })
    .where(and(eq(partyGrn.id, id), isNull(partyGrn.deletedAt)))
    .returning({ id: partyGrn.id });
  if (cancelled.length === 0) {
    throw new ConflictError(
      `${head.code} has just been cancelled by someone else. Refresh the page.`,
    );
  }

  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Cancel,
      entity: 'PartyGrn',
      entityId: head.id,
      refId: head.code,
      qty: reversedQty,
      reason: trimmed,
      detail:
        `${head.code} cancelled — reversed ${reversedQty} from the customer material register` +
        (ncs.length > 0 ? `; closed ${ncs.map((n) => n.code).join(', ')}` : ''),
    },
    companyId,
    user,
  );

  return { code: head.code, reversedQty };
}

// ─── Edit (ADR-202 Phase 3) ──────────────────────────────────────────────────
//
// RECORD/HEADER level enrolment of Party GRN in edit-approval. Editable: the
// header's own fields (GRN Date, Customer Challan No., Remarks, Received By) and,
// on a line STILL WAITING for Incoming QC only, its Received Qty and Remarks. A
// line with any inspection booked (partial QC 0233: even 6 of 60) is frozen
// (accepted/rejected booked, stock posted), so editing it is refused. Raising a waiting line's Received Qty re-checks the
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
 * ADR-249 Step B1 — the Party GRN HEADER refusals, in ONE place: a Customer
 * Challan No. cannot be blanked (the schema refuses null / blank; this also
 * catches a staged payload saved before that rule) and must be unique for the
 * customer (an unchanged value is skipped). Called by updatePartyGrnTx (every
 * save, the approval replay included) and by the staging pre-check in
 * updatePartyGrnOrStage, so an edit the writer would refuse never stages — a
 * fully QC'd Party GRN's header edit goes for approval since B1. Returns the
 * trimmed challan to save, or undefined when the edit does not touch it.
 */
export async function assertPartyGrnHeaderEditAllowed(
  tx: DbTransaction,
  companyId: string,
  head: { id: string; clientId: string | null; dcNo: string | null },
  input: Pick<UpdatePartyGrnInput, 'dcNo'>,
): Promise<string | undefined> {
  if (input.dcNo === undefined) return undefined;
  const dcNo = typeof input.dcNo === 'string' ? input.dcNo.trim() : '';
  if (!dcNo) throw new ValidationError('Customer Challan No. is required.');
  await assertPartyGrnDcNoFree(tx, companyId, head.clientId, dcNo, {
    id: head.id,
    currentDcNo: head.dcNo,
  });
  return dcNo;
}

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
           client_id AS "clientId",
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
    clientId: string | null;
    receivedByText: string | null;
    deletedAt: unknown;
  }>;
  const head = headRows[0];
  if (!head) throw new NotFoundError('Party GRN not found. Refresh the page.');
  if (head.deletedAt != null) {
    throw new ConflictError(`${head.code} is cancelled — it cannot be edited.`);
  }
  // ADR-235 — no edit while a cancel request waits (this body is also the
  // edit-approval engine's replay of an approved edit).
  await assertNoPendingCancel(tx, 'party_grn', head.id);

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
  const dcNo = await assertPartyGrnHeaderEditAllowed(tx, companyId, head, input);
  if (dcNo !== undefined) headerSet['dcNo'] = dcNo;
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
    // Only a line nothing has been inspected on may be edited (a part-inspected
    // line is frozen too — its received qty is what the inspections add up to).
    if (!isQcUntouched(current)) {
      throw new ConflictError(
        `${at} has already been inspected at Incoming QC — its received qty and remarks can no longer be changed.`,
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
      // committed = Σ (received − rejected) per live line (+ pending-NC pieces);
      // this line's OLD share included — swap in the new received. Only an
      // untouched line gets here (rejected 0, no NC), so its share is received.
      const committedNow = await jwLineCommittedQty(tx, current.jwLineId);
      const committedOther = committedNow - (current.receivedQty - current.rejectedQty);
      const committedAfter = committedOther + li.receivedQty;
      if (committedAfter > jwLine.orderQty) {
        const open = Math.max(0, jwLine.orderQty - committedOther);
        throw new ConflictError(
          `${at}: Received (${li.receivedQty}) cannot be more than Pending (${open}) — ` +
            `Order Qty ${jwLine.orderQty}, already ${committedOther} on other lines ` +
            `(accepted, or waiting for Incoming QC). Deviated pieces do not count.`,
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
          and(eq(partyGrnLines.id, current.id), qcUntouchedCond(), isNull(partyGrnLines.deletedAt)),
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
 * the Document Edit Approval gate is ON and the GRN is LIVE (ADR-249 Step B1:
 * not cancelled — a fully QC'd GRN included), the edit is staged for approval
 * and the request row is returned; otherwise (gate off, or cancelled — whose
 * writer refuses) it applies directly. A change to a
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
  const { requestDocumentEdit } = await import('../document-edits/service');
  // "Live" is partyGrnEditRegistryEntry's own rule (partyGrnIsLive — ADR-249
  // Step B1: every Party GRN not cancelled, a fully QC'd one included), read
  // through the registry so the two can never drift. Gone / cancelled → the
  // direct path reports it. The pre-check below refuses whatever
  // updatePartyGrnTx would refuse at approval, so nothing stages that cannot
  // be applied.
  const request = await requestDocumentEdit(
    'PartyGrn',
    id,
    input,
    input.expectedUpdatedAt,
    user,
    async (tx, target) => {
      // ADR-235 — loadForDiff holds the GRN row; nothing stages while a cancel
      // request waits on it.
      await assertNoPendingCancel(tx, 'party_grn', id);
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
      // ADR-249 Step B1 — the writer's header refusals, through the SAME helper
      // updatePartyGrnTx calls, fed the header loadForDiff already locked.
      await assertPartyGrnHeaderEditAllowed(
        tx,
        companyId,
        {
          id,
          clientId: (target.doc['clientId'] as string | null | undefined) ?? null,
          dcNo: (target.doc['dcNo'] as string | null | undefined) ?? null,
        },
        input,
      );
      // Refuse a change to a line that is no longer editable, rather than drop it.
      const byId = new Map(lines.map((l) => [l.id, l]));
      for (const li of input.lines ?? []) {
        const c = byId.get(li.id);
        if (!c) {
          throw new ConflictError(
            'A line in this edit is not on this Party GRN. Refresh the page.',
          );
        }
        if (!isQcUntouched(c)) {
          throw new ConflictError(
            `Line ${c.lineNo} has already been inspected at Incoming QC — it can no longer be edited.`,
          );
        }
      }
    },
  );
  if (request) return { staged: true, request };
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
    cancelReason: row.cancelReason ?? null,
    cancelledAt: row.cancelledAt != null ? tsLike(row.cancelledAt) : null,
  };
}
