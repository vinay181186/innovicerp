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
// 3. Audit emission (ADR-197). CREATE / EDIT / DELETE rows land in
//    activity_log with entity='BOM' + entityId, so the BOM's History panel
//    finds them. An edit writes one header row (fields + BOM Rev) and one row
//    per added / removed / changed line (`Line N`) — see ./audit.ts.
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
  materialGrades,
  materialSizes,
  plans,
  salesOrderLines,
  salesOrders,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { BOM_SF_COLUMNS } from './sf-columns';
import { requireFormAccess } from '../../lib/access';
import { buildImportTemplateBuffer } from '../../lib/excel-template';
import { listMaterialGrades } from '../material-grades/service';
import { listMaterialSizes } from '../material-sizes/service';
import { requireWriteRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { lockDocSeries } from '../../lib/doc-series-lock';
import { assertUnchangedSinceOpened } from '../../lib/edit-conflict';
import { softDeleteStamp } from '../../lib/audit-trail';
import { buildTimeline, section, toIsoDate } from '../../lib/traceability';
import { emitActivityLog } from '../activity-log/service';
import {
  ActivityAction,
  BOM_CREATE_STATUSES,
  BOM_LINE_TYPES,
  BOM_STATUS_MOVES,
  canMoveStatus,
  qtyUomProblem,
  statusMoveRefusal,
} from '@innovic/shared';
import type { DocumentEditStagedResult, DocumentTraceability, RelatedDoc } from '@innovic/shared';
import { type BomAuditLine, bomHeaderChanges, bomLineAuditRows } from './audit';
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
  byId: Map<string, { code: string; name: string; uom: string }>;
}

/** Screen words for BOM Status (docs/NAMING.md). */
const BOM_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Draft',
  active: 'Active',
  obsolete: 'Obsolete',
};

async function loadItemsByIds(
  tx: DbTransaction,
  ids: string[],
  companyId: string,
): Promise<ItemsLookup> {
  const out: ItemsLookup = { byId: new Map() };
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return out;
  const rows = await tx
    .select({ id: items.id, code: items.code, name: items.name, uom: items.uom })
    .from(items)
    .where(and(eq(items.companyId, companyId), inArray(items.id, unique), isNull(items.deletedAt)));
  for (const r of rows) out.byId.set(r.id, { code: r.code, name: r.name, uom: r.uom });
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
    throw new ValidationError(
      `Item not found on this BOM (${missing.length} row(s)). Pick it again from Item Master.`,
    );
  }
  return lookup;
}

// A BOM lists each child part once, with one qty/set. Two lines for the same
// item would double-count in every downstream plan, so refuse the save and say
// which part collided — a bare unique-constraint violation from Postgres tells
// the user nothing they can act on. The web form blocks this too; this is the
// backstop for the API and the Excel import.
// The parent must be a real item in this company, and it must not appear among
// its own children — a BOM that builds X out of X is a loop, and planning would
// explode it forever. The shared Zod refine catches the second case for typed
// clients; this repeats it server-side because Zod cannot see the DB.
function assertParentIsUsable(
  parentItemId: string,
  lines: ReadonlyArray<{ childItemId: string }>,
  lookup: ItemsLookup,
): void {
  const parent = lookup.byId.get(parentItemId);
  if (!parent) {
    throw new ValidationError('Parent item not found. Pick it again from Item Master.');
  }
  const at = lines.findIndex((l) => l.childItemId === parentItemId);
  if (at >= 0) {
    throw new ValidationError(
      `${parent.code} (${parent.name}) is the parent item, so it cannot also be part ${at + 1} ` +
        `of its own BOM. Remove that line, or pick a different parent.`,
    );
  }
}

function assertNoDuplicateChildItems(
  lines: ReadonlyArray<{ childItemId: string }>,
  lookup: ItemsLookup,
): void {
  const seen = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const id = lines[i]!.childItemId;
    const first = seen.get(id);
    if (first !== undefined) {
      const it = lookup.byId.get(id);
      const label = it ? `${it.code} (${it.name})` : 'this item';
      throw new ValidationError(
        `Duplicate item code on line ${i + 1}: ${label} is already on line ${first + 1}. ` +
          `A BOM can list a part only once — remove one line, or put the combined quantity on a single line.`,
      );
    }
    seen.set(id, i);
  }
}

