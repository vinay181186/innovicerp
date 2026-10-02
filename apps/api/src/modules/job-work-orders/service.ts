// Job Work Orders service (T-031).
//
// Same shape as the sales-orders service — header + lines in a single
// transaction, option-C merge on update (header always; lines only when
// present in payload). Differences from SO:
//   - No type / cost-center fields on the header.
//   - Always require ≥ 1 line (no Equipment exception).
//
// ADR-203 (JWSO structure): every line names a master item and carries its own
// customer raw material — the `<item>-RM` item and the per-customer party
// material — written here on EVERY save (create and update) through
// lib/jw-rm.ts. A line that a downstream document already uses (lib/jw-line-
// state.ts `jwLineUsage`) cannot be removed and its item / UOM / BOM are
// locked. Header status is server-owned and derived from the lines
// (`recomputeJwHeaderStatus`).

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  ActivityChange,
  DocumentTraceability,
  EnsureJwRmItemInput,
  EnsureJwRmItemResponse,
  ItemType,
  RelatedDoc,
} from '@innovic/shared';
import {
  ActivityAction,
  ITEM_TYPE_RULES,
  normalizeRevision,
  revisionBackwardsMessage,
  revisionGoesBackwards,
} from '@innovic/shared';
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
import { canSeeFormPrice, requireFormAccess } from '../../lib/access';
import { type DiffField, diffFields, softDeleteStamp } from '../../lib/audit-trail';
import { requireWriteRole } from '../../lib/auth';
import { withUniqueRetry } from '../../lib/db-retry';
import { assertUnchangedSinceOpened } from '../../lib/edit-conflict';
import { assertActiveParty } from '../../lib/active-party';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { ensurePartyMaterial, ensureRmItemForOrderItem } from '../../lib/jw-rm';
import { jwLineUsage, lockJwLine, recomputeJwHeaderStatus } from '../../lib/jw-line-state';
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
  ShortCloseJobWorkOrderLineInput,
  UpdateJobWorkOrderInput,
} from './schema';
import { jcEffectiveQtySql } from '../../lib/jc-effective-qty';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { JWSO_SF_COLUMNS } from './sf-columns';

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
  /** The document's current customer on an edit — an inactive customer is
   *  refused only when it is being newly linked (A10 inactive-master rule). */
  keepClientId?: string | null,
): Promise<string> {
  return (await assertActiveParty(tx, 'customer', clientId, companyId, keepClientId)).name;
}

/** What a JWSO line reads back from the item master: the readable code and,
 *  since 0136, the product image path for the thumbnail next to it. */
interface ItemMasterRef {
  code: string;
  imagePath: string | null;
}

/** itemId → master item code (+ image path). Used on READ so the detail/edit
 *  form shows the readable code, and for the line's customer RM code. The
 *  image rides along in the same query so the thumbnail costs no extra trip. */
async function resolveItemCodesById(
  tx: DbTransaction,
  itemIds: Array<string | null>,
  companyId: string,
): Promise<Map<string, ItemMasterRef>> {
  const unique = Array.from(new Set(itemIds.filter((x): x is string => Boolean(x))));
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: items.id, code: items.code, imagePath: items.imagePath })
    .from(items)
    .where(and(eq(items.companyId, companyId), inArray(items.id, unique), isNull(items.deletedAt)));
  const map = new Map<string, ItemMasterRef>();
  for (const r of rows) map.set(r.id, { code: r.code, imagePath: r.imagePath ?? null });
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

/** ADR-203 rule 3: every line's item must be a LIVE master item that is NOT a
 *  customer material (Party Supplied Material — that is the line's RM, not the
 *  part to be made). Returns itemId → master code, the line's code snapshot. */
async function loadOrderItems(
  tx: DbTransaction,
  itemIds: string[],
  companyId: string,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(itemIds));
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const rows = await tx
    .select({ id: items.id, code: items.code, itemType: items.itemType })
    .from(items)
    .where(and(eq(items.companyId, companyId), inArray(items.id, unique), isNull(items.deletedAt)));
  if (rows.length !== unique.length) {
    throw new ValidationError('Item not found. Please select the Item Code again.');
  }
  for (const r of rows) {
    if (ITEM_TYPE_RULES[r.itemType as ItemType]?.partyOwned) {
      throw new ValidationError(
        `${r.code} is a customer material (Party Supplied Material) — pick the part to be made, not its raw material.`,
      );
    }
    map.set(r.id, r.code);
  }
  return map;
}

/** ADR-203 rule 1: one resolver per save. order item → its `-RM` item, then
 *  RM + the JWSO's customer → party material. Cached so a JWSO with five lines
 *  of the same item asks once. Errors propagate: no save without material. */
type RmResolver = (itemId: string) => Promise<{ rmItemId: string; partyMaterialId: string }>;

function makeRmResolver(
  tx: DbTransaction,
  companyId: string,
  clientId: string | null,
  userId: string,
): RmResolver {
  const cache = new Map<string, { rmItemId: string; partyMaterialId: string }>();
  return async (itemId) => {
    const hit = cache.get(itemId);
    if (hit) return hit;
    if (!clientId) {
      throw new ValidationError(
        'A client (from the client master) is required for a Job Work order.',
      );
    }
    const rm = await ensureRmItemForOrderItem(tx, companyId, itemId, userId);
    const pm = await ensurePartyMaterial(tx, companyId, rm.rmItemId, clientId, userId);
    const out = { rmItemId: rm.rmItemId, partyMaterialId: pm.partyMaterialId };
    cache.set(itemId, out);
    return out;
  };
}

/** ADR-203 rule 1 (code review fix): bring the lines of a JWSO in step with
 *  their customer RM WITHOUT ever moving a line that is already in use — its
 *  receipts and issues are booked on its current party material, so re-pointing
 *  it would strand that stock. Two cases:
 *   · the customer changed (only allowed when no line is in use) → every line
 *     is re-pointed to the new customer's party material; errors stop the save;
 *   · otherwise only lines with NO RM yet (legacy rows) are backfilled, best
 *     effort in a savepoint, so a header-only edit of an old JWSO never fails
 *     because of master data it did not touch. */
