// BOM Master service (BOM-4). Ports legacy renderBOMMaster / addBOMMaster /
// editBOMMaster / delBOMMaster (legacy/InnovicERP_v82_12_3.html L8438+).
//
// Architectural notes:
//
// 1. Revision lifecycle. createBomMaster writes revision=1 + a matching
//    bom_master_revisions row with the initial lines as the snapshot.
//    updateBomMaster bumps revision by 1, snapshots the PRE-update lines
//    (so the audit trail captures what's being replaced), and auto-
//    generates a diff note if the caller didn't provide one (matches
//    legacy _bomDiffNote helper at L8629).
//
// 2. Delete guards. softDeleteBomMaster refuses if ANY non-cancelled
//    sales_order_lines row has source_bom_master_id = this.id. Mirrors
//    legacy "BOM is linked to N SOs" message; the BOM-8 cascade gives
//    that linkage real teeth.
//
// 3. Audit emission. CREATE / EDIT / DELETE rows land in activity_log
//    with entity='BOM' so the activity-log viewer can filter for BOM
//    changes (the legacy logActivity('CREATE','BOM',...) at L8602).
//
// 4. Service writes all-or-nothing in a single tx via withUserContext;
//    a partial failure (e.g. duplicate child item) rolls back BOTH the
//    header AND the lines, so the DB never holds an inconsistent BOM.

import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  assemblyUnits,
  bomMasterLines,
  bomMasterRevisions,
  bomMasters,
  items,
  plans,
  salesOrderLines,
  salesOrders,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { buildTimeline, section, toIsoDate } from '../../lib/traceability';
import { emitActivityLog } from '../activity-log/service';
import type { DocumentTraceability, RelatedDoc } from '@innovic/shared';
import type {
  BomMaster,
  BomMasterDetail,
  BomMasterLine,
  BomMasterListItem,
  BomMasterRevision,
  CreateBomMasterInput,
  CreateBomMasterLineInput,
  ListBomMastersQuery,
  ListBomMastersResponse,
  UpdateBomMasterInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

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

interface ItemsLookup {
  byId: Map<string, { code: string; name: string }>;
}

async function loadItemsByIds(
  tx: DbTransaction,
  ids: string[],
  companyId: string,
): Promise<ItemsLookup> {
  const out: ItemsLookup = { byId: new Map() };
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return out;
  const rows = await tx
    .select({ id: items.id, code: items.code, name: items.name })
    .from(items)
    .where(and(eq(items.companyId, companyId), inArray(items.id, unique), isNull(items.deletedAt)));
  for (const r of rows) out.byId.set(r.id, { code: r.code, name: r.name });
  return out;
}

async function assertItemIdsExist(
  tx: DbTransaction,
  ids: string[],
  companyId: string,
): Promise<ItemsLookup> {
  const lookup = await loadItemsByIds(tx, ids, companyId);
  const unique = Array.from(new Set(ids));
  if (lookup.byId.size !== unique.length) {
    const missing = unique.filter((id) => !lookup.byId.has(id));
    throw new ValidationError(`Item id(s) not found: ${missing.join(', ')}`);
  }
  return lookup;
}

// Generate next BOM-NNNN per company. Mirrors legacy _nextBOMNo helper —
// finds the highest numeric suffix used so far and adds 1, zero-padded
// to 4 digits.
async function nextBomNo(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT bom_no FROM public.bom_masters
    WHERE company_id = ${companyId}::uuid
      AND deleted_at IS NULL
      AND bom_no ~ '^BOM-\\d+$'
    ORDER BY (SUBSTRING(bom_no FROM 5))::int DESC
    LIMIT 1
  `)) as unknown as Array<{ bom_no: string }>;
  const last = rows[0]?.bom_no ?? null;
  let next = 1;
  if (last) {
    const m = last.match(/^BOM-(\d+)$/);
    if (m) next = parseInt(m[1]!, 10) + 1;
  }
  return `BOM-${String(next).padStart(4, '0')}`;
}

// Preview the next BOM-NNNN so the create form can prefill it before save.
// Shape stays `{ code }` for consistency with the other next-code endpoints;
// the value is the BOM number string.
export async function getNextBomNo(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({ code: await nextBomNo(tx, companyId) }));
}

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listBomMasters(
  input: ListBomMastersQuery,
  user: AuthContext,
): Promise<ListBomMastersResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term ? sql`AND (b.bom_no ILIKE ${term} OR b.bom_name ILIKE ${term})` : sql``;
    const statusFrag = input.status ? sql`AND b.status = ${input.status}::bom_status` : sql``;

    const result = await tx.execute(sql`
      SELECT
        b.id, b.company_id AS "companyId", b.bom_no AS "bomNo", b.bom_name AS "bomName",
        b.revision, b.status, b.revision_date AS "revisionDate",
        b.created_at AS "createdAt", b.created_by AS "createdBy",
        b.updated_at AS "updatedAt", b.updated_by AS "updatedBy",
        b.deleted_at AS "deletedAt",
        COALESCE(line_agg.line_count, 0)::int AS "lineCount",
        COALESCE(so_agg.linked_so_count, 0)::int AS "linkedSoCount"
      FROM public.bom_masters b
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS line_count
        FROM public.bom_master_lines l
        WHERE l.bom_master_id = b.id AND l.deleted_at IS NULL
      ) line_agg ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS linked_so_count
        FROM public.sales_order_lines sol
        WHERE sol.source_bom_master_id = b.id
          AND sol.deleted_at IS NULL
          AND sol.status <> 'cancelled'
      ) so_agg ON TRUE
      WHERE b.company_id = ${companyId}::uuid
        AND b.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
      ORDER BY b.bom_no DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [eq(bomMasters.companyId, companyId), isNull(bomMasters.deletedAt)];
    if (input.status) conditions.push(eq(bomMasters.status, input.status));
    const totalRows = await tx
      .select({ value: count() })
      .from(bomMasters)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    const itemsList = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items: itemsList, total, limit: input.limit, offset: input.offset };
  });
}