// Decimals follow the unit (finding S9): BOM Qty / Set keeps up to 3 decimals
// (numeric(14,3)), but a child counted in whole pieces (NOS / PCS / SET / LOT)
// cannot be needed 0.25 at a time — refuse it, naming the line and the item.
function assertQtyPerSetFitsUom(
  lines: ReadonlyArray<{ childItemId: string; qtyPerSet: number }>,
  lookup: ItemsLookup,
): void {
  lines.forEach((l, i) => {
    const it = lookup.byId.get(l.childItemId);
    const problem = qtyUomProblem(l.qtyPerSet, it?.uom, 'BOM Qty / Set');
    if (problem) {
      throw new ValidationError(`Line ${i + 1} (${it?.code ?? 'item'}): ${problem}`);
    }
  });
}

// Generate next BOM-NNNN per company. Mirrors legacy _nextBOMNo helper —
// finds the highest numeric suffix used so far and adds 1, zero-padded
// to 4 digits.
async function nextBomNo(tx: DbTransaction, companyId: string): Promise<string> {
  // S2: queue behind any other save numbering this series (lib/doc-series-lock).
  await lockDocSeries(tx, companyId, 'bom_masters');
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
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    // Search the parent's code/name too — "which BOM builds this part?" is the
    // question people actually arrive with.
    const searchFrag = term
      ? sql`AND (b.bom_no ILIKE ${term} ESCAPE '\\' OR b.bom_name ILIKE ${term} ESCAPE '\\'
          OR pi.code ILIKE ${term} ESCAPE '\\' OR pi.name ILIKE ${term} ESCAPE '\\')`
      : sql``;
    const statusFrag = input.status ? sql`AND b.status = ${input.status}::bom_status` : sql``;
    // Sort & Filter (ADR-200) — applied to the page AND the count, so `total`
    // is the number of rows the search + filters really match (ADR-201).
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(BOM_SF_COLUMNS, sf);
    const orderBy = sfOrderBy(BOM_SF_COLUMNS, sf, sql`b.bom_no DESC, b.id DESC`);

    const fromWhere = sql`
      FROM public.bom_masters b
      LEFT JOIN public.items pi ON pi.id = b.parent_item_id
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
        ${sfFrag}`;

    const result = await tx.execute(sql`
      SELECT
        b.id, b.company_id AS "companyId", b.bom_no AS "bomNo", b.bom_name AS "bomName",
        b.revision, b.status, b.revision_date AS "revisionDate",
        b.created_at AS "createdAt", b.created_by AS "createdBy",
        b.updated_at AS "updatedAt", b.updated_by AS "updatedBy",
        b.deleted_at AS "deletedAt",
        b.parent_item_id AS "parentItemId",
        pi.code AS "parentItemCode",
        pi.name AS "parentItemName",
        COALESCE(line_agg.line_count, 0)::int AS "lineCount",
        COALESCE(so_agg.linked_so_count, 0)::int AS "linkedSoCount"
      ${fromWhere}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const totalRows = (await tx.execute(
      sql`SELECT COUNT(*)::int AS n ${fromWhere}`,
    )) as unknown as Array<{ n: number }>;
    const total = Number(totalRows[0]?.n ?? 0);

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
    parentItemId: (r['parentItemId'] as string | null) ?? null,
    parentItemCode: (r['parentItemCode'] as string | null) ?? null,
    parentItemName: (r['parentItemName'] as string | null) ?? null,
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
  if (!header) throw new NotFoundError('BOM not found. It may have been moved to Trash.');

  // Parent item display values. Nullable only for pre-0085 BOMs.
  const parent = header.parentItemId
    ? ((await loadItemsByIds(tx, [header.parentItemId], companyId)).byId.get(header.parentItemId) ??
      null)
    : null;

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
    parentItemId: header.parentItemId,
    parentItemCode: parent?.code ?? null,
    parentItemName: parent?.name ?? null,
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
        rawMaterialGradeId: r.line.rawMaterialGradeId,
        rawMaterialGradeText: r.line.rawMaterialGradeText,
        rawMaterialSizeId: r.line.rawMaterialSizeId,
        rawMaterialSizeText: r.line.rawMaterialSizeText,
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
    if (!header) throw new NotFoundError('BOM not found. It may have been moved to Trash.');

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
        and(eq(plans.bomMasterId, id), eq(plans.companyId, companyId), isNull(plans.deletedAt)),
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
  await requireFormAccess(user, 'bom_create', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // Validate items exist + capture their codes for the revision snapshot.
    // The parent goes in the same lookup so one round-trip covers both.
    const itemIds = [input.parentItemId, ...input.lines.map((l) => l.childItemId)];
    const itemsLookup = await assertItemIdsExist(tx, itemIds, companyId);
    assertParentIsUsable(input.parentItemId, input.lines, itemsLookup);
    assertNoDuplicateChildItems(input.lines, itemsLookup);
    assertQtyPerSetFitsUom(input.lines, itemsLookup);

    // S8: a new BOM starts as Draft or Active — never Obsolete.
    if (!BOM_CREATE_STATUSES.includes(input.status)) {
      throw new ConflictError(
        `A new BOM can be saved as Draft or Active only, not ${BOM_STATUS_LABELS[input.status] ?? input.status}.`,
      );
    }

    // Auto bomNo when not supplied; reject if supplied + already used.
    // S2: a typed number is checked under the same series lock (lib/doc-series-lock).
    await lockDocSeries(tx, companyId, 'bom_masters');
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
        parentItemId: input.parentItemId,
        revision: 1,
        status: input.status,
        revisionDate: sql`current_date` as unknown as string,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = inserted[0]!;

    // Raw material (0107): one query per master for the whole BOM, resolved
    // before the insert so a bad grade/size id fails the save rather than
    // leaving a line with a dangling reference.
    const rawMaterial = await loadRawMaterialNames(tx, input.lines, companyId);
    const lineValues = assignLineValues(input.lines, header.id, companyId, user.id, rawMaterial);
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
        action: ActivityAction.Create,
        entity: 'BOM',
        entityId: header.id,
        detail: bomDetailString(header.bomNo, header.bomName),
        refId: header.bomNo,
      },
      companyId,
      user,
    );

    return loadBomMasterDetail(tx, header.id, companyId);
  });
}

/**
 * True when the submitted BOM lines ADD or REMOVE a component versus what is
 * stored. The shared line input carries no row id, and a BOM lists each child
 * part exactly once (assertNoDuplicateChildItems), so a line's identity is its
 * child item id: a submitted child not currently on the BOM is an add (or a
 * component swap), and a stored child the submission omits is a remove. A
 * qty / type / raw-material change on an EXISTING child is NOT add/remove and
 * returns false — the edit-approval engine stages those for per-change approval.
 * Mirrors poLinesAddedOrRemoved; used by the divert in updateBomMasterOrStage.
 */
function bomLinesAddedOrRemoved(
  current: { childItemId: string }[],
  proposed: UpdateBomMasterInput['lines'],
): boolean {
  if (!proposed) return false;
  const currentIds = new Set(current.map((c) => c.childItemId));
  const proposedIds = new Set<string>();
  for (const p of proposed) {
    if (!currentIds.has(p.childItemId)) return true; // new child (add or swap)
    proposedIds.add(p.childItemId);
  }
  for (const id of currentIds) {
    if (!proposedIds.has(id)) return true; // a stored child was dropped
  }
  return false;
}

export async function updateBomMaster(
  id: string,
  input: UpdateBomMasterInput,
  user: AuthContext,
): Promise<BomMasterDetail> {
  // The `edit` access check lives HERE, not in updateBomMasterTx, so the
  // edit-approval engine's applyEdit can replay an approved edit for an approver
  // who holds `approve` but not `edit` (mirrors updatePurchaseOrder).
  requireWriteRole(user);
  await requireFormAccess(user, 'bom_create', 'edit');
  return withUserContext(user, (tx) => updateBomMasterTx(tx, id, input, user));
}

/**
 * The BOM edit entry point the HTTP route calls. Edit-approval (ADR-202): when
 * the company's gate is on, an edit to a live (not-Trash) BOM is STAGED for
 * per-change approval and a {staged:true, request} result is returned; otherwise
 * it falls through to updateBomMaster (today's behaviour). BOM has child lines,
 * so this mirrors updatePurchaseOrderOrStage: HEADER changes and qty / type /
 * raw-material changes on EXISTING lines are staged, but adding or removing a
 * line (a change to the SET of components) still cannot be staged and is refused.
 */
export async function updateBomMasterOrStage(
  id: string,
  input: UpdateBomMasterInput,
  user: AuthContext,
): Promise<BomMasterDetail | DocumentEditStagedResult> {
  requireWriteRole(user);
  await requireFormAccess(user, 'bom_create', 'edit');
  const companyId = requireCompany(user);

  // Engine imported dynamically to avoid a static import cycle with
  // bom-edit-registry (which imports updateBomMasterTx from this file).
  const { isDocEditApprovalOn, requestDocumentEdit } = await import('../document-edits/service');
  const shouldStage = await withUserContext(user, async (tx) => {
    if (!(await isDocEditApprovalOn(tx, companyId))) return false;
    // "Live" mirrors bomEditRegistryEntry.isLive: any existing (not-Trash) BOM.
    const rows = await tx
      .select({ id: bomMasters.id })
      .from(bomMasters)
      .where(
        and(
          eq(bomMasters.id, id),
          eq(bomMasters.companyId, companyId),
          isNull(bomMasters.deletedAt),
        ),
      )
      .limit(1);
    if (rows.length === 0) return false;
    // Adding or removing a line cannot be staged this pass — refuse it clearly
    // rather than let it ride along unapproved. A field change on an existing
    // line falls through and is staged for per-change approval.
    const current = await tx
      .select({ childItemId: bomMasterLines.childItemId })
      .from(bomMasterLines)
      .where(and(eq(bomMasterLines.bomMasterId, id), isNull(bomMasterLines.deletedAt)));
    if (bomLinesAddedOrRemoved(current, input.lines)) {
      throw new ConflictError(
        "Adding or removing BOM lines isn't available while Document Edit Approval is on — " +
          "change an existing line's component/qty (it will go for approval), or turn the gate " +
          'off to restructure the BOM.',
      );
    }
    return true;
  });
  if (shouldStage) {
    const request = await requestDocumentEdit('BOM', id, input, input.expectedUpdatedAt, user);
    return { staged: true, request };
  }

  return updateBomMaster(id, input, user);
}

/**
 * The body of a BOM edit, inside a caller-supplied transaction. Called by
 * updateBomMaster (which opens the tx) and by the edit-approval engine's applyEdit
 * (which already holds one — nesting withUserContext would deadlock on the BOM row
 * locked FOR UPDATE below). Every guard lives here: assertUnchangedSinceOpened,
 * the status-move check, the item/parent validation, the wholesale line reconcile,
 * the revision bump and the audit. The caller performs the `edit` / `approve`
 * access check before calling.
 */
export async function updateBomMasterTx(
  tx: DbTransaction,
  id: string,
  input: UpdateBomMasterInput,
  user: AuthContext,
): Promise<BomMasterDetail> {
  const companyId = requireCompany(user);
  {
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
      .for('update')
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError('BOM not found. It may have been moved to Trash.');
    // R5: refuse the save if someone else edited the BOM after this form opened it.
    assertUnchangedSinceOpened(header.updatedAt, input.expectedUpdatedAt);

    // S8: status moves follow BOM_STATUS_MOVES (Draft → Active / Obsolete,
    // Active → Obsolete, Obsolete is final). The change itself is logged by the
    // header audit row below ("BOM Status" field in bomHeaderChanges).
    if (!canMoveStatus(BOM_STATUS_MOVES, header.status, input.status)) {
      throw new ConflictError(
        statusMoveRefusal(`BOM ${header.bomNo}`, header.status, input.status, BOM_STATUS_LABELS),
      );
    }

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

    // Validate items exist (parent included — see createBomMaster).
    const itemIds = [input.parentItemId, ...input.lines.map((l) => l.childItemId)];
    const itemsLookup = await assertItemIdsExist(tx, itemIds, companyId);
    assertParentIsUsable(input.parentItemId, input.lines, itemsLookup);
    assertNoDuplicateChildItems(input.lines, itemsLookup);
    assertQtyPerSetFitsUom(input.lines, itemsLookup);

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
      qtyPerSet: l.qtyPerSet.toFixed(3),
      bomType: l.bomType,
    }));

    // Swapping the parent changes what the BOM builds — the single most
    // consequential edit possible here — so it leads the auto note instead of
    // being invisible next to the line diff.
    let autoNote = computeBomDiffNote(oldSnapshot, newSnapshot);
    if (header.parentItemId !== input.parentItemId) {
      const to = itemsLookup.byId.get(input.parentItemId)?.code ?? input.parentItemId;
      const from = header.parentItemId
        ? ((await loadItemsByIds(tx, [header.parentItemId], companyId)).byId.get(
            header.parentItemId,
          )?.code ?? header.parentItemId)
        : '(none)';
      autoNote = `Parent ${from} → ${to} · ${autoNote}`;
    }
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
        parentItemId: input.parentItemId,
        status: input.status,
        revision: newRevision,
        revisionDate: sql`current_date` as unknown as string,
        updatedBy: user.id,
        // R5: bom_masters has no set_updated_at trigger until 0187 — bump the
        // version here so the next edit-conflict check sees this save.
        updatedAt: new Date(),
      })
      .where(eq(bomMasters.id, id));

    // Raw material (0107) — same resolve-then-snapshot rule as create. Lines
    // are replaced wholesale on every edit, so clearing a picker clears it.
    const rawMaterial = await loadRawMaterialNames(tx, input.lines, companyId);
    const lineValues = assignLineValues(input.lines, id, companyId, user.id, rawMaterial);
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

    // Audit (ADR-197): header row (fields + BOM Rev) then one row per line
    // added / removed / changed. Nothing moved → no row at all.
    const codeById = new Map<string, string>();
    for (const [itemId, it] of itemsLookup.byId) codeById.set(itemId, it.code);
    for (const r of oldLineRows) if (r.itemCode) codeById.set(r.line.childItemId, r.itemCode);
    if (header.parentItemId && !codeById.has(header.parentItemId)) {
      const prev = (await loadItemsByIds(tx, [header.parentItemId], companyId)).byId.get(
        header.parentItemId,
      );
      if (prev) codeById.set(header.parentItemId, prev.code);
    }
    const oldAuditLines: BomAuditLine[] = oldLineRows.map((r) => ({
      lineNo: r.line.lineNo,
      childItemId: r.line.childItemId,
      qtyPerSet: r.line.qtyPerSet,
      bomType: r.line.bomType,
      rawMaterialGradeText: r.line.rawMaterialGradeText,
      rawMaterialSizeText: r.line.rawMaterialSizeText,
    }));
    const newAuditLines: BomAuditLine[] = lineValues.map((l) => ({
      lineNo: l.lineNo,
      childItemId: l.childItemId,
      qtyPerSet: l.qtyPerSet,
      bomType: l.bomType,
      rawMaterialGradeText: l.rawMaterialGradeText ?? null,
      rawMaterialSizeText: l.rawMaterialSizeText ?? null,
    }));
    const lineRows = bomLineAuditRows(oldAuditLines, newAuditLines, codeById);
    const headerFieldChanges = bomHeaderChanges(
      header,
      { ...input, revision: header.revision },
      codeById,
    );
    if (headerFieldChanges.length > 0 || lineRows.length > 0) {
      const headerChanges = bomHeaderChanges(header, { ...input, revision: newRevision }, codeById);
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Edit,
          entity: 'BOM',
          entityId: id,
          refId: input.bomNo,
          changes: headerChanges,
          detail: `Edited ${bomDetailString(input.bomNo, input.bomName)}${
            input.revisionNote?.trim() ? ` — ${input.revisionNote.trim()}` : ''
          }`,
        },
        companyId,
        user,
      );
      for (const row of lineRows) {
        await emitActivityLog(
          tx,
          {
            action: row.action,
            entity: 'BOM',
            entityId: id,
            refId: input.bomNo,
            lineRef: row.lineRef,
            changes: row.changes,
            detail: `${input.bomNo} ${row.detail}`,
          },
          companyId,
          user,
        );
      }
    }

    return loadBomMasterDetail(tx, id, companyId);
  }
}

export async function softDeleteBomMaster(
  id: string,
  user: AuthContext,
  reason?: string | null,
): Promise<BomMaster> {
  if (user.role !== 'admin') {
    throw new AuthorizationError('You do not have permission to delete BOMs. Ask an admin.');
  }
  await requireFormAccess(user, 'bom_create', 'edit');
  await requireFormAccess(user, 'bom_create', 'approve');
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
    if (!header) throw new NotFoundError('BOM not found. It may have been moved to Trash.');

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
        `Cannot delete BOM ${header.bomNo} — it is used on ${linkedCount} SO line(s). Remove it from those lines first.`,
      );
    }

    const stamp = softDeleteStamp(user);
    await tx
      .update(bomMasters)
      .set({ ...stamp, updatedBy: user.id, updatedAt: stamp.deletedAt })
      .where(eq(bomMasters.id, id));
    // Lines are deliberately NOT stamped: Trash → Restore brings back the
    // header row only (trash/service.ts), and stamped lines would come back
    // as an empty BOM. The lines are unreachable while the header is deleted.

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Delete,
        entity: 'BOM',
        entityId: id,
        detail: bomDetailString(header.bomNo, header.bomName),
        refId: header.bomNo,
        reason: reason ?? null,
      },
      companyId,
      user,
    );

    return {
      id: header.id,
      companyId: header.companyId,
      bomNo: header.bomNo,
      bomName: header.bomName,
      // The row is on its way out; the parent's code/name are display-only and
      // nothing renders a deleted BOM, so the id alone is enough here.
      parentItemId: header.parentItemId,
      parentItemCode: null,
      parentItemName: null,
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

/** Grade/size names keyed by id, for the raw material on the BOM's lines. */
interface RawMaterialLookup {
  gradeNames: Map<string, string>;
  sizeNames: Map<string, string>;
}

/**
 * Resolve every grade/size id referenced by the submitted lines in ONE query
 * per master (not one per line — a 40-line BOM would otherwise cost 80 round
 * trips). Company-scoped and soft-delete filtered, so a stale or foreign id is
 * refused here rather than stored as a dangling reference.
 */
async function loadRawMaterialNames(
  tx: DbTransaction,
  lines: CreateBomMasterLineInput[],
  companyId: string,
): Promise<RawMaterialLookup> {
  const gradeIds = [
    ...new Set(lines.map((l) => l.rawMaterialGradeId).filter((v): v is string => !!v)),
  ];
  const sizeIds = [
    ...new Set(lines.map((l) => l.rawMaterialSizeId).filter((v): v is string => !!v)),
  ];

  const gradeNames = new Map<string, string>();
  if (gradeIds.length > 0) {
    const rows = await tx
      .select({ id: materialGrades.id, name: materialGrades.name })
      .from(materialGrades)
      .where(
        and(
          eq(materialGrades.companyId, companyId),
          inArray(materialGrades.id, gradeIds),
          isNull(materialGrades.deletedAt),
        ),
      );
    for (const r of rows) gradeNames.set(r.id, r.name);
    for (const id of gradeIds) {
      if (!gradeNames.has(id)) {
        throw new ValidationError(
          'A raw material grade on this BOM was not found in the Grade master',
        );
      }
    }
  }

  const sizeNames = new Map<string, string>();
  if (sizeIds.length > 0) {
    const rows = await tx
      .select({ id: materialSizes.id, name: materialSizes.name })
      .from(materialSizes)
      .where(
        and(
          eq(materialSizes.companyId, companyId),
          inArray(materialSizes.id, sizeIds),
          isNull(materialSizes.deletedAt),
        ),
      );
    for (const r of rows) sizeNames.set(r.id, r.name);
    for (const id of sizeIds) {
      if (!sizeNames.has(id)) {
        throw new ValidationError(
          'A raw material size on this BOM was not found in the Size master',
        );
      }
    }
  }

  return { gradeNames, sizeNames };
}

/** Raw material for one BOM line: FK plus the text snapshot. When an id is
 *  sent the snapshot is written from the master's current name (the payload's
 *  text is only a fallback), so what the BOM prints is what the master said at
 *  the moment the BOM was saved. */
function lineRawMaterial(
  l: CreateBomMasterLineInput,
  lookup: RawMaterialLookup,
): {
  rawMaterialGradeId: string | null;
  rawMaterialGradeText: string | null;
  rawMaterialSizeId: string | null;
  rawMaterialSizeText: string | null;
} {
  const gradeId = l.rawMaterialGradeId ?? null;
  const sizeId = l.rawMaterialSizeId ?? null;
  return {
    rawMaterialGradeId: gradeId,
    rawMaterialGradeText: gradeId
      ? (lookup.gradeNames.get(gradeId) ?? null)
      : l.rawMaterialGradeText?.trim() || null,
    rawMaterialSizeId: sizeId,
    rawMaterialSizeText: sizeId
      ? (lookup.sizeNames.get(sizeId) ?? null)
      : l.rawMaterialSizeText?.trim() || null,
  };
}

function assignLineValues(
  lines: CreateBomMasterLineInput[],
  bomMasterId: string,
  companyId: string,
  userId: string,
  rawMaterial: RawMaterialLookup,
): Array<typeof bomMasterLines.$inferInsert> {
  return lines.map((l, i) => ({
    companyId,
    bomMasterId,
    lineNo: i + 1,
    childItemId: l.childItemId,
    qtyPerSet: l.qtyPerSet.toFixed(3),
    bomType: l.bomType,
    ...lineRawMaterial(l, rawMaterial),
    createdBy: userId,
    updatedBy: userId,
  }));
}

function buildItemsSnapshot(lines: CreateBomMasterLineInput[], itemsLookup: ItemsLookup): unknown {
  return lines.map((l) => ({
    childItemId: l.childItemId,
    childItemCode: itemsLookup.byId.get(l.childItemId)?.code ?? null,
    qtyPerSet: l.qtyPerSet.toFixed(3),
    bomType: l.bomType,
  }));
}

// ─── Excel Template (NAMING.md: the button is `Excel Template`) ────────────
//
// Built here rather than in the browser because the dropdowns need Excel data
// validation, which SheetJS (the browser library) cannot write — see
// lib/excel-template.ts. The dropdown values are the LIVE masters, read through
// each module's own list service.

/** Rows the planner sees as examples under the header. */
const BOM_TEMPLATE_SAMPLE_ITEMS = ['EXAMPLE-001', 'EXAMPLE-002'];
const BOM_TEMPLATE_SAMPLE_QTYS = [2, 3];

export async function buildBomImportTemplate(user: AuthContext): Promise<Buffer> {
  await requireFormAccess(user, 'bom_create', 'view');

  // Raw Material Master sits behind its own permission (`rawmat_create`). A
  // planner without it still gets a usable template — just without those two
  // dropdowns; the import matches whatever they type either way.
  const listQuery = { isActive: true, limit: 1000, offset: 0 } as const;
  const [grades, sizes] = await Promise.all([
    listMaterialGrades(listQuery, user).catch((e: unknown) => {
      if (e instanceof AuthorizationError) return null;
      throw e;
    }),
    listMaterialSizes(listQuery, user).catch((e: unknown) => {
      if (e instanceof AuthorizationError) return null;
      throw e;
    }),
  ]);
  const gradeNames = grades?.grades.map((g) => g.name) ?? [];
  const sizeNames = sizes?.sizes.map((sz) => sz.name) ?? [];

  return buildImportTemplateBuffer({
    sheetName: 'BOM',
    columns: [
      {
        label: 'Item Code*',
        samples: BOM_TEMPLATE_SAMPLE_ITEMS,
        width: 20,
        // No dropdown on purpose: Item Master runs to hundreds of codes, which
        // makes an Excel list unusable on a build without the searchable
        // dropdown and bloats the file. The import reports unknown codes and
        // offers them as an Item Master import sheet.
      },
      { label: 'Qty / Set*', samples: BOM_TEMPLATE_SAMPLE_QTYS, width: 12 },
      {
        label: 'BOM Type*',
        samples: ['manufacture', 'purchase'],
        options: [...BOM_LINE_TYPES],
        width: 16,
      },
      ...(gradeNames.length > 0
        ? [{ label: 'RM Grade', samples: [gradeNames[0] ?? ''], options: gradeNames, width: 22 }]
        : [{ label: 'RM Grade', width: 22 }]),
      ...(sizeNames.length > 0
        ? [{ label: 'RM Size', samples: [sizeNames[0] ?? ''], options: sizeNames, width: 22 }]
        : [{ label: 'RM Size', width: 22 }]),
    ],
  });
}