async function wireLineRm(
  tx: DbTransaction,
  p: {
    jobWorkOrderId: string;
    companyId: string;
    clientId: string | null;
    clientChanged: boolean;
    usage: Map<string, string[]>;
    userId: string;
  },
): Promise<void> {
  const rows = await tx
    .select({
      id: jobWorkOrderLines.id,
      itemId: jobWorkOrderLines.itemId,
      rmItemId: jobWorkOrderLines.rmItemId,
      partyMaterialId: jobWorkOrderLines.partyMaterialId,
    })
    .from(jobWorkOrderLines)
    .where(
      and(
        eq(jobWorkOrderLines.jobWorkOrderId, p.jobWorkOrderId),
        isNull(jobWorkOrderLines.deletedAt),
      ),
    );
  const strict = makeRmResolver(tx, p.companyId, p.clientId, p.userId);
  for (const r of rows) {
    if (!r.itemId || p.usage.has(r.id)) continue;
    let rm: { rmItemId: string; partyMaterialId: string } | null = null;
    if (p.clientChanged) {
      rm = await strict(r.itemId);
    } else if (!r.rmItemId || !r.partyMaterialId) {
      const itemId = r.itemId;
      rm = await tx
        .transaction(async (sp) => makeRmResolver(sp, p.companyId, p.clientId, p.userId)(itemId))
        .catch(() => null);
    }
    if (!rm || (r.rmItemId === rm.rmItemId && r.partyMaterialId === rm.partyMaterialId)) continue;
    await tx
      .update(jobWorkOrderLines)
      .set({ rmItemId: rm.rmItemId, partyMaterialId: rm.partyMaterialId, updatedBy: p.userId })
      .where(eq(jobWorkOrderLines.id, r.id));
  }
}

/** `uuid IN (…)` list for raw SQL. */
function uuidList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

/** ADR-203 rule 9: customer material QC-ACCEPTED per JWSO line
 *  (Σ party_grn_lines.accepted_qty by jw_line_id, live GRN + live GRN line).
 *  Rejected pieces never count. */
async function rmAcceptedByLine(
  tx: DbTransaction,
  lineIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (lineIds.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT gl.jw_line_id AS "lineId", COALESCE(SUM(gl.accepted_qty), 0)::int AS qty
      FROM public.party_grn_lines gl
      JOIN public.party_grn g ON g.id = gl.party_grn_id AND g.deleted_at IS NULL
     WHERE gl.jw_line_id IN (${uuidList(lineIds)}) AND gl.deleted_at IS NULL
     GROUP BY gl.jw_line_id
  `)) as unknown as Array<{ lineId: string; qty: number }>;
  for (const r of rows) out.set(r.lineId, Number(r.qty));
  return out;
}

/** party_materials id → its PM-#### code (the customer-material register). */
async function partyMaterialCodes(
  tx: DbTransaction,
  ids: Array<string | null>,
  companyId: string,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT id, code FROM public.party_materials
     WHERE id IN (${uuidList(unique)}) AND company_id = ${companyId}::uuid
  `)) as unknown as Array<{ id: string; code: string }>;
  for (const r of rows) out.set(r.id, r.code);
  return out;
}

/** "Ln 2 (JC-0045, PGRN-00031)" — the in-use refusal's document list. */
function usageLabel(lineNo: number, docs: readonly string[]): string {
  return `Ln ${lineNo} (${docs.join(', ')})`;
}

// ─── Reads ────────────────────────────────────────────────────────────────