function toListItem(r: Record<string, unknown>): BomMasterListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    bomNo: r['bomNo'] as string,
    bomName: r['bomName'] as string,
    revision: Number(r['revision'] ?? 1),
    status: r['status'] as BomMasterListItem['status'],
    revisionDate: dateLike(r['revisionDate']),
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: maybeTsLike(r['deletedAt']),
    lineCount: Number(r['lineCount'] ?? 0),
    linkedSoCount: Number(r['linkedSoCount'] ?? 0),
  };
}

async function loadBomMasterDetail(
  tx: DbTransaction,
  id: string,
  companyId: string,
): Promise<BomMasterDetail> {
  const headers = await tx
    .select()
    .from(bomMasters)
    .where(
      and(eq(bomMasters.id, id), eq(bomMasters.companyId, companyId), isNull(bomMasters.deletedAt)),
    )
    .limit(1);
  const header = headers[0];
  if (!header) throw new NotFoundError(`BOM master ${id} not found`);

  // Lines with joined item code + name for display.
  const lineRows = await tx
    .select({
      line: bomMasterLines,
      itemCode: items.code,
      itemName: items.name,
    })
    .from(bomMasterLines)
    .leftJoin(items, eq(items.id, bomMasterLines.childItemId))
    .where(
      and(
        eq(bomMasterLines.bomMasterId, id),
        eq(bomMasterLines.companyId, companyId),
        isNull(bomMasterLines.deletedAt),
      ),
    )
    .orderBy(asc(bomMasterLines.lineNo));

  const revisionRows = await tx
    .select()
    .from(bomMasterRevisions)
    .where(and(eq(bomMasterRevisions.bomMasterId, id), eq(bomMasterRevisions.companyId, companyId)))
    .orderBy(desc(bomMasterRevisions.revision));

  // Linked SO count.
  const soCountRows = await tx
    .select({ value: count() })
    .from(salesOrderLines)
    .where(
      and(
        eq(salesOrderLines.sourceBomMasterId, id),
        isNull(salesOrderLines.deletedAt),
        sql`${salesOrderLines.status} <> 'cancelled'`,
      ),
    );
  const linkedSoCount = soCountRows[0]?.value ?? 0;

  return {
    id: header.id,
    companyId: header.companyId,
    bomNo: header.bomNo,
    bomName: header.bomName,
    revision: header.revision,
    status: header.status,
    revisionDate: dateLike(header.revisionDate),
    createdAt: tsLike(header.createdAt),
    createdBy: header.createdBy,
    updatedAt: tsLike(header.updatedAt),
    updatedBy: header.updatedBy,
    deletedAt: maybeTsLike(header.deletedAt),
    lines: lineRows.map(
      (r): BomMasterLine => ({
        id: r.line.id,
        companyId: r.line.companyId,
        bomMasterId: r.line.bomMasterId,
        lineNo: r.line.lineNo,
        childItemId: r.line.childItemId,
        qtyPerSet: r.line.qtyPerSet,
        bomType: r.line.bomType,
        createdAt: tsLike(r.line.createdAt),
        createdBy: r.line.createdBy,
        updatedAt: tsLike(r.line.updatedAt),
        updatedBy: r.line.updatedBy,
        deletedAt: maybeTsLike(r.line.deletedAt),
        childItemCode: r.itemCode,
        childItemName: r.itemName,
      }),
    ),
    revisions: revisionRows.map(
      (r): BomMasterRevision => ({
        id: r.id,
        companyId: r.companyId,
        bomMasterId: r.bomMasterId,
        revision: r.revision,
        changedByText: r.changedByText,
        notes: r.notes,
        itemsSnapshot: r.itemsSnapshot as BomMasterRevision['itemsSnapshot'],
        createdAt: tsLike(r.createdAt),
        createdBy: r.createdBy,
      }),
    ),
    linkedSoCount,
  };
}

