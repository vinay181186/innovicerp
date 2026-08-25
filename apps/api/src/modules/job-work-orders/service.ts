// Job Work Orders service (T-031).
//
// Same shape as the sales-orders service — header + lines in a single
// transaction, option-C merge on update (header always; lines only when
// present in payload). Differences from SO:
//   - No GST / type / cost-center / BOM fields on the header.
//   - JW lines have material-received fields, not rate / clientPoLineNo.
//   - Always require ≥ 1 line (no Equipment exception).
//
// The merge helper is duplicated rather than abstracted out — rule of three.
// If a third module (T-032 / T-038) needs the same logic, extract then.

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DocumentTraceability, RelatedDoc } from '@innovic/shared';
import {
  clients,
  items,
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  partyGrn,
  plans,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import { requireWriteRole } from '../../lib/auth';
import { withUniqueRetry } from '../../lib/db-retry';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { buildTimeline, section, toIsoDate } from '../../lib/traceability';
import { emitActivityLog } from '../activity-log/service';
import { assertBomUsableForJobWork, cascadeBomToJwLine } from '../bom-master/cascade';
import type {
  CreateJobWorkOrderInput,
  JobWorkOrder,
  JobWorkOrderDetail,
  JobWorkOrderLine,
  JobWorkOrderLineInput,
  JobWorkOrderListItem,
  ListJobWorkOrdersQuery,
  ListJobWorkOrdersResponse,
  UpdateJobWorkOrderInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function jwDetail(code: string, customerName: string | null | undefined): string {
  return customerName ? `${code} — ${customerName}` : code;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Validates the client exists in this company and returns its master name
 *  (used to snapshot customer_name from the master, not free text). */
async function assertClientExists(
  tx: DbTransaction,
  clientId: string,
  companyId: string,
): Promise<string> {
  const rows = await tx
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(
      and(eq(clients.id, clientId), eq(clients.companyId, companyId), isNull(clients.deletedAt)),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`Client ${clientId} not found in this company`);
  }
  return rows[0]!.name;
}

async function resolveItemCodes(
  tx: DbTransaction,
  codes: string[],
  companyId: string,
): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const rows = await tx
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(
      and(eq(items.companyId, companyId), inArray(items.code, codes), isNull(items.deletedAt)),
    );
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.code, r.id);
  return map;
}

/** Reverse of resolveItemCodes: itemId → master item code. Used on READ so the
 *  detail/edit form can show the readable code for lines that were resolved to
 *  an itemId at write time (their item_code_text is null). Fixes bugs 1.3/1.4. */
async function resolveItemCodesById(
  tx: DbTransaction,
  itemIds: Array<string | null>,
  companyId: string,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(itemIds.filter((x): x is string => Boolean(x))));
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(and(eq(items.companyId, companyId), inArray(items.id, unique), isNull(items.deletedAt)));
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.id, r.code);
  return map;
}

/** Next IN-JW-##### code in the company series (mirrors job-cards nextJcCode).
 *  Server-authoritative so the code no longer depends on a frontend useEffect
 *  (fixes bug 1.2). The MAX+1 scan matches the established repo convention. */
async function nextJwCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = await tx
    .select({ code: jobWorkOrders.code })
    .from(jobWorkOrders)
    .where(eq(jobWorkOrders.companyId, companyId));
  let max = 0;
  for (const r of rows) {
    const m = (r.code || '').match(/IN-JW-(\d+)\s*$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `IN-JW-${String(max + 1).padStart(5, '0')}`;
}

async function assertItemIdsExist(
  tx: DbTransaction,
  itemIds: string[],
  companyId: string,
): Promise<void> {
  const unique = Array.from(new Set(itemIds));
  if (unique.length === 0) return;
  const rows = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.companyId, companyId), inArray(items.id, unique), isNull(items.deletedAt)));
  if (rows.length !== unique.length) {
    const found = new Set(rows.map((r) => r.id));
    const missing = unique.filter((id) => !found.has(id));
    throw new ValidationError(`Item id(s) not found: ${missing.join(', ')}`);
  }
}

function resolveLineItemRefs(
  line: JobWorkOrderLineInput,
  resolved: Map<string, string>,
): { itemId: string | null; itemCodeText: string | null } {
  if (line.itemId) {
    return { itemId: line.itemId, itemCodeText: null };
  }
  const code = line.itemCodeText?.trim();
  if (!code) {
    throw new ValidationError('itemId or itemCodeText is required');
  }
  const found = resolved.get(code);
  return found ? { itemId: found, itemCodeText: null } : { itemId: null, itemCodeText: code };
}