/** Escape the ILIKE metacharacters in a user's search term. Without this a
 *  user typing "50%" or "a_b" in the JWSO search box gets a wildcard pattern
 *  instead of a literal search — a bare "%" returned every JWSO. The SQL side
 *  must pair it with an ESCAPE '\' clause on every ILIKE, or the escapes match
 *  literally.
 *  Deliberately a local copy of the sales-orders helper rather than an export
 *  across modules: it is three lines, and each list must be free to change its
 *  own search behaviour without dragging the others with it. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listJobWorkOrders(
  input: ListJobWorkOrdersQuery,
  user: AuthContext,
): Promise<ListJobWorkOrdersResponse> {
  const companyId = requireCompany(user);
  // ADR-203 rule 8: reading the JWSO Master needs its view right.
  await requireFormAccess(user, 'jw_create', 'view');
  return withUserContext(user, async (tx) => {
    // Search covers every field the JWSO list card actually shows — band 1
    // (JWSO code, client name, status badge), band 2's meta line (JWSO date,
    // client PO no, earliest due date, remarks) and, via EXISTS, the expandable
    // LINE ITEMS table (Item Code, Customer RM, Part Name, Material, Drawing
    // No, UOM, Due Date, line Status). One matching line surfaces its whole
    // JWSO — the header stays one row (#6).
    // Deliberately NOT searched: total / JC / dispatched / balance / line
    // quantities and the client-material qty behind the ✓ Full / ◑ Partial
    // badge — matching numbers would make "5" hit almost every JWSO. And NOT
    // the line rate: this module hides money behind `canSeeFormPrice`
    // (hideJwLineMoney below), so a searchable amount would let a user who may
    // not see prices confirm a rate by guessing at it.
    const term = input.search ? `%${escapeLikeTerm(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (jw.code ILIKE ${term} ESCAPE '\\'
                 OR jw.customer_name ILIKE ${term} ESCAPE '\\'
                 OR jw.client_po_no ILIKE ${term} ESCAPE '\\'
                 OR jw.status::text ILIKE ${term} ESCAPE '\\'
                 OR jw.jw_date::text ILIKE ${term} ESCAPE '\\'
                 OR jw.remarks ILIKE ${term} ESCAPE '\\'
                 OR EXISTS (
                   SELECT 1 FROM public.job_work_order_lines l2
                   LEFT JOIN public.items i2 ON i2.id = l2.item_id AND i2.deleted_at IS NULL
                   LEFT JOIN public.items ri2 ON ri2.id = l2.rm_item_id AND ri2.deleted_at IS NULL
                   WHERE l2.job_work_order_id = jw.id AND l2.deleted_at IS NULL
                     AND (
                       -- Item Code is matched on BOTH the text the line stored
                       -- and the live master code: an item renamed after the
                       -- JWSO was raised keeps the old code on the line, and
                       -- users search either one. (Was a COALESCE, which hid
                       -- the stored text whenever the master row still existed.)
                       l2.item_code_text ILIKE ${term} ESCAPE '\\'
                       OR i2.code ILIKE ${term} ESCAPE '\\'
                       -- ADR-203: the line's customer RM code (ABCD123-RM).
                       OR ri2.code ILIKE ${term} ESCAPE '\\'
                       OR l2.part_name ILIKE ${term} ESCAPE '\\'
                       OR l2.material ILIKE ${term} ESCAPE '\\'
                       OR l2.drawing_no ILIKE ${term} ESCAPE '\\'
                       OR l2.uom::text ILIKE ${term} ESCAPE '\\'
                       OR l2.status::text ILIKE ${term} ESCAPE '\\'
                       -- The card's "Due" is MIN(line due_date); matching any
                       -- line's due date is what the user means by it.
                       OR l2.due_date::text ILIKE ${term} ESCAPE '\\'
                     )
                 ))`
      : sql``;
    const statusFrag = input.status ? sql`AND jw.status = ${input.status}::so_status` : sql``;
    const clientFrag = input.clientId ? sql`AND jw.client_id = ${input.clientId}::uuid` : sql``;
    const fromFrag = input.fromDate ? sql`AND jw.jw_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND jw.jw_date <= ${input.toDate}::date` : sql``;

    // Sort & Filter (ADR-200): the screen's column filters + sort, through the
    // list's own whitelist (sf-columns.ts). Applied to list AND count.
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(JWSO_SF_COLUMNS, sf);
    const orderBy = sfOrderBy(JWSO_SF_COLUMNS, sf, sql`jw.code DESC, jw.id DESC`);

    // ONE ROW PER JWSO HEADER (#6 — matches the SO Master list). Line aggregates
    // (count, total qty, earliest due) + rolled-up JC qty across all lines.
    // The FROM + WHERE is shared by the page and the count (the sf columns read
    // the aggregates), so `total` always counts what the pages show.
    const fromWhere = sql`
      FROM public.job_work_orders jw
      LEFT JOIN (
        SELECT job_work_order_id,
          COUNT(*) AS line_count, SUM(order_qty) AS total_qty,
          SUM(returned_qty) AS dispatched_qty, MIN(due_date) AS earliest_due,
          -- ADR-203 (owner D1): 1 RM piece per finished part, so the material
          -- needed is the order qty of the lines that have a customer RM.
          SUM(order_qty) FILTER (WHERE rm_item_id IS NOT NULL) AS rm_required_qty
        FROM public.job_work_order_lines
        WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
        GROUP BY job_work_order_id
      ) agg ON agg.job_work_order_id = jw.id
      LEFT JOIN (
        SELECT l.job_work_order_id, SUM(${jcEffectiveQtySql('jc')}) AS jc_qty
        FROM public.job_cards jc
        JOIN public.job_work_order_lines l
          ON l.id = jc.source_jw_line_id AND l.deleted_at IS NULL
        WHERE jc.deleted_at IS NULL AND jc.source_jw_line_id IS NOT NULL
          -- Rework/repair children re-make pieces the parent JC already
          -- covers (QC-NC audit 2026-09-21, gap 3; same rule as SO list).
          AND jc.recovery_kind IS NULL
        GROUP BY l.job_work_order_id
      ) jca ON jca.job_work_order_id = jw.id
      -- ADR-203: customer material QC-ACCEPTED on this JWSO's live lines
      -- (Σ party_grn_lines.accepted_qty by jw_line_id). Rejected never counts.
      LEFT JOIN (
        SELECT l.job_work_order_id, SUM(gl.accepted_qty) AS party_received_qty
        FROM public.party_grn_lines gl
        JOIN public.party_grn g ON g.id = gl.party_grn_id AND g.deleted_at IS NULL
        JOIN public.job_work_order_lines l ON l.id = gl.jw_line_id AND l.deleted_at IS NULL
        WHERE gl.deleted_at IS NULL AND l.company_id = ${companyId}::uuid
        GROUP BY l.job_work_order_id
      ) pg ON pg.job_work_order_id = jw.id
      WHERE jw.company_id = ${companyId}::uuid AND jw.deleted_at IS NULL
        ${searchFrag} ${statusFrag} ${clientFrag} ${fromFrag} ${toFrag} ${sfFrag}`;

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
        COALESCE(pg.party_received_qty, 0)::int AS "partyReceivedQty",
        COALESCE(agg.rm_required_qty, 0)::int AS "rmRequiredQty"
      ${fromWhere}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const totalRows = await tx.execute(sql`SELECT COUNT(*)::int AS c ${fromWhere}`);
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
    rmRequiredQty: Number(r['rmRequiredQty'] ?? 0),
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
  // Also STATE it: the reader must not have to infer 'hidden' from the null.
  return { ...h, gstPercent: null, priceVisible: false };
}

function hideJwLineMoney<T extends { rate: string | null }>(l: T): T {
  return { ...l, rate: null };
}

/** The ONE detail read — used by get AND by the create / update responses, so
 *  a write answers with exactly what a read would show, money mask included
 *  (ADR-203 rule 8). Caller has already confirmed the header is in-company. */
async function loadJobWorkOrderDetail(
  tx: DbTransaction,
  id: string,
  companyId: string,
  showMoney: boolean,
): Promise<JobWorkOrderDetail> {
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
  if (!header) throw new NotFoundError('JWSO not found. It may have been moved to Trash.');

  const lineRows = await tx
    .select()
    .from(jobWorkOrderLines)
    .where(and(eq(jobWorkOrderLines.jobWorkOrderId, id), isNull(jobWorkOrderLines.deletedAt)))
    .orderBy(asc(jobWorkOrderLines.lineNo));
  const lineIds = lineRows.map((l) => l.id);

  // Order items and RM items share the items table — one lookup serves both.
  const codeMap = await resolveItemCodesById(
    tx,
    [...lineRows.map((l) => l.itemId), ...lineRows.map((l) => l.rmItemId)],
    companyId,
  );
  const pmCodes = await partyMaterialCodes(
    tx,
    lineRows.map((l) => l.partyMaterialId),
    companyId,
  );
  const accepted = await rmAcceptedByLine(tx, lineIds);
  const usage = await jwLineUsage(tx, lineIds);
  // ADR-203 rule 9: Σ accepted by jw_line_id over THIS JWSO's live lines.
  const partyReceivedQty = lineIds.reduce((a, lid) => a + (accepted.get(lid) ?? 0), 0);

  const headerOut = toJobWorkOrder(header);
  return {
    ...(showMoney ? headerOut : hideJwHeaderMoney(headerOut)),
    partyReceivedQty,
    lines: lineRows.map((l) => {
      const line = toJobWorkOrderLine(l, codeMap, {
        partyMaterialCode: l.partyMaterialId ? (pmCodes.get(l.partyMaterialId) ?? null) : null,
        rmAcceptedQty: accepted.get(l.id) ?? 0,
        inUse: usage.has(l.id),
      });
      return showMoney ? line : hideJwLineMoney(line);
    }),
  };
}