export async function getBomMaster(id: string, user: AuthContext): Promise<BomMasterDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => loadBomMasterDetail(tx, id, companyId));
}

/**
 * Read-only document traceability for a BOM master (GET /bom-masters/:id/related).
 * FK-derived, company-scoped, soft-delete filtered — no business rule, no write.
 *
 * Upstream (source) relationships:
 *   - bom_master_lines.child_item_id → DISTINCT items (the component items this BOM is built from)
 *
 * Downstream (consumer) relationships:
 *   - sales_order_lines.source_bom_master_id = :id → DISTINCT sales_orders (via sales_order_id)
 *   - plans.bom_master_id     = :id
 *   - assembly_units.bom_master_id = :id  (assembly route is SO-scoped → linkId = sales_order_id)
 */
export async function getBomMasterRelated(
  id: string,
  user: AuthContext,
): Promise<DocumentTraceability> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Confirm the BOM exists / is visible before gathering related docs.
    const headers = await tx
      .select({
        id: bomMasters.id,
        code: bomMasters.bomNo,
        status: bomMasters.status,
        revisionDate: bomMasters.revisionDate,
      })
      .from(bomMasters)
      .where(
        and(
          eq(bomMasters.id, id),
          eq(bomMasters.companyId, companyId),
          isNull(bomMasters.deletedAt),
        ),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError(`BOM master ${id} not found`);

    // ── Upstream: distinct component items referenced by this BOM's lines ────
    const itemRows = await tx
      .selectDistinct({ id: items.id, code: items.code, name: items.name })
      .from(items)
      .innerJoin(bomMasterLines, eq(bomMasterLines.childItemId, items.id))
      .where(
        and(
          eq(bomMasterLines.bomMasterId, id),
          isNull(bomMasterLines.deletedAt),
          eq(items.companyId, companyId),
          isNull(items.deletedAt),
        ),
      )
      .orderBy(asc(items.code));

    // ── Downstream: distinct sales orders that source this BOM on any line ───
    const soRows = await tx
      .selectDistinct({
        id: salesOrders.id,
        code: salesOrders.code,
        status: salesOrders.status,
        date: salesOrders.soDate,
      })
      .from(salesOrders)
      .innerJoin(salesOrderLines, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .where(
        and(
          eq(salesOrderLines.sourceBomMasterId, id),
          isNull(salesOrderLines.deletedAt),
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
        ),
      )
      .orderBy(desc(salesOrders.soDate));

    // ── Downstream: plans built against this BOM ─────────────────────────────
    const planRows = await tx
      .select({
        id: plans.id,
        code: plans.code,
        status: plans.planStatus,
        date: plans.planDate,
      })
      .from(plans)
      .where(
        and(
          eq(plans.bomMasterId, id),
          eq(plans.companyId, companyId),
          isNull(plans.deletedAt),
        ),
      )
      .orderBy(desc(plans.planDate));

    // ── Downstream: assembly units built against this BOM ────────────────────
    const assemblyRows = await tx
      .select({
        id: assemblyUnits.id,
        salesOrderId: assemblyUnits.salesOrderId,
        unitNo: assemblyUnits.unitNo,
        serialNo: assemblyUnits.serialNo,
        dispatched: assemblyUnits.dispatched,
        date: assemblyUnits.assemblyDate,
      })
      .from(assemblyUnits)
      .where(
        and(
          eq(assemblyUnits.bomMasterId, id),
          eq(assemblyUnits.companyId, companyId),
          isNull(assemblyUnits.deletedAt),
        ),
      )
      .orderBy(asc(assemblyUnits.unitNo));

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

    // ── Upstream sections (what this BOM is built FROM) ──────────────────────
    const itemSection = section(
      'item',
      'Component Items',
      '📦',
      'item',
      itemRows.map((r) => row(r.id, r.code, null, null, { label: r.name })),
    );

    // ── Downstream sections (what consumes this BOM) ─────────────────────────
    const soSection = section(
      'sales-orders',
      'Sales Orders',
      '📄',
      'sales-order',
      soRows.map((r) => row(r.id, r.code, r.status, r.date)),
    );
    const plansSection = section(
      'plans',
      'Planning',
      '🗂',
      'plan',
      planRows.map((r) => row(r.id, r.code, r.status, r.date)),
    );
    const assemblySection = section(
      'assembly',
      'Assembly Units',
      '🧩',
      // Assembly detail is SO-scoped (/assemblies/$soId) — link each unit to its SO.
      'assembly',
      assemblyRows.map((r) =>
        row(
          r.id,
          r.serialNo ?? `Unit #${r.unitNo}`,
          r.dispatched ? 'dispatched' : 'assembled',
          r.date,
          { linkId: r.salesOrderId },
        ),
      ),
    );

    const upstream = [itemSection];
    const downstream = [soSection, plansSection, assemblySection];
    return {
      self: { module: 'bom-masters', code: header.code },
      upstream,
      downstream,
      related: [],
      timeline: buildTimeline(
        {
          ts: toIsoDate(header.revisionDate),
          label: 'BOM created',
          code: header.code,
          routeKind: 'bom-master',
          linkId: id,
        },
        [...upstream, ...downstream],
      ),
    };
  });
}