function assignLineNos(lines: JobWorkOrderLineInput[], startFrom: number): number[] {
  const provided = lines.filter((l) => l.lineNo !== undefined);
  if (provided.length > 0 && provided.length !== lines.length) {
    throw new ValidationError('Provide lineNo on every line or none');
  }
  if (provided.length === 0) {
    return lines.map((_, i) => startFrom + i);
  }
  const seen = new Set<number>();
  const out: number[] = [];
  for (const l of lines) {
    const n = l.lineNo!;
    if (seen.has(n)) {
      throw new ValidationError(`Duplicate lineNo ${n} within input`);
    }
    seen.add(n);
    out.push(n);
  }
  return out;
}

function numToStringOrNull(v: number | undefined): string | null {
  return v === undefined ? null : v.toFixed(2);
}

/** Actual client-material receipts for one JWSO = Σ party_grn_lines.received_qty
 *  across its non-deleted Party GRNs. This is the source of truth for the
 *  "material received" badge. Returns 0 when no Party GRNs exist. */
async function sumPartyReceivedQty(tx: DbTransaction, jobWorkOrderId: string): Promise<number> {
  const rows = await tx.execute(sql`
    SELECT COALESCE(SUM(gl.received_qty), 0)::int AS qty
    FROM public.party_grn g
    JOIN public.party_grn_lines gl
      ON gl.party_grn_id = g.id AND gl.deleted_at IS NULL
    WHERE g.job_work_order_id = ${jobWorkOrderId}::uuid AND g.deleted_at IS NULL
  `);
  return Number((rows as unknown as Array<{ qty: number }>)[0]?.qty ?? 0);
}

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listJobWorkOrders(
  input: ListJobWorkOrdersQuery,
  user: AuthContext,
): Promise<ListJobWorkOrdersResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    // Match JW / client / client-PO, or any of the JWSO's lines by item code /
    // part name (via EXISTS so the header stays one row — #6).
    const searchFrag = term
      ? sql`AND (jw.code ILIKE ${term} OR jw.customer_name ILIKE ${term} OR jw.client_po_no ILIKE ${term}
                 OR EXISTS (
                   SELECT 1 FROM public.job_work_order_lines l2
                   LEFT JOIN public.items i2 ON i2.id = l2.item_id AND i2.deleted_at IS NULL
                   WHERE l2.job_work_order_id = jw.id AND l2.deleted_at IS NULL
                     AND (COALESCE(i2.code, l2.item_code_text) ILIKE ${term} OR l2.part_name ILIKE ${term})
                 ))`
      : sql``;
    const statusFrag = input.status ? sql`AND jw.status = ${input.status}::so_status` : sql``;
    const clientFrag = input.clientId ? sql`AND jw.client_id = ${input.clientId}::uuid` : sql``;
    const fromFrag = input.fromDate ? sql`AND jw.jw_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND jw.jw_date <= ${input.toDate}::date` : sql``;

    // ONE ROW PER JWSO HEADER (#6 — matches the SO Master list). Line aggregates
    // (count, total qty, earliest due) + rolled-up JC qty across all lines.
    const baseWhere = sql`
      FROM public.job_work_orders jw
      WHERE jw.company_id = ${companyId}::uuid AND jw.deleted_at IS NULL
        ${searchFrag} ${statusFrag} ${clientFrag} ${fromFrag} ${toFrag}`;

    const result = await tx.execute(sql`
      SELECT
        jw.id AS "jwId", jw.code, jw.jw_date AS "jwDate",
        jw.client_id AS "clientId", jw.customer_name AS "customerName",
        jw.client_po_no AS "clientPoNo",
        COALESCE(agg.line_count, 0)::int AS "lineCount",
        COALESCE(agg.total_qty, 0)::int AS "totalQty",
        COALESCE(agg.dispatched_qty, 0)::int AS "dispatchedQty",
        COALESCE(jca.jc_qty, 0)::int AS "jcQty",
        agg.earliest_due::text AS "earliestDueDate",
        jw.status, jw.remarks,
        jw.client_material_qty::text AS "clientMaterialQty",
        COALESCE(pg.party_received_qty, 0)::int AS "partyReceivedQty"
      FROM public.job_work_orders jw
      LEFT JOIN (
        SELECT job_work_order_id,
          COUNT(*) AS line_count, SUM(order_qty) AS total_qty,
          SUM(returned_qty) AS dispatched_qty, MIN(due_date) AS earliest_due
        FROM public.job_work_order_lines
        WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
        GROUP BY job_work_order_id
      ) agg ON agg.job_work_order_id = jw.id
      LEFT JOIN (
        SELECT l.job_work_order_id, SUM(jc.order_qty) AS jc_qty
        FROM public.job_cards jc
        JOIN public.job_work_order_lines l
          ON l.id = jc.source_jw_line_id AND l.deleted_at IS NULL
        WHERE jc.deleted_at IS NULL AND jc.source_jw_line_id IS NOT NULL
        GROUP BY l.job_work_order_id
      ) jca ON jca.job_work_order_id = jw.id
      -- Actual client-material receipts = Σ party_grn_lines.received_qty across
      -- this JWSO's non-deleted Party GRNs (the real source of truth for the
      -- material-received badge, replacing the manually-typed header field).
      LEFT JOIN (
        SELECT g.job_work_order_id, SUM(gl.received_qty) AS party_received_qty
        FROM public.party_grn g
        JOIN public.party_grn_lines gl
          ON gl.party_grn_id = g.id AND gl.deleted_at IS NULL
        WHERE g.deleted_at IS NULL AND g.job_work_order_id IS NOT NULL
        GROUP BY g.job_work_order_id
      ) pg ON pg.job_work_order_id = jw.id
      WHERE jw.company_id = ${companyId}::uuid AND jw.deleted_at IS NULL
        ${searchFrag} ${statusFrag} ${clientFrag} ${fromFrag} ${toFrag}
      ORDER BY jw.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const totalRows = await tx.execute(sql`SELECT COUNT(*)::int AS c ${baseWhere}`);
    const total = Number((totalRows as unknown as Array<{ c: number }>)[0]?.c ?? 0);

    const itemsOut = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items: itemsOut, total, limit: input.limit, offset: input.offset };
  });
}

function toListItem(r: Record<string, unknown>): JobWorkOrderListItem {
  return {
    jwId: r['jwId'] as string,
    code: r['code'] as string,
    jwDate: dateLike(r['jwDate']),
    clientId: (r['clientId'] as string | null) ?? null,
    customerName: (r['customerName'] as string | null) ?? null,
    clientPoNo: (r['clientPoNo'] as string | null) ?? null,
    lineCount: Number(r['lineCount'] ?? 0),
    totalQty: Number(r['totalQty'] ?? 0),
    dispatchedQty: Number(r['dispatchedQty'] ?? 0),
    jcQty: Number(r['jcQty'] ?? 0),
    earliestDueDate: (r['earliestDueDate'] as string | null) ?? null,
    status: r['status'] as JobWorkOrder['status'],
    remarks: (r['remarks'] as string | null) ?? null,
    clientMaterialQty: (r['clientMaterialQty'] as string | null) ?? null,
    partyReceivedQty: Number(r['partyReceivedQty'] ?? 0),
  };
}

function dateLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

// Money-hiding for L1 Viewers ("Can See Price"). The JWSO list carries no
// money (header aggregates only), so only the detail's line rate + header GST %
// need nulling.
function hideJwHeaderMoney<T extends { gstPercent: string | null }>(h: T): T {
  return { ...h, gstPercent: null };
}

function hideJwLineMoney<T extends { rate: string | null }>(l: T): T {
  return { ...l, rate: null };
}

export async function getJobWorkOrder(id: string, user: AuthContext): Promise<JobWorkOrderDetail> {
  const companyId = requireCompany(user);
  const showMoney = await canSeeFormPrice(user, 'jw_create');
  return withUserContext(user, async (tx) => {
    const headers = await tx
      .select()
      .from(jobWorkOrders)
      .where(
        and(
          eq(jobWorkOrders.id, id),
          eq(jobWorkOrders.companyId, companyId),
          isNull(jobWorkOrders.deletedAt),
        ),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError(`Job work order ${id} not found`);

    const lineRows = await tx
      .select()
      .from(jobWorkOrderLines)
      .where(and(eq(jobWorkOrderLines.jobWorkOrderId, id), isNull(jobWorkOrderLines.deletedAt)))
      .orderBy(asc(jobWorkOrderLines.lineNo));

    const codeMap = await resolveItemCodesById(
      tx,
      lineRows.map((l) => l.itemId),
      companyId,
    );
    const partyReceivedQty = await sumPartyReceivedQty(tx, id);
    const headerOut = toJobWorkOrder(header);
    return {
      ...(showMoney ? headerOut : hideJwHeaderMoney(headerOut)),
      partyReceivedQty,
      lines: lineRows.map((l) => {
        const line = toJobWorkOrderLine(l, codeMap);
        return showMoney ? line : hideJwLineMoney(line);
      }),
    };
  });
}

/**
 * Read-only document traceability for one Job Work Order (T-031 trace).
 *
 * Anchor: job_work_orders. Every subquery is company-scoped and soft-delete
 * filtered, inside a single withUserContext transaction (RLS applies too).
 *
 * Upstream (source) relationships:
 *   - job_work_orders.client_id                → clients (the ordering customer)
 *   - job_work_order_lines.item_id             → DISTINCT items (parts ordered)
 *
 * Downstream (generated) relationships:
 *   - job_cards.source_jw_line_id ∈ this JWO's job_work_order_lines.id
 *   - plans.jw_line_id            ∈ JWO line ids
 *   - party_grn.job_work_order_id = :id  (reference-only — no detail route)
 */
export async function getJobWorkOrderRelated(
  id: string,
  user: AuthContext,
): Promise<DocumentTraceability> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Confirm the JWO exists / is visible; grab jw_date + client_id for the
    // anchor timeline event and the upstream client link.
    const headers = await tx
      .select({
        id: jobWorkOrders.id,
        code: jobWorkOrders.code,
        jwDate: jobWorkOrders.jwDate,
        clientId: jobWorkOrders.clientId,
      })
      .from(jobWorkOrders)
      .where(
        and(
          eq(jobWorkOrders.id, id),
          eq(jobWorkOrders.companyId, companyId),
          isNull(jobWorkOrders.deletedAt),
        ),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError(`Job work order ${id} not found`);

    // JW lines drive the job-card / plan joins and the upstream item link.
    const lineRows = await tx
      .select({ id: jobWorkOrderLines.id, itemId: jobWorkOrderLines.itemId })
      .from(jobWorkOrderLines)
      .where(and(eq(jobWorkOrderLines.jobWorkOrderId, id), isNull(jobWorkOrderLines.deletedAt)));
    const lineIds = lineRows.map((r) => r.id);
    const itemIds = Array.from(
      new Set(lineRows.map((r) => r.itemId).filter((v): v is string => Boolean(v))),
    );

    // ── Upstream: client (source customer) ──────────────────────────────────
    const clientRows = header.clientId
      ? await tx
          .select({ id: clients.id, code: clients.code, name: clients.name })
          .from(clients)
          .where(
            and(
              eq(clients.id, header.clientId),
              eq(clients.companyId, companyId),
              isNull(clients.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const client = clientRows[0] ?? null;

    // ── Upstream: distinct master items referenced by this JWO's lines ──────
    const itemRows =
      itemIds.length === 0
        ? []
        : await tx
            .select({ id: items.id, code: items.code, name: items.name })
            .from(items)
            .where(
              and(
                eq(items.companyId, companyId),
                isNull(items.deletedAt),
                inArray(items.id, itemIds),
              ),
            )
            .orderBy(asc(items.code));

    // ── Downstream: job cards generated from this JWO's lines ───────────────
    const jobCardRows =
      lineIds.length === 0
        ? []
        : await tx
            .select({
              id: jobCards.id,
              code: jobCards.code,
              closedAt: jobCards.closedAt,
              date: jobCards.jcDate,
            })
            .from(jobCards)
            .where(
              and(
                eq(jobCards.companyId, companyId),
                isNull(jobCards.deletedAt),
                inArray(jobCards.sourceJwLineId, lineIds),
              ),
            )
            .orderBy(desc(jobCards.jcDate));

    // Plans linked to any of this JWO's lines.
    const planRows =
      lineIds.length === 0
        ? []
        : await tx
            .select({
              id: plans.id,
              code: plans.code,
              status: plans.planStatus,
              date: plans.planDate,
            })
            .from(plans)
            .where(
              and(
                eq(plans.companyId, companyId),
                isNull(plans.deletedAt),
                inArray(plans.jwLineId, lineIds),
              ),
            )
            .orderBy(desc(plans.planDate));

    // Party GRNs received against this JWO (no detail route — reference-only).
    // party_grn has no status column, so status is null.
    const partyGrnRows = await tx
      .select({
        id: partyGrn.id,
        code: partyGrn.code,
        date: partyGrn.grnDate,
      })
      .from(partyGrn)
      .where(
        and(
          eq(partyGrn.jobWorkOrderId, id),
          eq(partyGrn.companyId, companyId),
          isNull(partyGrn.deletedAt),
        ),
      )
      .orderBy(desc(partyGrn.grnDate));

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

    // ── Upstream sections (what this JWO was built FROM) ────────────────────
    const clientSection = section(
      'client',
      'Client',
      '👤',
      'client',
      client ? [row(client.id, client.code, null, null, { label: client.name })] : [],
    );
    const itemSection = section(
      'item',
      'Items',
      '📦',
      'item',
      itemRows.map((r) => row(r.id, r.code, null, null, { label: r.name })),
    );

    // ── Downstream sections (generated from this JWO) ───────────────────────
    const jobCardsSection = section(
      'job-cards',
      'Job Cards',
      '📋',
      'job-card',
      // job_cards has no status column — derive coarse closed/open from closed_at.
      jobCardRows.map((r) => row(r.id, r.code, r.closedAt ? 'closed' : 'open', r.date)),
    );
    const plansSection = section(
      'plans',
      'Planning',
      '🗂',
      'plan',
      planRows.map((r) => row(r.id, r.code, r.status, r.date)),
    );
    const partyGrnSection = section(
      'party-grn',
      'Party GRN',
      '📥',
      // No party-GRN detail route exists — reference-only.
      null,
      partyGrnRows.map((r) => row(r.id, r.code, null, r.date)),
    );

    const upstream = [clientSection, itemSection];
    const downstream = [jobCardsSection, plansSection, partyGrnSection];
    return {
      self: { module: 'job-work-orders', code: header.code },
      upstream,
      downstream,
      related: [],
      timeline: buildTimeline(
        {
          ts: toIsoDate(header.jwDate),
          label: 'Job Work Order created',
          code: header.code,
          routeKind: 'job-work-order',
          linkId: id,
        },
        [...upstream, ...downstream],
      ),
    };
  });
}

function toJobWorkOrder(row: typeof jobWorkOrders.$inferSelect): JobWorkOrder {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    jwDate: row.jwDate,
    clientId: row.clientId,
    customerName: row.customerName,
    clientPoNo: row.clientPoNo,
    status: row.status,
    gstPercent: row.gstPercent,
    remarks: row.remarks,
    clientMaterial: row.clientMaterial,
    clientMaterialQty: row.clientMaterialQty,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt
      ? row.deletedAt instanceof Date
        ? row.deletedAt.toISOString()
        : String(row.deletedAt)
      : null,
  };
}

function toJobWorkOrderLine(
  row: typeof jobWorkOrderLines.$inferSelect,
  codeByItemId?: Map<string, string>,
): JobWorkOrderLine {
  // On write, a line matched to a master item stores item_id and nulls
  // item_code_text. On read we surface the readable code (from the master) so
  // the detail page and edit form show it instead of a blank / "— linked —".
  const resolvedCode =
    row.itemCodeText ?? (row.itemId ? (codeByItemId?.get(row.itemId) ?? null) : null);
  return {
    id: row.id,
    companyId: row.companyId,
    jobWorkOrderId: row.jobWorkOrderId,
    lineNo: row.lineNo,
    itemId: row.itemId,
    itemCodeText: resolvedCode,
    partName: row.partName,
    material: row.material,
    drawingNo: row.drawingNo,
    uom: row.uom,
    orderQty: row.orderQty,
    returnedQty: row.returnedQty,
    rate: row.rate,
    dueDate: row.dueDate,
    status: row.status,
    sourceBomMasterId: row.sourceBomMasterId,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt
      ? row.deletedAt instanceof Date
        ? row.deletedAt.toISOString()
        : String(row.deletedAt)
      : null,
  };
}

// ─── Writes ───────────────────────────────────────────────────────────────

export async function createJobWorkOrder(
  input: CreateJobWorkOrderInput,
  user: AuthContext,
): Promise<JobWorkOrderDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  // withUniqueRetry re-runs in a fresh transaction if two concurrent creates
  // collide on job_work_orders_company_code_uniq (23505) — the MAX+1 generator
  // is not race-proof on its own.
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      // Code is server-authoritative: when the client omits it (or sends blank),
      // generate the next IN-JW-##### in the company series (fixes bug 1.2). A
      // caller-supplied code is still honoured (and duplicate-checked) for parity
      // with the legacy manual-entry path.
      const code = input.header.code?.trim() || (await nextJwCode(tx, companyId));

      const dup = await tx
        .select({ id: jobWorkOrders.id })
        .from(jobWorkOrders)
        .where(
          and(
            eq(jobWorkOrders.companyId, companyId),
            eq(jobWorkOrders.code, code),
            isNull(jobWorkOrders.deletedAt),
          ),
        )
        .limit(1);
      if (dup.length > 0) {
        throw new ConflictError(`Job work order code "${code}" already exists`);
      }

      // Client master link is enforced by the create schema (route boundary).
      // When a client is set, snapshot its master name into customer_name so the
      // stored customer always mirrors the master (no free text).
      let clientName: string | null = null;
      if (input.header.clientId) {
        clientName = await assertClientExists(tx, input.header.clientId, companyId);
      }

      const directIds = input.lines.flatMap((l) => (l.itemId ? [l.itemId] : []));
      await assertItemIdsExist(tx, directIds, companyId);
      const codesToResolve = input.lines
        .filter((l) => !l.itemId && l.itemCodeText)
        .map((l) => l.itemCodeText!.trim());
      const resolved = await resolveItemCodes(tx, codesToResolve, companyId);
      const lineNos = assignLineNos(input.lines, 1);

      const headerStatus = input.header.status ?? 'open';
      const inserted = await tx
        .insert(jobWorkOrders)
        .values({
          companyId,
          code,
          jwDate: input.header.jwDate,
          clientId: input.header.clientId ?? null,
          customerName: clientName ?? input.header.customerName ?? null,
          clientPoNo: input.header.clientPoNo ?? null,
          status: headerStatus,
          gstPercent: (input.header.gstPercent ?? 18).toFixed(2),
          remarks: input.header.remarks ?? null,
          clientMaterial: input.header.clientMaterial ?? null,
          clientMaterialQty: numToStringOrNull(input.header.clientMaterialQty),
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning();
      const header = inserted[0]!;

      const lineValues = input.lines.map((l, i) => {
        const refs = resolveLineItemRefs(l, resolved);
        return {
          companyId,
          jobWorkOrderId: header.id,
          lineNo: lineNos[i]!,
          itemId: refs.itemId,
          itemCodeText: refs.itemCodeText,
          partName: l.partName,
          material: l.material ?? null,
          drawingNo: l.drawingNo ?? null,
          uom: l.uom,
          orderQty: l.orderQty,
          rate: (l.rate ?? 0).toFixed(2),
          dueDate: l.dueDate ?? null,
          status: l.status ?? headerStatus,
          sourceBomMasterId: l.sourceBomMasterId ?? null,
          createdBy: user.id,
          updatedBy: user.id,
        };
      });

      // BOM-8 for job work (0086): refuse bought parts BEFORE writing anything,
      // so the user gets the friendly error instead of a half-built JWSO.
      for (const bomId of new Set(
        lineValues.flatMap((l) => (l.sourceBomMasterId ? [l.sourceBomMasterId] : [])),
      )) {
        await assertBomUsableForJobWork(tx, bomId, companyId);
      }

      const insertedLines = await tx.insert(jobWorkOrderLines).values(lineValues).returning();

      // Spawn a child Job Card per BOM component. Same tx as the JWSO insert,
      // so a cascade failure rolls the whole order back.
      for (const line of insertedLines) {
        if (line.sourceBomMasterId) {
          await cascadeBomToJwLine(tx, line.id, user);
        }
      }

      const codeMap = await resolveItemCodesById(
        tx,
        insertedLines.map((l) => l.itemId),
        companyId,
      );

      await emitActivityLog(
        tx,
        {
          action: 'CREATE',
          entity: 'JobWorkOrder',
          detail: jwDetail(header.code, header.customerName),
          refId: header.code,
        },
        companyId,
        user,
      );

      return {
        ...toJobWorkOrder(header),
        // A freshly created JWSO cannot have any Party GRNs yet.
        partyReceivedQty: 0,
        lines: insertedLines.map((l) => toJobWorkOrderLine(l, codeMap)),
      };
    }),
  );
}

export async function updateJobWorkOrder(
  id: string,
  input: UpdateJobWorkOrderInput,
  user: AuthContext,
): Promise<JobWorkOrderDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  // Money in, same rule as money out. `priceOff` makes "can do the job but must
  // not see the number" a supported setup, so an editor with prices hidden is a
  // real user — and their form posts back money fields it never showed them.
  // The rate/percent fields carry zod defaults, so a blinded payload does not
  // merely omit them: it arrives holding a default that would overwrite the
  // stored figures. Ignore them here — what is stored stands.
  const showMoney = await canSeeFormPrice(user, 'jw_create');

  return withUserContext(user, async (tx) => {
    const existingHdrRows = await tx
      .select()
      .from(jobWorkOrders)
      .where(
        and(
          eq(jobWorkOrders.id, id),
          eq(jobWorkOrders.companyId, companyId),
          isNull(jobWorkOrders.deletedAt),
        ),
      )
      .limit(1);
    const existingHdr = existingHdrRows[0];
    if (!existingHdr) throw new NotFoundError(`Job work order ${id} not found`);

    // When the client changes, snapshot the customer name from the master.
    let snapshotClientName: string | null = null;
    if (input.header.clientId !== undefined && input.header.clientId !== null) {
      snapshotClientName = await assertClientExists(tx, input.header.clientId, companyId);
    }

    const updates: Record<string, unknown> = { updatedBy: user.id };
    const h = input.header;
    if (h.jwDate !== undefined) updates['jwDate'] = h.jwDate;
    if (h.clientId !== undefined) updates['clientId'] = h.clientId ?? null;
    if (snapshotClientName !== null) updates['customerName'] = snapshotClientName;
    else if (h.customerName !== undefined) updates['customerName'] = h.customerName ?? null;
    if (h.clientPoNo !== undefined) updates['clientPoNo'] = h.clientPoNo ?? null;
    // Status is IMMUTABLE on a raw edit: preserve the existing JWSO status
    // regardless of what the payload sends (mirror of updateJobCard /
    // updatePurchaseOrder source-immutability). JWSO status moves ONLY through
    // its cascades — JC-completion (open→closed), JW-Return (→dispatched) — and
    // soft-delete for cancel; a plain update flipping status would only cause
    // drift. Silently ignore input.status.
    updates['status'] = existingHdr.status;
    if (h.gstPercent !== undefined && showMoney)
      updates['gstPercent'] = Number(h.gstPercent).toFixed(2);
    if (h.remarks !== undefined) updates['remarks'] = h.remarks ?? null;
    if (h.clientMaterial !== undefined) updates['clientMaterial'] = h.clientMaterial ?? null;
    if (h.clientMaterialQty !== undefined)
      updates['clientMaterialQty'] = numToStringOrNull(h.clientMaterialQty);

    await tx.update(jobWorkOrders).set(updates).where(eq(jobWorkOrders.id, id));

    if (input.lines !== undefined) {
      await mergeLines(tx, id, companyId, input.lines, user, showMoney);
    }

    const updatedHdrRows = await tx
      .select()
      .from(jobWorkOrders)
      .where(eq(jobWorkOrders.id, id))
      .limit(1);
    const lineRows = await tx
      .select()
      .from(jobWorkOrderLines)
      .where(and(eq(jobWorkOrderLines.jobWorkOrderId, id), isNull(jobWorkOrderLines.deletedAt)))
      .orderBy(asc(jobWorkOrderLines.lineNo));

    const updatedHdr = updatedHdrRows[0]!;
    const codeMap = await resolveItemCodesById(
      tx,
      lineRows.map((l) => l.itemId),
      companyId,
    );
    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'JobWorkOrder',
        detail: jwDetail(updatedHdr.code, updatedHdr.customerName),
        refId: updatedHdr.code,
      },
      companyId,
      user,
    );

    const partyReceivedQty = await sumPartyReceivedQty(tx, id);
    return {
      ...toJobWorkOrder(updatedHdr),
      partyReceivedQty,
      lines: lineRows.map((l) => toJobWorkOrderLine(l, codeMap)),
    };
  });
}

async function mergeLines(
  tx: DbTransaction,
  jobWorkOrderId: string,
  companyId: string,
  inputLines: JobWorkOrderLineInput[],
  user: AuthContext,
  /** False when the caller may not see money on this form — their payload's
   *  `rate` is then ignored on an EXISTING line so the stored figure survives.
   *  A NEW line still takes the input (there is no stored value to protect). */
  showMoney: boolean,
): Promise<void> {
  const existing = await tx
    .select({
      id: jobWorkOrderLines.id,
      lineNo: jobWorkOrderLines.lineNo,
    })
    .from(jobWorkOrderLines)
    .where(
      and(
        eq(jobWorkOrderLines.jobWorkOrderId, jobWorkOrderId),
        isNull(jobWorkOrderLines.deletedAt),
      ),
    );
  const existingById = new Map(existing.map((e) => [e.id, e]));

  const directIds = inputLines.flatMap((l) => (l.itemId ? [l.itemId] : []));
  await assertItemIdsExist(tx, directIds, companyId);
  const codesToResolve = inputLines
    .filter((l) => !l.itemId && l.itemCodeText)
    .map((l) => l.itemCodeText!.trim());
  const resolved = await resolveItemCodes(tx, codesToResolve, companyId);

  const seenInputIds = new Set<string>();
  const toInsert: JobWorkOrderLineInput[] = [];
  const toUpdate: Array<{ id: string; data: JobWorkOrderLineInput }> = [];

  for (const l of inputLines) {
    if (l.id && existingById.has(l.id)) {
      seenInputIds.add(l.id);
      toUpdate.push({ id: l.id, data: l });
    } else {
      toInsert.push(l);
    }
  }

  const absentIds = existing.map((e) => e.id).filter((eid) => !seenInputIds.has(eid));
  if (absentIds.length > 0) {
    await tx
      .update(jobWorkOrderLines)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(inArray(jobWorkOrderLines.id, absentIds));
  }

  for (const u of toUpdate) {
    const refs = resolveLineItemRefs(u.data, resolved);
    const lineUpdate: Record<string, unknown> = { updatedBy: user.id };
    if (u.data.lineNo !== undefined) lineUpdate['lineNo'] = u.data.lineNo;
    if (u.data.itemId !== undefined || u.data.itemCodeText !== undefined) {
      lineUpdate['itemId'] = refs.itemId;
      lineUpdate['itemCodeText'] = refs.itemCodeText;
    }
    if (u.data.partName !== undefined) lineUpdate['partName'] = u.data.partName;
    if (u.data.material !== undefined) lineUpdate['material'] = u.data.material ?? null;
    if (u.data.drawingNo !== undefined) lineUpdate['drawingNo'] = u.data.drawingNo ?? null;
    if (u.data.uom !== undefined) lineUpdate['uom'] = u.data.uom;
    if (u.data.orderQty !== undefined) lineUpdate['orderQty'] = u.data.orderQty;
    if (u.data.rate !== undefined && showMoney)
      lineUpdate['rate'] = (u.data.rate ?? 0).toFixed(2);
    if (u.data.dueDate !== undefined) lineUpdate['dueDate'] = u.data.dueDate ?? null;
    if (u.data.status !== undefined) lineUpdate['status'] = u.data.status;
    if (u.data.sourceBomMasterId !== undefined) {
      // Validate before storing. Deliberately does NOT re-cascade: the cascade
      // is idempotent on existing child JCs, so re-pointing a line that already
      // spawned work would silently change the BOM of record without changing
      // the shop floor. Same behaviour as the sales-order update path.
      if (u.data.sourceBomMasterId) {
        await assertBomUsableForJobWork(tx, u.data.sourceBomMasterId, companyId);
      }
      lineUpdate['sourceBomMasterId'] = u.data.sourceBomMasterId ?? null;
    }

    await tx.update(jobWorkOrderLines).set(lineUpdate).where(eq(jobWorkOrderLines.id, u.id));
  }

  if (toInsert.length > 0) {
    const survivingMax = existing
      .filter((e) => !absentIds.includes(e.id))
      .reduce((m, e) => Math.max(m, e.lineNo), 0);
    const startFrom = survivingMax + 1;
    const newLineNos = assignLineNos(toInsert, startFrom);
    const values = toInsert.map((l, i) => {
      const refs = resolveLineItemRefs(l, resolved);
      return {
        companyId,
        jobWorkOrderId,
        lineNo: newLineNos[i]!,
        itemId: refs.itemId,
        itemCodeText: refs.itemCodeText,
        partName: l.partName,
        material: l.material ?? null,
        drawingNo: l.drawingNo ?? null,
        uom: l.uom,
        orderQty: l.orderQty,
        rate: (l.rate ?? 0).toFixed(2),
        dueDate: l.dueDate ?? null,
        status: l.status ?? 'open',
        sourceBomMasterId: l.sourceBomMasterId ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      };
    });

    // Same gate + cascade as create — a line added on edit is still a new line.
    for (const bomId of new Set(
      values.flatMap((l) => (l.sourceBomMasterId ? [l.sourceBomMasterId] : [])),
    )) {
      await assertBomUsableForJobWork(tx, bomId, companyId);
    }
    const newRows = await tx.insert(jobWorkOrderLines).values(values).returning();
    for (const line of newRows) {
      if (line.sourceBomMasterId) {
        await cascadeBomToJwLine(tx, line.id, user);
      }
    }
  }
}

export async function softDeleteJobWorkOrder(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({
        id: jobWorkOrders.id,
        code: jobWorkOrders.code,
        customerName: jobWorkOrders.customerName,
      })
      .from(jobWorkOrders)
      .where(
        and(
          eq(jobWorkOrders.id, id),
          eq(jobWorkOrders.companyId, companyId),
          isNull(jobWorkOrders.deletedAt),
        ),
      )
      .limit(1);
    const row = existing[0];
    if (!row) {
      throw new NotFoundError(`Job work order ${id} not found`);
    }
    const now = new Date();
    await tx
      .update(jobWorkOrderLines)
      .set({ deletedAt: now, updatedBy: user.id })
      .where(and(eq(jobWorkOrderLines.jobWorkOrderId, id), isNull(jobWorkOrderLines.deletedAt)));
    await tx
      .update(jobWorkOrders)
      .set({ deletedAt: now, updatedBy: user.id })
      .where(eq(jobWorkOrders.id, id));
    await emitActivityLog(
      tx,
      {
        action: 'DELETE',
        entity: 'JobWorkOrder',
        detail: jwDetail(row.code, row.customerName),
        refId: row.code,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}