export async function getJobWorkOrder(id: string, user: AuthContext): Promise<JobWorkOrderDetail> {
  const companyId = requireCompany(user);
  await requireFormAccess(user, 'jw_create', 'view');
  const showMoney = await canSeeFormPrice(user, 'jw_create');
  return withUserContext(user, (tx) => loadJobWorkOrderDetail(tx, id, companyId, showMoney));
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
  // ADR-203 rule 8: the trace reads the JWSO, so it needs the JWSO view right.
  await requireFormAccess(user, 'jw_create', 'view');
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
    if (!header) throw new NotFoundError('JWSO not found. It may have been moved to Trash.');

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

// R6 (ADR-194) — short-close ONE JWSO line.
//
// The customer will not send (or take back) the rest of a line's order, so it is
// closed with the balance (order qty − returned qty) left unmet. The shared
// so_status enum is NOT widened: status becomes 'closed' exactly like a normal
// close, and three flag columns record that the close was short and why.
// Closing a line with a shortfall is a department-admin decision, so it takes
// the edit AND approve pair on jw_create (no new permission key).
//
// ADR-203 rule 7: the line is read under its row lock (lockJwLine), a line
// that is already closed / short-closed / fully returned is refused, the write
// is conditional on status = 'open' (CLAUDE.md §20.2), and the header status is
// recomputed from the lines afterwards.
export async function shortCloseJobWorkOrderLine(
  lineId: string,
  input: ShortCloseJobWorkOrderLineInput,
  user: AuthContext,
): Promise<JobWorkOrderDetail> {
  requireWriteRole(user);
  await requireFormAccess(user, 'jw_create', 'edit');
  await requireFormAccess(user, 'jw_create', 'approve');
  const companyId = requireCompany(user);
  const userId = user.id;
  const reason = input.reason.trim();
  if (!reason) throw new ValidationError('Reason is required to short-close a JWSO line.');

  const jobWorkOrderId = await withUserContext(user, async (tx) => {
    const line = await lockJwLine(tx, companyId, lineId);
    const where = `${line.jwCode} Ln ${line.lineNo}`;
    if (line.shortClosedAt) throw new ConflictError(`${where} is already short-closed.`);
    if (line.status === 'closed') throw new ConflictError(`${where} is already closed.`);
    if (line.returnedQty >= line.orderQty) {
      throw new ConflictError(`${where} is fully returned — there is no balance to short-close.`);
    }
    if (line.status !== 'open') {
      throw new ConflictError(
        `${where} is ${line.status} — only an open line can be short-closed.`,
      );
    }

    const updated = await tx
      .update(jobWorkOrderLines)
      .set({
        status: 'closed',
        shortClosedAt: new Date(),
        shortClosedBy: userId,
        shortCloseReason: reason,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(
        and(
          eq(jobWorkOrderLines.id, line.id),
          eq(jobWorkOrderLines.status, 'open'),
          isNull(jobWorkOrderLines.shortClosedAt),
          isNull(jobWorkOrderLines.deletedAt),
        ),
      )
      .returning({
        lineNo: jobWorkOrderLines.lineNo,
        orderQty: jobWorkOrderLines.orderQty,
        returnedQty: jobWorkOrderLines.returnedQty,
      });
    const row = updated[0];
    if (!row) {
      throw new ConflictError(
        `${where} was changed by someone else just now — reload and try again.`,
      );
    }

    const shortfall = Math.max(0, row.orderQty - row.returnedQty);
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.CloseShort,
        entity: 'JobWorkOrder',
        entityId: line.jobWorkOrderId,
        refId: line.jwCode,
        lineRef: `Line ${row.lineNo}`,
        qty: shortfall,
        reason,
        detail: `${line.jwCode} Ln ${row.lineNo} short-closed (${shortfall} unmet)`,
      },
      companyId,
      user,
    );

    await recomputeJwHeaderStatus(tx, line.jobWorkOrderId, userId);
    return line.jobWorkOrderId;
  });

  // Return the whole JWSO detail so the caller re-renders the order with the
  // line now closed — the shape the JWSO detail screen already consumes.
  return getJobWorkOrder(jobWorkOrderId, user);
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

/** ADR-203 read-only extras a line carries that are not columns on the row. */
interface JwLineExtras {
  partyMaterialCode: string | null;
  rmAcceptedQty: number;
  inUse: boolean;
}

function toJobWorkOrderLine(
  row: typeof jobWorkOrderLines.$inferSelect,
  masterByItemId: Map<string, ItemMasterRef>,
  extras: JwLineExtras,
): JobWorkOrderLine {
  // Since ADR-203 item_code_text is the master code snapshot written on save;
  // older rows matched to a master item stored it null, so the live master
  // code is the fallback (bugs 1.3/1.4).
  const master = row.itemId ? masterByItemId.get(row.itemId) : undefined;
  const resolvedCode = row.itemCodeText ?? master?.code ?? null;
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
    // Migration 0120 — the customer's drawing Rev and the drawing FILE, read
    // back exactly as the sales-order line reads them.
    revision: row.revision,
    drawingFilePath: row.drawingFilePath,
    // Item Master product image (0136) — the thumbnail next to code · name.
    itemImagePath: master?.imagePath ?? null,
    uom: row.uom,
    orderQty: row.orderQty,
    returnedQty: row.returnedQty,
    rate: row.rate,
    dueDate: row.dueDate,
    status: row.status,
    // R6 (ADR-194): short-close markers — set when a line was closed with an
    // unmet balance. Status stays 'closed'; these record the shortfall + reason.
    shortClosedAt:
      row.shortClosedAt instanceof Date
        ? row.shortClosedAt.toISOString()
        : row.shortClosedAt
          ? String(row.shortClosedAt)
          : null,
    shortClosedBy: row.shortClosedBy,
    shortCloseReason: row.shortCloseReason,
    sourceBomMasterId: row.sourceBomMasterId,
    // ADR-203: the line's customer RM + its register row, accepted material
    // and whether any document uses the line (drives the edit form's locks).
    rmItemId: row.rmItemId,
    rmItemCode: row.rmItemId ? (masterByItemId.get(row.rmItemId)?.code ?? null) : null,
    partyMaterialId: row.partyMaterialId,
    partyMaterialCode: extras.partyMaterialCode,
    rmAcceptedQty: extras.rmAcceptedQty,
    inUse: extras.inUse,
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

/** ADR-203 rule 6: a line's due date may not fall before the JWSO date. */
function assertDueNotBeforeJwDate(lineLabel: string, dueDate: string, jwDate: string): void {
  if (dueDate < jwDate) {
    throw new ValidationError(
      `${lineLabel}: Due Date ${dueDate} is before the JWSO Date ${jwDate}.`,
    );
  }
}

// ─── Writes ───────────────────────────────────────────────────────────────

/** ADR-203 — find-or-create the customer RM item for an order item. Called by
 *  the JWSO form the moment a line's item is picked (silent, no popup). The
 *  save re-runs the same idempotent ensure, so this is a preview, not a gate. */
export async function ensureJwRmItem(
  input: EnsureJwRmItemInput,
  user: AuthContext,
): Promise<EnsureJwRmItemResponse> {
  requireWriteRole(user);
  await requireFormAccess(user, 'jw_create', 'entry');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rm = await ensureRmItemForOrderItem(tx, companyId, input.itemId, user.id);
    return {
      rmItemId: rm.rmItemId,
      rmItemCode: rm.rmItemCode,
      rmItemName: rm.rmItemName,
      created: rm.created,
    };
  });
}

export async function createJobWorkOrder(
  input: CreateJobWorkOrderInput,
  user: AuthContext,
): Promise<JobWorkOrderDetail> {
  requireWriteRole(user);
  await requireFormAccess(user, 'jw_create', 'entry');
  const companyId = requireCompany(user);
  // ADR-203 rule 8: a user who may not see prices does not set them either —
  // their rate / GST % are ignored and the response is masked like a read.
  const showMoney = await canSeeFormPrice(user, 'jw_create');
  const h = input.header;
  input.lines.forEach((l, i) => {
    if (l.dueDate) assertDueNotBeforeJwDate(`Ln ${i + 1}`, l.dueDate, h.jwDate);
  });

  // withUniqueRetry re-runs in a fresh transaction if two concurrent creates
  // collide on job_work_orders_company_code_uniq (23505) — the MAX+1 generator
  // is not race-proof on its own.
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      // Code is server-authoritative: when the client omits it (or sends blank),
      // generate the next IN-JW-##### in the company series (fixes bug 1.2). A
      // caller-supplied code is still honoured (and duplicate-checked) for parity
      // with the legacy manual-entry path.
      const code = h.code?.trim() || (await nextJwCode(tx, companyId));

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
        throw new ConflictError(`JWSO No. "${code}" already exists.`);
      }

      // Client master link is mandatory (the RM register is per customer).
      // Snapshot its master name into customer_name (no free text).
      if (!h.clientId) {
        throw new ValidationError(
          'A client (from the client master) is required for a Job Work order.',
        );
      }
      const clientName = await assertClientExists(tx, h.clientId, companyId);

      const itemCodes = await loadOrderItems(
        tx,
        input.lines.map((l) => l.itemId),
        companyId,
      );
      const resolveRm = makeRmResolver(tx, companyId, h.clientId, user.id);

      const inserted = await tx
        .insert(jobWorkOrders)
        .values({
          companyId,
          code,
          jwDate: h.jwDate,
          clientId: h.clientId,
          customerName: clientName,
          clientPoNo: h.clientPoNo ?? null,
          // ADR-203 rule 6: a new JWSO is always open (status is server-owned).
          status: 'open',
          gstPercent: (showMoney ? (h.gstPercent ?? 18) : 18).toFixed(2),
          remarks: h.remarks ?? null,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning();
      const header = inserted[0]!;

      const lineValues: Array<typeof jobWorkOrderLines.$inferInsert> = [];
      for (const [i, l] of input.lines.entries()) {
        const rm = await resolveRm(l.itemId);
        lineValues.push({
          companyId,
          jobWorkOrderId: header.id,
          // ADR-203: numbered by the server, 1..n on a new JWSO.
          lineNo: i + 1,
          itemId: l.itemId,
          itemCodeText: itemCodes.get(l.itemId) ?? null,
          partName: l.partName,
          material: l.material ?? null,
          drawingNo: l.drawingNo ?? null,
          // The customer's drawing Rev, exactly as the user typed it (0120).
          // OPTIONAL on the input, because the server paths that raise a JWSO
          // line without asking a human have no Rev to give; those land on '0',
          // the column's DB default. ADR-177: stored upper-cased.
          revision: l.revision !== undefined ? normalizeRevision(l.revision) : '0',
          drawingFilePath: l.drawingFilePath ?? null,
          uom: l.uom ?? 'NOS',
          orderQty: l.orderQty,
          rate: showMoney ? (l.rate ?? 0).toFixed(2) : '0.00',
          dueDate: l.dueDate ?? null,
          status: 'open' as const,
          rmItemId: rm.rmItemId,
          partyMaterialId: rm.partyMaterialId,
          sourceBomMasterId: l.sourceBomMasterId ?? null,
          createdBy: user.id,
          updatedBy: user.id,
        });
      }

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

      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Create,
          entity: 'JobWorkOrder',
          entityId: header.id,
          refId: header.code,
          qty: insertedLines.reduce((a, l) => a + Number(l.orderQty), 0),
          detail: jwDetail(header.code, header.customerName),
        },
        companyId,
        user,
      );

      return loadJobWorkOrderDetail(tx, header.id, companyId, showMoney);
    }),
  );
}