// ─── Writes ───────────────────────────────────────────────────────────────

function bomDetailString(bomNo: string, bomName: string): string {
  return `${bomNo} — ${bomName}`;
}

// Build a human-readable diff between two line sets — what was added,
// what was removed, which items changed qty / bom_type. Used as the
// fallback revision note when the caller didn't supply one.
//
// `oldLines` is the snapshot we're about to replace; `newLines` is the
// fresh input. Both are keyed by childItemId.
interface DiffLine {
  childItemId: string;
  childItemCode?: string | null;
  qtyPerSet: string;
  bomType: string;
}

export function computeBomDiffNote(oldLines: DiffLine[], newLines: DiffLine[]): string {
  const oldByItem = new Map(oldLines.map((l) => [l.childItemId, l]));
  const newByItem = new Map(newLines.map((l) => [l.childItemId, l]));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [id, nl] of newByItem) {
    const ol = oldByItem.get(id);
    const label = nl.childItemCode ?? id.slice(0, 8);
    if (!ol) {
      added.push(label);
    } else if (Number(ol.qtyPerSet) !== Number(nl.qtyPerSet) || ol.bomType !== nl.bomType) {
      const parts: string[] = [];
      if (Number(ol.qtyPerSet) !== Number(nl.qtyPerSet)) {
        parts.push(`qty ${ol.qtyPerSet} → ${nl.qtyPerSet}`);
      }
      if (ol.bomType !== nl.bomType) parts.push(`type ${ol.bomType} → ${nl.bomType}`);
      changed.push(`${label} (${parts.join(', ')})`);
    }
  }
  for (const [id, ol] of oldByItem) {
    if (!newByItem.has(id)) {
      const label = ol.childItemCode ?? id.slice(0, 8);
      removed.push(label);
    }
  }

  const segs: string[] = [];
  if (added.length > 0) segs.push(`Added: ${added.join(', ')}`);
  if (removed.length > 0) segs.push(`Removed: ${removed.join(', ')}`);
  if (changed.length > 0) segs.push(`Changed: ${changed.join(', ')}`);
  return segs.length > 0 ? segs.join(' · ') : 'No item changes';
}