export async function updateJobWorkOrder(
  id: string,
  input: UpdateJobWorkOrderInput,
  user: AuthContext,
): Promise<JobWorkOrderDetail> {
  requireWriteRole(user);
  await requireFormAccess(user, 'jw_create', 'edit');
  const companyId = requireCompany(user);
  // Money in, same rule as money out. `priceOff` makes "can do the job but must
  // not see the number" a supported setup, so an editor with prices hidden is a
  // real user — and their form posts back money fields it never showed them.
  // Ignore them here — what is stored stands.
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
      .for('update')
      .limit(1);
    const existingHdr = existingHdrRows[0];
    if (!existingHdr) throw new NotFoundError('JWSO not found. It may have been moved to Trash.');
    // R5: refuse the save if someone else edited the JWSO after this form opened it.
    assertUnchangedSinceOpened(existingHdr.updatedAt, input.expectedUpdatedAt);

    // ADR-203 rule 4: lock every live line before reading what uses them, so
    // no Job Card / Party GRN can attach between the check and the write.
    const existingLines = await tx
      .select()
      .from(jobWorkOrderLines)
      .where(and(eq(jobWorkOrderLines.jobWorkOrderId, id), isNull(jobWorkOrderLines.deletedAt)))
      .for('update');
    const usage = await jwLineUsage(
      tx,
      existingLines.map((l) => l.id),
    );

    const h = input.header;
    const nextClientId = h.clientId !== undefined ? (h.clientId ?? null) : existingHdr.clientId;
    if (nextClientId !== existingHdr.clientId && usage.size > 0) {
      const inUse = existingLines
        .filter((l) => usage.has(l.id))
        .map((l) => usageLabel(l.lineNo, usage.get(l.id)!));
      throw new ConflictError(
        `The customer cannot be changed — ${inUse.join('; ')} already use this JWSO's lines.`,
      );
    }

    // When the client changes, snapshot the customer name from the master.
    let snapshotClientName: string | null = null;
    if (h.clientId !== undefined && nextClientId) {
      snapshotClientName = await assertClientExists(
        tx,
        nextClientId,
        companyId,
        existingHdr.clientId,
      );
    }

    // Status is server-owned (ADR-203): never taken from the payload; derived
    // from the lines by recomputeJwHeaderStatus below. The header-level
    // customer material (client_material / _qty) is no longer written — each
    // LINE carries its own RM; the old columns stay readable as legacy.
    const updates: Record<string, unknown> = { updatedBy: user.id };
    if (h.jwDate !== undefined) updates['jwDate'] = h.jwDate;
    if (h.clientId !== undefined) updates['clientId'] = nextClientId;
    if (snapshotClientName !== null) updates['customerName'] = snapshotClientName;
    else if (h.customerName !== undefined) updates['customerName'] = h.customerName ?? null;
    if (h.clientPoNo !== undefined) updates['clientPoNo'] = h.clientPoNo ?? null;
    if (h.gstPercent !== undefined && showMoney)
      updates['gstPercent'] = Number(h.gstPercent).toFixed(2);
    if (h.remarks !== undefined) updates['remarks'] = h.remarks ?? null;

    // ADR-197: before → after of the header, read BEFORE the update.
    const headerChanges = diffFields(existingHdr, updates, JW_HEADER_FIELDS);

    await tx.update(jobWorkOrders).set(updates).where(eq(jobWorkOrders.id, id));

    const resolveRm = makeRmResolver(tx, companyId, nextClientId, user.id);
    const lineLogs =
      input.lines !== undefined
        ? await mergeLines(tx, {
            jobWorkOrderId: id,
            companyId,
            inputLines: input.lines,
            existing: existingLines,
            usage,
            user,
            showMoney,
            resolveRm,
            jwDate: h.jwDate ?? existingHdr.jwDate,
          })
        : [];

    // ADR-203 rule 1: every live line — sent or not — ends the save with its RM
    // and the (possibly new) customer's party material.
    await wireLineRm(tx, {
      jobWorkOrderId: id,
      companyId,
      clientId: nextClientId,
      clientChanged: nextClientId !== existingHdr.clientId,
      usage,
      userId: user.id,
    });
    // ADR-203 rule 7: header status follows the lines.
    await recomputeJwHeaderStatus(tx, id, user.id);

    const updatedHdrRows = await tx
      .select({
        id: jobWorkOrders.id,
        code: jobWorkOrders.code,
        customerName: jobWorkOrders.customerName,
      })
      .from(jobWorkOrders)
      .where(eq(jobWorkOrders.id, id))
      .limit(1);
    const updatedHdr = updatedHdrRows[0]!;

    // ADR-197: one row for the header (only when a header field changed) and
    // one per line added / changed / removed, each carrying its own lineRef.
    if (headerChanges.length > 0) {
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Edit,
          entity: 'JobWorkOrder',
          entityId: updatedHdr.id,
          refId: updatedHdr.code,
          changes: headerChanges,
          detail: `Edited ${jwDetail(updatedHdr.code, updatedHdr.customerName)}`,
        },
        companyId,
        user,
      );
    }
    for (const l of lineLogs) {
      await emitActivityLog(
        tx,
        {
          action: l.action,
          entity: 'JobWorkOrder',
          entityId: updatedHdr.id,
          refId: updatedHdr.code,
          lineRef: `Line ${l.lineNo}`,
          qty: l.qty ?? null,
          changes: l.changes ?? null,
          detail: `${updatedHdr.code} Ln ${l.lineNo} ${l.what}`,
        },
        companyId,
        user,
      );
    }

    return loadJobWorkOrderDetail(tx, id, companyId, showMoney);
  });
}

/** ADR-197 — one line's add / edit / remove, logged by updateJobWorkOrder. */
interface JwLineLog {
  action: ActivityAction;
  lineNo: number;
  what: string;
  qty?: number;
  changes?: ActivityChange[];
}

/** JWSO header fields compared on Edit — labels as on the JWSO form. */
const JW_HEADER_FIELDS: readonly DiffField[] = [
  { key: 'jwDate', label: 'JWSO Date' },
  { key: 'customerName', label: 'Customer' },
  { key: 'clientPoNo', label: 'Client PO No.' },
  { key: 'gstPercent', label: 'GST %' },
  { key: 'remarks', label: 'Remarks' },
];

/** JWSO line fields compared on Edit — labels as on the JWSO form's line grid. */
function jwLineFields(itemCode: (v: unknown) => string | null): readonly DiffField[] {
  const fileName = (v: unknown): string | null =>
    v == null || v === '' ? null : (String(v).split('/').pop() ?? String(v));
  return [
    { key: 'itemId', label: 'Item Code', format: itemCode },
    // ADR-203: the line's customer raw material (`<item>-RM`).
    { key: 'rmItemId', label: 'Customer RM', format: itemCode },
    { key: 'partName', label: 'Item Name' },
    { key: 'material', label: 'Material' },
    { key: 'drawingNo', label: 'Drawing No.' },
    { key: 'revision', label: 'Rev' },
    { key: 'drawingFilePath', label: 'Drawing File', format: fileName },
    { key: 'uom', label: 'UOM' },
    { key: 'orderQty', label: 'Order Qty' },
    { key: 'rate', label: 'Rate' },
    { key: 'dueDate', label: 'Due Date' },
    {
      key: 'sourceBomMasterId',
      label: 'Assembly BOM',
      format: (v) => (v == null || v === '' ? null : 'Linked'),
    },
  ];
}

/** ADR-203 rule 4: the least a line's Order Qty may be — what has already
 *  been returned, invoiced, or put on (non-recovery) Job Cards for it. */