export async function createBomMaster(
  input: CreateBomMasterInput,
  user: AuthContext,
): Promise<BomMasterDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // Validate items exist + capture their codes for the revision snapshot.
    const itemIds = input.lines.map((l) => l.childItemId);
    const itemsLookup = await assertItemIdsExist(tx, itemIds, companyId);

    // Auto bomNo when not supplied; reject if supplied + already used.
    const bomNo = input.bomNo?.trim() || (await nextBomNo(tx, companyId));
    if (input.bomNo) {
      const dup = await tx
        .select({ id: bomMasters.id })
        .from(bomMasters)
        .where(
          and(
            eq(bomMasters.companyId, companyId),
            eq(bomMasters.bomNo, bomNo),
            isNull(bomMasters.deletedAt),
          ),
        )
        .limit(1);
      if (dup.length > 0) {
        throw new ConflictError(`BOM No. "${bomNo}" already exists`);
      }
    }

    const inserted = await tx
      .insert(bomMasters)
      .values({
        companyId,
        bomNo,
        bomName: input.bomName,
        revision: 1,
        status: input.status,
        revisionDate: sql`current_date` as unknown as string,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = inserted[0]!;

    const lineValues = assignLineValues(input.lines, header.id, companyId, user.id);
    await tx.insert(bomMasterLines).values(lineValues);

    // Initial revision row capturing the lines at creation.
    const snapshot = buildItemsSnapshot(input.lines, itemsLookup);
    await tx.insert(bomMasterRevisions).values({
      companyId,
      bomMasterId: header.id,
      revision: 1,
      changedByText: user.email ?? user.id,
      notes: 'Initial creation',
      itemsSnapshot: snapshot,
      createdBy: user.id,
    });

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'BOM',
        detail: bomDetailString(header.bomNo, header.bomName),
        refId: header.bomNo,
      },
      companyId,
      user,
    );

    return loadBomMasterDetail(tx, header.id, companyId);
  });
}

export async function updateBomMaster(
  id: string,
  input: UpdateBomMasterInput,
  user: AuthContext,
): Promise<BomMasterDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const headers = await tx
      .select()
      .from(bomMasters)
      .where(
        and(
          eq(bomMasters.id, id),
          eq(bomMasters.companyId, companyId),
          isNull(bomMasters.deletedAt),
        ),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError(`BOM master ${id} not found`);

    // bomNo collision check (only when it changed).
    if (input.bomNo !== header.bomNo) {
      const dup = await tx
        .select({ id: bomMasters.id })
        .from(bomMasters)
        .where(
          and(
            eq(bomMasters.companyId, companyId),
            eq(bomMasters.bomNo, input.bomNo),
            isNull(bomMasters.deletedAt),
            sql`${bomMasters.id} != ${id}::uuid`,
          ),
        )
        .limit(1);
      if (dup.length > 0) throw new ConflictError(`BOM No. "${input.bomNo}" already exists`);
    }

    // Validate items exist.
    const itemIds = input.lines.map((l) => l.childItemId);
    const itemsLookup = await assertItemIdsExist(tx, itemIds, companyId);

    // Capture PRE-update lines for the revision snapshot + diff note.
    const oldLineRows = await tx
      .select({
        line: bomMasterLines,
        itemCode: items.code,
      })
      .from(bomMasterLines)
      .leftJoin(items, eq(items.id, bomMasterLines.childItemId))
      .where(and(eq(bomMasterLines.bomMasterId, id), isNull(bomMasterLines.deletedAt)));
    const oldSnapshot: DiffLine[] = oldLineRows.map((r) => ({
      childItemId: r.line.childItemId,
      childItemCode: r.itemCode,
      qtyPerSet: r.line.qtyPerSet,
      bomType: r.line.bomType,
    }));

    const newSnapshot: DiffLine[] = input.lines.map((l) => ({
      childItemId: l.childItemId,
      childItemCode: itemsLookup.byId.get(l.childItemId)?.code ?? null,
      qtyPerSet: l.qtyPerSet.toFixed(2),
      bomType: l.bomType,
    }));

    const autoNote = computeBomDiffNote(oldSnapshot, newSnapshot);
    const finalNote = input.revisionNote?.trim() || autoNote;

    // Hard-delete old line rows (they're already in the revision snapshot).
    // Cascade-delete via FK is not appropriate because we want soft-delete
    // semantics? Actually no: line rows are derived from the BOM and the
    // pre-state IS in bom_master_revisions. Hard delete is correct here.
    await tx.delete(bomMasterLines).where(eq(bomMasterLines.bomMasterId, id));

    const newRevision = header.revision + 1;

    // Bump header revision + write new lines + append revision row.
    await tx
      .update(bomMasters)
      .set({
        bomNo: input.bomNo,
        bomName: input.bomName,
        status: input.status,
        revision: newRevision,
        revisionDate: sql`current_date` as unknown as string,
        updatedBy: user.id,
      })
      .where(eq(bomMasters.id, id));

    const lineValues = assignLineValues(input.lines, id, companyId, user.id);
    await tx.insert(bomMasterLines).values(lineValues);

    await tx.insert(bomMasterRevisions).values({
      companyId,
      bomMasterId: id,
      revision: newRevision,
      changedByText: user.email ?? user.id,
      notes: finalNote,
      itemsSnapshot: buildItemsSnapshot(input.lines, itemsLookup),
      createdBy: user.id,
    });

    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'BOM',
        detail: `${bomDetailString(input.bomNo, input.bomName)} (Rev ${header.revision} → ${newRevision})`,
        refId: input.bomNo,
      },
      companyId,
      user,
    );

    return loadBomMasterDetail(tx, id, companyId);
  });
}