async function orderQtyFloor(
  tx: DbTransaction,
  companyId: string,
  line: typeof jobWorkOrderLines.$inferSelect,
): Promise<{ floor: number; jcQty: number }> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(SUM(order_qty), 0)::int AS qty
      FROM public.job_cards
     WHERE source_jw_line_id = ${line.id}::uuid AND company_id = ${companyId}::uuid
       AND deleted_at IS NULL AND recovery_kind IS NULL
  `)) as unknown as Array<{ qty: number }>;
  const jcQty = Number(rows[0]?.qty ?? 0);
  // Code review fix: customer material already accepted, or received and
  // waiting for QC, on this line also holds the qty up (1 RM piece per part).
  const mat = (await tx.execute(sql`
    SELECT COALESCE(SUM(CASE WHEN pgl.qc_at IS NULL AND pgl.accepted_qty = 0 AND pgl.rejected_qty = 0
                             THEN pgl.received_qty ELSE pgl.accepted_qty END), 0)::int AS qty
      FROM public.party_grn_lines pgl
      JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
     WHERE pgl.jw_line_id = ${line.id}::uuid AND pgl.deleted_at IS NULL
  `)) as unknown as Array<{ qty: number }>;
  const matQty = Number(mat[0]?.qty ?? 0);
  return { floor: Math.max(line.returnedQty, line.invoicedQty, jcQty, matQty), jcQty };
}

async function mergeLines(
  tx: DbTransaction,
  p: {
    jobWorkOrderId: string;
    companyId: string;
    inputLines: JobWorkOrderLineInput[];
    /** The live lines, already locked FOR UPDATE by the caller. */
    existing: Array<typeof jobWorkOrderLines.$inferSelect>;
    usage: Map<string, string[]>;
    user: AuthContext;
    /** False when the caller may not see money on this form — their payload's
     *  `rate` is then ignored (an existing line keeps its figure, a new line
     *  gets 0), same rule as create. */
    showMoney: boolean;
    resolveRm: RmResolver;
    /** The JWSO date after this save — a line's due date may not precede it. */
    jwDate: string;
  },
): Promise<JwLineLog[]> {
  const { jobWorkOrderId, companyId, inputLines, existing, usage, user, showMoney, resolveRm } = p;
  const existingById = new Map(existing.map((e) => [e.id, e]));

  // ADR-203 rule 3: a line id must be a live line of THIS JWSO.
  const seenInputIds = new Set<string>();
  for (const l of inputLines) {
    if (l.id === undefined) continue;
    if (!existingById.has(l.id)) {
      throw new ValidationError(
        'A line on this form is no longer on the JWSO (removed or from another order). Reload and redo your change.',
      );
    }
    if (seenInputIds.has(l.id)) {
      throw new ValidationError('The same JWSO line was sent twice. Reload and redo your change.');
    }
    seenInputIds.add(l.id);
  }

  const itemCodes = await loadOrderItems(
    tx,
    inputLines.map((l) => l.itemId),
    companyId,
  );

  const toInsert = inputLines.filter((l) => l.id === undefined);
  const toUpdate = inputLines.flatMap((l) => (l.id !== undefined ? [{ id: l.id, data: l }] : []));
  const absentIds = existing.map((e) => e.id).filter((eid) => !seenInputIds.has(eid));

  // ADR-203 rule 4: a line a document already uses cannot be removed.
  const blocked = absentIds.filter((eid) => usage.has(eid));
  if (blocked.length > 0) {
    const labels = blocked.map((eid) => usageLabel(existingById.get(eid)!.lineNo, usage.get(eid)!));
    throw new ConflictError(
      `${labels.join('; ')} ${blocked.length === 1 ? 'is' : 'are'} already in use and cannot be removed — Short-close the line instead.`,
    );
  }

  // Customer RM per sent line (rule 1) — resolved up front so the History diff
  // can name the RM codes.
  // Code review fix: only NEW lines and lines whose item CHANGES need an RM
  // here (errors stop the save). An unchanged line keeps the RM it has — an
  // in-use line's receipts are booked on it; a legacy line without one is
  // backfilled best-effort by wireLineRm after the merge.
  const rmByItem = new Map<string, { rmItemId: string; partyMaterialId: string }>();
  for (const l of inputLines) {
    const before = l.id ? existingById.get(l.id) : undefined;
    const needs = !before || before.itemId !== l.itemId;
    if (needs && !rmByItem.has(l.itemId)) rmByItem.set(l.itemId, await resolveRm(l.itemId));
  }

  if (absentIds.length > 0) {
    await tx
      .update(jobWorkOrderLines)
      .set({ ...softDeleteStamp(user), updatedBy: user.id })
      .where(inArray(jobWorkOrderLines.id, absentIds));
  }

  // ADR-197: Item Code / Customer RM changes read as codes, not uuids.
  const codeById = await resolveItemCodesById(
    tx,
    [
      ...existing.map((e) => e.itemId),
      ...existing.map((e) => e.rmItemId),
      ...inputLines.map((l) => l.itemId),
      ...Array.from(rmByItem.values()).map((r) => r.rmItemId),
    ],
    companyId,
  );
  const lineFields = jwLineFields((v) =>
    v == null || v === '' ? null : (codeById.get(String(v))?.code ?? String(v)),
  );
  const logs: JwLineLog[] = [];
  for (const eid of absentIds) {
    const gone = existingById.get(eid)!;
    const itemCode = gone.itemId
      ? (codeById.get(gone.itemId)?.code ?? gone.itemCodeText)
      : gone.itemCodeText;
    logs.push({
      action: ActivityAction.Edit,
      lineNo: gone.lineNo,
      what: 'removed',
      changes: [
        {
          field: 'line',
          label: 'Line',
          before: `${itemCode ?? gone.partName} × ${gone.orderQty}`,
          after: null,
        },
      ],
    });
  }

  for (const u of toUpdate) {
    const before = existingById.get(u.id)!;
    const ln = `Ln ${before.lineNo}`;
    const inUseDocs = usage.get(u.id);
    const itemChanged = u.data.itemId !== before.itemId;
    const uomChanged = u.data.uom !== undefined && u.data.uom !== before.uom;
    const bomChanged =
      u.data.sourceBomMasterId !== undefined &&
      u.data.sourceBomMasterId !== before.sourceBomMasterId;
    // ADR-203 rule 4: item / UOM / BOM are locked once a document uses the line.
    if (inUseDocs && (itemChanged || uomChanged || bomChanged)) {
      const what = itemChanged ? 'Item Code' : uomChanged ? 'UOM' : 'Assembly BOM';
      throw new ConflictError(
        `${usageLabel(before.lineNo, inUseDocs)} is already in use — its ${what} cannot be changed.`,
      );
    }

    const rm = itemChanged ? rmByItem.get(u.data.itemId) : undefined;
    const lineUpdate: Record<string, unknown> = {
      updatedBy: user.id,
      itemId: u.data.itemId,
      ...(rm ? { rmItemId: rm.rmItemId, partyMaterialId: rm.partyMaterialId } : {}),
    };
    // The code snapshot follows the item; an unchanged item keeps the code it
    // was raised with (older rows that stored null get it filled).
    if (itemChanged || !before.itemCodeText) {
      lineUpdate['itemCodeText'] = itemCodes.get(u.data.itemId) ?? null;
    }
    lineUpdate['partName'] = u.data.partName;
    // `null` clears; absent leaves the stored value.
    if (u.data.material !== undefined) lineUpdate['material'] = u.data.material ?? null;
    if (u.data.drawingNo !== undefined) lineUpdate['drawingNo'] = u.data.drawingNo ?? null;
    // ADR-177: a Rev is stored upper-cased and may never go backwards on a
    // line (B → A, 2 → 1). A change of kind (1 → A) is allowed.
    if (u.data.revision !== undefined) {
      const nextRevision = normalizeRevision(u.data.revision);
      if (revisionGoesBackwards(before.revision, nextRevision)) {
        throw new ValidationError(
          revisionBackwardsMessage(before.lineNo, before.revision, nextRevision),
        );
      }
      lineUpdate['revision'] = nextRevision;
    }
    if (u.data.drawingFilePath !== undefined)
      lineUpdate['drawingFilePath'] = u.data.drawingFilePath ?? null;
    // UOM only changes when it is sent.
    if (u.data.uom !== undefined) lineUpdate['uom'] = u.data.uom;
    if (u.data.orderQty !== before.orderQty) {
      if (u.data.orderQty < before.orderQty) {
        const { floor, jcQty } = await orderQtyFloor(tx, companyId, before);
        if (u.data.orderQty < floor) {
          throw new ValidationError(
            `${ln}: Order Qty cannot go below ${floor} — returned ${before.returnedQty}, invoiced ${before.invoicedQty}, on Job Cards ${jcQty}, or customer material already received for it.`,
          );
        }
      }
      lineUpdate['orderQty'] = u.data.orderQty;
    }
    if (u.data.rate !== undefined && showMoney) lineUpdate['rate'] = u.data.rate.toFixed(2);
    if (u.data.dueDate !== undefined) {
      if (u.data.dueDate !== null && u.data.dueDate !== before.dueDate) {
        assertDueNotBeforeJwDate(ln, u.data.dueDate, p.jwDate);
      }
      lineUpdate['dueDate'] = u.data.dueDate;
    }
    if (u.data.sourceBomMasterId !== undefined) {
      // Validate before storing. Deliberately does NOT re-cascade: the cascade
      // is idempotent on existing child JCs, so re-pointing a line that already
      // spawned work would silently change the BOM of record without changing
      // the shop floor. Same behaviour as the sales-order update path.
      if (bomChanged) await assertBomUsableForJobWork(tx, u.data.sourceBomMasterId, companyId);
      lineUpdate['sourceBomMasterId'] = u.data.sourceBomMasterId;
    }
    // Line status is server-owned (ADR-203 rule 3) — never taken from input.

    const lineChanges = diffFields(before, lineUpdate, lineFields);
    await tx.update(jobWorkOrderLines).set(lineUpdate).where(eq(jobWorkOrderLines.id, u.id));
    if (lineChanges.length > 0) {
      logs.push({
        action: ActivityAction.Edit,
        lineNo: before.lineNo,
        what: 'edited',
        changes: lineChanges,
      });
    }
  }

  if (toInsert.length > 0) {
    // ADR-203 rule 3: a new line takes MAX(line_no)+1 over EVERY line this
    // JWSO ever had — removed ones included — so a number is never reused
    // (History and printed papers name lines by number). Safe under the
    // header row lock the caller holds.
    const maxRows = (await tx.execute(sql`
      SELECT COALESCE(MAX(line_no), 0)::int AS n
        FROM public.job_work_order_lines
       WHERE job_work_order_id = ${jobWorkOrderId}::uuid
    `)) as unknown as Array<{ n: number }>;
    const startFrom = Number(maxRows[0]?.n ?? 0) + 1;
    const values = toInsert.map((l, i) => {
      const lineNo = startFrom + i;
      if (l.dueDate) assertDueNotBeforeJwDate(`Ln ${lineNo}`, l.dueDate, p.jwDate);
      const rm = rmByItem.get(l.itemId)!;
      return {
        companyId,
        jobWorkOrderId,
        lineNo,
        itemId: l.itemId,
        itemCodeText: itemCodes.get(l.itemId) ?? null,
        partName: l.partName,
        material: l.material ?? null,
        drawingNo: l.drawingNo ?? null,
        // Same as the create path: the Rev the user typed, or '0' when nobody
        // was asked. ADR-177: stored upper-cased.
        revision: l.revision !== undefined ? normalizeRevision(l.revision) : '0',
        drawingFilePath: l.drawingFilePath ?? null,
        uom: l.uom ?? 'NOS',
        orderQty: l.orderQty,
        rate: showMoney ? (l.rate ?? 0).toFixed(2) : '0.00',
        dueDate: l.dueDate ?? null,
        status: 'open' as const,
        rmItemId: rm.rmItemId,
        partyMaterialId: rm.partyMaterialId,
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
      logs.push({
        action: ActivityAction.Create,
        lineNo: line.lineNo,
        what: 'added',
        qty: line.orderQty,
      });
    }
  }
  return logs;
}

export async function softDeleteJobWorkOrder(
  id: string,
  user: AuthContext,
  /** ADR-197: why it was moved to Trash (the route requires it). */
  reason?: string,
): Promise<{ ok: true }> {
  requireWriteRole(user);
  await requireFormAccess(user, 'jw_create', 'edit');
  await requireFormAccess(user, 'jw_create', 'approve');
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
      .for('update')
      .limit(1);
    const row = existing[0];
    if (!row) {
      throw new NotFoundError('JWSO not found. It may have been moved to Trash.');
    }

    // ADR-203 rule 5: a JWSO whose lines any document uses stays.
    const lines = await tx
      .select({ id: jobWorkOrderLines.id, lineNo: jobWorkOrderLines.lineNo })
      .from(jobWorkOrderLines)
      .where(and(eq(jobWorkOrderLines.jobWorkOrderId, id), isNull(jobWorkOrderLines.deletedAt)))
      .for('update');
    const usage = await jwLineUsage(
      tx,
      lines.map((l) => l.id),
    );
    if (usage.size > 0) {
      const labels = lines
        .filter((l) => usage.has(l.id))
        .map((l) => usageLabel(l.lineNo, usage.get(l.id)!));
      throw new ConflictError(
        `${row.code} cannot be moved to Trash — ${labels.join('; ')} already use it. Short-close the lines instead.`,
      );
    }

    const stamp = softDeleteStamp(user);
    await tx
      .update(jobWorkOrderLines)
      .set({ ...stamp, updatedBy: user.id })
      .where(and(eq(jobWorkOrderLines.jobWorkOrderId, id), isNull(jobWorkOrderLines.deletedAt)));
    await tx
      .update(jobWorkOrders)
      .set({ ...stamp, updatedBy: user.id })
      .where(eq(jobWorkOrders.id, id));
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Delete,
        entity: 'JobWorkOrder',
        entityId: row.id,
        refId: row.code,
        reason: reason?.trim() || null,
        detail: jwDetail(row.code, row.customerName),
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}