export async function softDeleteBomMaster(id: string, user: AuthContext): Promise<BomMaster> {
  if (user.role !== 'admin') {
    throw new AuthorizationError(`Role "${user.role}" cannot delete BOM masters — admin required`);
  }
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const headers = await tx
      .select()
      .from(bomMasters)
      .where(
        and(
          eq(bomMasters.id, id),
          eq(bomMasters.companyId, companyId),
          isNull(bomMasters.deletedAt),
        ),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError(`BOM master ${id} not found`);

    // Block if any non-cancelled SO line links this BOM (BOM-8 cascade).
    const links = await tx
      .select({ value: count() })
      .from(salesOrderLines)
      .where(
        and(
          eq(salesOrderLines.sourceBomMasterId, id),
          isNull(salesOrderLines.deletedAt),
          sql`${salesOrderLines.status} <> 'cancelled'`,
        ),
      );
    const linkedCount = links[0]?.value ?? 0;
    if (linkedCount > 0) {
      throw new ConflictError(
        `BOM "${header.bomNo}" is linked to ${linkedCount} sales order line(s); cannot delete`,
      );
    }

    await tx
      .update(bomMasters)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(bomMasters.id, id));

    await emitActivityLog(
      tx,
      {
        action: 'DELETE',
        entity: 'BOM',
        detail: bomDetailString(header.bomNo, header.bomName),
        refId: header.bomNo,
      },
      companyId,
      user,
    );

    return {
      id: header.id,
      companyId: header.companyId,
      bomNo: header.bomNo,
      bomName: header.bomName,
      revision: header.revision,
      status: header.status,
      revisionDate: dateLike(header.revisionDate),
      createdAt: tsLike(header.createdAt),
      createdBy: header.createdBy,
      updatedAt: tsLike(header.updatedAt),
      updatedBy: header.updatedBy,
      deletedAt: new Date().toISOString(),
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function assignLineValues(
  lines: CreateBomMasterLineInput[],
  bomMasterId: string,
  companyId: string,
  userId: string,
): Array<typeof bomMasterLines.$inferInsert> {
  return lines.map((l, i) => ({
    companyId,
    bomMasterId,
    lineNo: i + 1,
    childItemId: l.childItemId,
    qtyPerSet: l.qtyPerSet.toFixed(2),
    bomType: l.bomType,
    createdBy: userId,
    updatedBy: userId,
  }));
}

function buildItemsSnapshot(lines: CreateBomMasterLineInput[], itemsLookup: ItemsLookup): unknown {
  return lines.map((l) => ({
    childItemId: l.childItemId,
    childItemCode: itemsLookup.byId.get(l.childItemId)?.code ?? null,
    qtyPerSet: l.qtyPerSet.toFixed(2),
    bomType: l.bomType,
  }));
}
