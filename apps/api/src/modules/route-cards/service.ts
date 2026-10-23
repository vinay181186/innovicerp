// Route Card service (RC-3). Ports legacy renderRouteCards /
// saveRouteCardForItem / editRouteCard / delRouteCard
// (legacy/InnovicERP_v82_12_3.html L10078, L6918, L10169).
//
// Architectural notes:
//
// 1. Revision lifecycle. createRouteCard writes current_revision=0 +
//    a matching route_card_revisions row with the initial ops as the
//    snapshot — a card is BORN at Rev 0, and its first edit makes it
//    Rev 1. updateRouteCard bumps current_revision by 1, snapshots
//    the PRE-update ops, and auto-generates a diff note if the caller
//    didn't provide one. Matches legacy revisionLog[] behaviour
//    (saveRouteCardForItem L6929-6931).
//
// 2. One active route card per item (per company). Enforced at the
//    DB layer via `route_cards_company_item_uniq` partial unique
//    index. Service raises ConflictError on collision to surface a
//    friendly error instead of a 500.
//
// 3. Op types:
//    - 'process'   → regular machine step. machineId required (or
//                    machineCodeText fallback per ADR-012 #10).
//    - 'qc'        → inspection step. Legacy stores machineId='QC';
//                    we store null + set machineCodeText='QC' for
//                    display parity.
//    - 'outsource' → OSP step. ospVendorId required (or
//                    ospVendorCodeText fallback). ospLeadDays
//                    captured for downstream JC scheduling.
//
// 4. Audit emission (ADR-197, docs/AUDIT-TRAIL.md). CREATE / EDIT / DELETE
//    rows land in activity_log with entity='RouteCard' + entityId, inside
//    the write's transaction. An edit writes one header row (before → after
//    of the header fields + the Route Card Rev bump) and one row per op that
//    was added / removed / changed, located by opRef "Op 20 · Turning".
//    The JC / plan auto-save (saveRouteCardForItem) logs the same way.
//
// 5. Auto-save (saveRouteCardForItem, bottom of this file). Saving a
//    Job Card / executing a plan writes the item's route card so the
//    next plan for the same item can load the routing back. Shares the
//    ops-replace + revision-bump implementation with updateRouteCard
//    (replaceRouteCardOps). ADR-051 deferred this write half; only the
//    read half (plans.getDefaultRouteOpsForItem) had been ported.
//
// 6. Raw material (grade + size, migration 0108). Header-level, FK +
//    text snapshot, resolved the same way job-cards does it
//    (resolveJcRawMaterial): a sent id must be a live row in THIS
//    company's master or the save is refused, and the snapshot is
//    always rewritten from the master name. Header-only — it is not
//    pushed down to plans or job cards.

import {
  type ActivityChange,
  type DocumentEditStagedResult,
  ActivityAction,
  type JcRouteCardWriteBack,
  opSrNo,
} from '@innovic/shared';
import { type AnyColumn, and, asc, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import {
  items,
  machineGroups,
  machines,
  materialGrades,
  materialSizes,
  routeCardOps,
  routeCardRevisions,
  routeCards,
  users,
  vendors,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { hasFormAccess, requireDeleteRight, requireFormAccess } from '../../lib/access';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { assertActivePartiesBatch } from '../../lib/active-party';
import { type DiffField, diffFields, softDeleteStamp } from '../../lib/audit-trail';
import { RC_SF_COLUMNS } from './sf-columns';
import { resolveRmItem } from '../../lib/rm-item';
import { DEFAULT_FINAL_QC_OP, needsDefaultQcOp } from '../../lib/jc-default-qc';
import { assertNoQcDirectlyAfterOutsource } from '../../lib/jc-osp-qc-rule';
import {
  AppError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { lockDocSeries } from '../../lib/doc-series-lock';
import { assertUnchangedSinceOpened } from '../../lib/edit-conflict';
import { logger } from '../../lib/logger';
import { emitActivityLog } from '../activity-log/service';
import {
  type RouteCardEditPayload,
  routingNotSentReason,
  stagingFromSourceDoc,
} from './route-card-edit-common';
import { opInputFromRow } from './route-card-edit-lookups';
// T2 — push a new card's raw material onto that item's blank, waiting plans.
// The lookup is shared with the plan side's T1 default (ONE route-card query).
import {
  backfillPlansFromRouteCard,
  lockBackfillCandidates,
  readRouteCardRawMaterial,
} from '../plans/rm-backfill';
import type {
  CreateRouteCardInput,
  CreateRouteCardOpInput,
  ListRouteCardsQuery,
  ListRouteCardsResponse,
  RouteCard,
  RouteCardDetail,
  RouteCardListItem,
  RouteCardOp,
  RouteCardRevision,
  UpdateRouteCardInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function tsLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function maybeTsLike(v: unknown): string | null {
  if (v == null) return null;
  return tsLike(v);
}

// ─── Lookups ──────────────────────────────────────────────────────────────

interface MachinesLookup {
  byId: Map<string, { code: string; name: string }>;
}

interface VendorsLookup {
  byId: Map<string, { code: string; name: string }>;
}

async function loadMachinesByIds(
  tx: DbTransaction,
  ids: string[],
  companyId: string,
): Promise<MachinesLookup> {
  const out: MachinesLookup = { byId: new Map() };
  const unique = Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  if (unique.length === 0) return out;
  const rows = await tx
    .select({ id: machines.id, code: machines.code, name: machines.name })
    .from(machines)
    .where(
      and(
        eq(machines.companyId, companyId),
        inArray(machines.id, unique),
        isNull(machines.deletedAt),
      ),
    );
  for (const r of rows) out.byId.set(r.id, { code: r.code, name: r.name });
  return out;
}

async function loadVendorsByIds(
  tx: DbTransaction,
  ids: string[],
  companyId: string,
): Promise<VendorsLookup> {
  const out: VendorsLookup = { byId: new Map() };
  const unique = Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  if (unique.length === 0) return out;
  const rows = await tx
    .select({ id: vendors.id, code: vendors.code, name: vendors.name })
    .from(vendors)
    .where(
      and(eq(vendors.companyId, companyId), inArray(vendors.id, unique), isNull(vendors.deletedAt)),
    );
  for (const r of rows) out.byId.set(r.id, { code: r.code, name: r.name });
  return out;
}

async function assertItemExists(
  tx: DbTransaction,
  id: string,
  companyId: string,
): Promise<{ code: string; name: string }> {
  const rows = await tx
    .select({ id: items.id, code: items.code, name: items.name })
    .from(items)
    .where(and(eq(items.companyId, companyId), eq(items.id, id), isNull(items.deletedAt)))
    .limit(1);
  const r = rows[0];
  if (!r) throw new ValidationError('Item not found. Pick the Item Code from Item Master.');
  return { code: r.code, name: r.name };
}

async function assertMachineIdsExist(
  tx: DbTransaction,
  ids: string[],
  companyId: string,
): Promise<MachinesLookup> {
  const lookup = await loadMachinesByIds(tx, ids, companyId);
  const unique = Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  if (lookup.byId.size !== unique.length) {
    const missing = unique.filter((id) => !lookup.byId.has(id));
    throw new ValidationError(
      `Machine not found on this Route Card (${missing.length} row(s)). Pick it again from the list.`,
    );
  }
  return lookup;
}

/** Every op vendor exists, and every one NOT already on this route card
 *  (`keepIds`, on an edit) is ACTIVE — an inactive vendor is refused as a new
 *  link with 409 (A10 inactive-master rule). */
async function assertVendorIdsExist(
  tx: DbTransaction,
  ids: string[],
  companyId: string,
  keepIds: ReadonlySet<string> = new Set(),
): Promise<VendorsLookup> {
  await assertActivePartiesBatch(tx, 'vendor', ids, companyId, keepIds);
  const lookup = await loadVendorsByIds(tx, ids, companyId);
  const unique = Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  if (lookup.byId.size !== unique.length) {
    const missing = unique.filter((id) => !lookup.byId.has(id));
    throw new ValidationError(
      `Vendor not found on this Route Card (${missing.length} row(s)). Pick it again from the list.`,
    );
  }
  return lookup;
}

export interface ResolvedRawMaterial {
  rawMaterialGradeId: string | null;
  rawMaterialGradeText: string | null;
  rawMaterialSizeId: string | null;
  rawMaterialSizeText: string | null;
  // ADR-193 phase 3a: the raw-material Item Master item + qty per piece.
  // Validated as a pair by lib/rm-item.ts resolveRmItem.
  rawMaterialItemId: string | null;
  rmQtyPerPiece: number | null;
}

// Resolve the grade/size the caller sent against THIS company's live masters.
// Same contract as job-cards resolveJcRawMaterial: a stale or foreign id is
// refused with a plain message rather than silently stored, and the text
// snapshot is always rewritten from the master name (the sent text is only a
// fallback for the free-text / no-id case).
//
// An id left out or sent as null clears the column — the write inputs carry
// the whole header, so "not sent" means "not set", which is how the caller
// removes a grade or a size.
async function resolveRcRawMaterial(
  tx: DbTransaction,
  companyId: string,
  input: CreateRouteCardInput | UpdateRouteCardInput,
  /** ADR-193 phase 3a — the card's stored RM item pair, on edit. Unlike grade /
   *  size, a field the payload leaves out (undefined) KEEPS its stored value
   *  and only an explicit null clears it, so a form that does not carry the
   *  pair yet cannot wipe it. On create there is nothing stored. */
  storedRmItem?: { rawMaterialItemId: string | null; rmQtyPerPiece: number | null },
): Promise<ResolvedRawMaterial> {
  const gradeId = input.rawMaterialGradeId ?? null;
  const sizeId = input.rawMaterialSizeId ?? null;
  let gradeText = input.rawMaterialGradeText?.trim() || null;
  let sizeText = input.rawMaterialSizeText?.trim() || null;

  if (gradeId) {
    const rows = await tx
      .select({ name: materialGrades.name })
      .from(materialGrades)
      .where(
        and(
          eq(materialGrades.id, gradeId),
          eq(materialGrades.companyId, companyId),
          isNull(materialGrades.deletedAt),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new ValidationError('Raw material grade not found in the Grade master');
    gradeText = rows[0].name;
  }

  if (sizeId) {
    const rows = await tx
      .select({ name: materialSizes.name })
      .from(materialSizes)
      .where(
        and(
          eq(materialSizes.id, sizeId),
          eq(materialSizes.companyId, companyId),
          isNull(materialSizes.deletedAt),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new ValidationError('Raw material size not found in the Size master');
    sizeText = rows[0].name;
  }

  const rmItem = await resolveRmItem(tx, companyId, {
    rawMaterialItemId:
      input.rawMaterialItemId !== undefined
        ? input.rawMaterialItemId
        : (storedRmItem?.rawMaterialItemId ?? null),
    rmQtyPerPiece:
      input.rmQtyPerPiece !== undefined
        ? input.rmQtyPerPiece
        : (storedRmItem?.rmQtyPerPiece ?? null),
  });

  return {
    rawMaterialGradeId: gradeId,
    rawMaterialGradeText: gradeText,
    rawMaterialSizeId: sizeId,
    rawMaterialSizeText: sizeText,
    ...rmItem,
  };
}

// Generate next IN-RC-NNNNN per company. Mirrors legacy _nextRcNo
// helper (L6933-6934) — finds the highest numeric suffix used so far
// and adds 1, zero-padded to 5 digits.
async function nextRouteCardCode(tx: DbTransaction, companyId: string): Promise<string> {
  // S2: queue behind any other save numbering this series (lib/doc-series-lock).
  await lockDocSeries(tx, companyId, 'route_cards');
  // ADR-227 — the scan counts DELETED rows too, so a number that has been used
  // once is never handed out again (owner's decision, 2026-10-09). The unique
  // index is partial (WHERE deleted_at IS NULL), so excluding them here did not
  // fail loudly: Postgres ACCEPTED the duplicate and the register quietly held
  // two papers with one number, one of them in Trash. Deleting the newest
  // document now leaves a permanent gap in the series, which is the trade — one
  // number, one document, for ever.
  const rows = (await tx.execute(sql`
    SELECT code FROM public.route_cards
    WHERE company_id = ${companyId}::uuid
      AND code ~ '^IN-RC-\\d+$'
    ORDER BY (SUBSTRING(code FROM 7))::int DESC
    LIMIT 1
  `)) as unknown as Array<{ code: string }>;
  const last = rows[0]?.code ?? null;
  let next = 1;
  if (last) {
    const m = last.match(/^IN-RC-(\d+)$/);
    if (m) next = parseInt(m[1]!, 10) + 1;
  }
  return `IN-RC-${String(next).padStart(5, '0')}`;
}

// Preview the next IN-RC-NNNNN code so the create form can prefill it
// before save. Read-only — does not reserve the code (the actual value
// is (re)computed atomically inside createRouteCard on submit).
export async function getNextRouteCardCode(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({ code: await nextRouteCardCode(tx, companyId) }));
}

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listRouteCards(
  input: ListRouteCardsQuery,
  user: AuthContext,
): Promise<ListRouteCardsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (rc.code ILIKE ${term} ESCAPE '\\' OR i.code ILIKE ${term} ESCAPE '\\'
          OR i.name ILIKE ${term} ESCAPE '\\')`
      : sql``;
    const itemFrag = input.itemId ? sql`AND rc.item_id = ${input.itemId}::uuid` : sql``;
    // Sort & Filter (ADR-200) — applied to the page AND the count, so `total`
    // is the number of cards the search + filters really match (ADR-201).
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(RC_SF_COLUMNS, sf);
    const orderBy = sfOrderBy(RC_SF_COLUMNS, sf, sql`rc.code DESC, rc.id DESC`);

    const fromWhere = sql`
      FROM public.route_cards rc
      LEFT JOIN public.items i ON i.id = rc.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.items rmi ON rmi.id = rc.raw_material_item_id AND rmi.company_id = rc.company_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS op_count
        FROM public.route_card_ops o
        WHERE o.route_card_id = rc.id AND o.deleted_at IS NULL
      ) op_agg ON TRUE
      WHERE rc.company_id = ${companyId}::uuid
        AND rc.deleted_at IS NULL
        ${searchFrag}
        ${itemFrag}
        ${sfFrag}`;

    const result = await tx.execute(sql`
      SELECT
        rc.id, rc.company_id AS "companyId", rc.code, rc.item_id AS "itemId",
        rc.current_revision AS "currentRevision",
        rc.raw_material_grade_id AS "rawMaterialGradeId",
        rc.raw_material_grade_text AS "rawMaterialGradeText",
        rc.raw_material_size_id AS "rawMaterialSizeId",
        rc.raw_material_size_text AS "rawMaterialSizeText",
        rc.raw_material_item_id AS "rawMaterialItemId",
        rmi.code AS "rawMaterialItemCode",
        rc.rm_qty_per_piece AS "rmQtyPerPiece",
        rc.notes,
        rc.plan_type AS "planType",
        rc.created_at AS "createdAt", rc.created_by AS "createdBy",
        rc.updated_at AS "updatedAt", rc.updated_by AS "updatedBy",
        rc.deleted_at AS "deletedAt",
        i.code AS "itemCode", i.name AS "itemName",
        COALESCE(op_agg.op_count, 0)::int AS "opCount"
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

function toListItem(r: Record<string, unknown>): RouteCardListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    itemId: r['itemId'] as string,
    currentRevision: Number(r['currentRevision'] ?? 1),
    rawMaterialGradeId: (r['rawMaterialGradeId'] as string | null) ?? null,
    rawMaterialGradeText: (r['rawMaterialGradeText'] as string | null) ?? null,
    rawMaterialSizeId: (r['rawMaterialSizeId'] as string | null) ?? null,
    rawMaterialSizeText: (r['rawMaterialSizeText'] as string | null) ?? null,
    rawMaterialItemId: (r['rawMaterialItemId'] as string | null) ?? null,
    rawMaterialItemCode: (r['rawMaterialItemCode'] as string | null) ?? null,
    rmQtyPerPiece: r['rmQtyPerPiece'] == null ? null : Number(r['rmQtyPerPiece']),
    notes: (r['notes'] as string | null) ?? null,
    planType: (r['planType'] as RouteCard['planType'] | null) ?? 'manufacture',
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: maybeTsLike(r['deletedAt']),
    itemCode: (r['itemCode'] as string | null) ?? null,
    itemName: (r['itemName'] as string | null) ?? null,
    opCount: Number(r['opCount'] ?? 0),
  };
}

async function loadRouteCardDetail(
  tx: DbTransaction,
  id: string,
  companyId: string,
): Promise<RouteCardDetail> {
  const headers = await tx
    .select()
    .from(routeCards)
    .where(
      and(eq(routeCards.id, id), eq(routeCards.companyId, companyId), isNull(routeCards.deletedAt)),
    )
    .limit(1);
  const header = headers[0];
  if (!header) throw new NotFoundError('Route Card not found. It may have been moved to Trash.');

  // Item display
  const itemRows = await tx
    .select({ code: items.code, name: items.name })
    .from(items)
    .where(and(eq(items.id, header.itemId), isNull(items.deletedAt)))
    .limit(1);
  const item = itemRows[0] ?? null;

  // ADR-193 phase 3a: the raw-material item's code, for display. No
  // deleted_at filter — a card must keep naming the item it was set with.
  const rmItemCode = header.rawMaterialItemId
    ? ((
        await tx
          .select({ code: items.code })
          .from(items)
          .where(and(eq(items.id, header.rawMaterialItemId), eq(items.companyId, companyId)))
          .limit(1)
      )[0]?.code ?? null)
    : null;

  // Ops with joined machine + machine group + vendor display.
  const opRows = await tx
    .select({
      op: routeCardOps,
      machineCode: machines.code,
      machineName: machines.name,
      // Group the machine is filed under, for the Operation Sequence table.
      // leftJoin twice over: an op with no machine, or a machine in no group,
      // must still come back — those land as null.
      machineGroupCode: machineGroups.code,
      ospVendorCode: vendors.code,
      ospVendorName: vendors.name,
    })
    .from(routeCardOps)
    .leftJoin(machines, eq(machines.id, routeCardOps.machineId))
    .leftJoin(machineGroups, eq(machineGroups.id, machines.machineGroupId))
    .leftJoin(vendors, eq(vendors.id, routeCardOps.ospVendorId))
    .where(
      and(
        eq(routeCardOps.routeCardId, id),
        eq(routeCardOps.companyId, companyId),
        isNull(routeCardOps.deletedAt),
      ),
    )
    .orderBy(asc(routeCardOps.opSeq));

  // Left join, not a lookup loop: the name is wanted for display only, and a
  // deleted user must still leave its revision visible rather than drop the
  // row out of the history.
  const revisionRows = await tx
    .select({ rev: routeCardRevisions, byName: users.fullName, byEmail: users.email })
    .from(routeCardRevisions)
    .leftJoin(users, eq(users.id, routeCardRevisions.createdBy))
    .where(and(eq(routeCardRevisions.routeCardId, id), eq(routeCardRevisions.companyId, companyId)))
    .orderBy(desc(routeCardRevisions.revisionNo));

  return {
    id: header.id,
    companyId: header.companyId,
    code: header.code,
    itemId: header.itemId,
    currentRevision: header.currentRevision,
    rawMaterialGradeId: header.rawMaterialGradeId,
    rawMaterialGradeText: header.rawMaterialGradeText,
    rawMaterialSizeId: header.rawMaterialSizeId,
    rawMaterialSizeText: header.rawMaterialSizeText,
    rawMaterialItemId: header.rawMaterialItemId,
    rawMaterialItemCode: rmItemCode,
    rmQtyPerPiece: header.rmQtyPerPiece,
    notes: header.notes,
    planType: header.planType,
    createdAt: tsLike(header.createdAt),
    createdBy: header.createdBy,
    updatedAt: tsLike(header.updatedAt),
    updatedBy: header.updatedBy,
    deletedAt: maybeTsLike(header.deletedAt),
    itemCode: item?.code ?? null,
    itemName: item?.name ?? null,
    ops: opRows.map(
      (r): RouteCardOp => ({
        id: r.op.id,
        companyId: r.op.companyId,
        routeCardId: r.op.routeCardId,
        opSeq: r.op.opSeq,
        machineId: r.op.machineId,
        machineCodeText: r.op.machineCodeText,
        operation: r.op.operation,
        opType: r.op.opType,
        cycleTimeMin: r.op.cycleTimeMin,
        program: r.op.program,
        toolNo: r.op.toolNo,
        toolDetails: r.op.toolDetails,
        remarks: r.op.remarks,
        qcRequired: r.op.qcRequired,
        ospVendorId: r.op.ospVendorId,
        ospVendorCodeText: r.op.ospVendorCodeText,
        ospLeadDays: r.op.ospLeadDays,
        createdAt: tsLike(r.op.createdAt),
        createdBy: r.op.createdBy,
        updatedAt: tsLike(r.op.updatedAt),
        updatedBy: r.op.updatedBy,
        deletedAt: maybeTsLike(r.op.deletedAt),
        machineCode: r.machineCode,
        machineName: r.machineName,
        machineGroupCode: r.machineGroupCode,
        ospVendorCode: r.ospVendorCode,
        ospVendorName: r.ospVendorName,
      }),
    ),
    revisions: revisionRows.map(
      ({ rev: r, byName, byEmail }): RouteCardRevision => ({
        id: r.id,
        companyId: r.companyId,
        routeCardId: r.routeCardId,
        revisionNo: r.revisionNo,
        notes: r.notes,
        opsSnapshot: r.opsSnapshot as RouteCardRevision['opsSnapshot'],
        createdAt: tsLike(r.createdAt),
        createdBy: r.createdBy,
        // full_name when the user filled one in, otherwise the email's local
        // part — the same fallback the NC Register uses, so one person reads
        // the same on both screens.
        createdByName: byName?.trim() || byEmail?.split('@')[0] || null,
      }),
    ),
  };
}

export async function getRouteCard(id: string, user: AuthContext): Promise<RouteCardDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => loadRouteCardDetail(tx, id, companyId));
}

// ─── Diff note ────────────────────────────────────────────────────────────

interface DiffOp {
  opSeq: number;
  machineCode?: string | null;
  operation: string;
  opType: string;
  cycleTimeMin: string;
  ospVendorCode?: string | null;
  ospLeadDays?: number | null;
  // The note used to ignore these four. A save that changed ONLY a tool
  // number bumped the revision and then logged "No op changes" against it —
  // the history recorded that something happened and denied it in the same
  // breath. They are compared now.
  program?: string | null;
  toolNo?: string | null;
  toolDetails?: string | null;
  // Same reasoning as the four above, for the same reason (0195): a save whose
  // only change was a remark bumped the revision and logged "No op changes".
  remarks?: string | null;
  qcRequired?: boolean | null;
}

/** Free text inside a diff note has to stay readable in a table cell — tool
 *  details can run to a paragraph. Long values are shown truncated. */
function noteVal(v: string | null | undefined): string {
  const s = (v ?? '').trim();
  if (s.length === 0) return '—';
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

// Build a human-readable diff between two op sequences. Keyed by
// opSeq (the position in the route). "Added" / "Removed" cover
// sequence-length changes; "Changed" covers in-place edits to an
// existing position.
export function computeRouteCardDiffNote(oldOps: DiffOp[], newOps: DiffOp[]): string {
  const oldBySeq = new Map(oldOps.map((o) => [o.opSeq, o]));
  const newBySeq = new Map(newOps.map((o) => [o.opSeq, o]));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [seq, no] of newBySeq) {
    const oo = oldBySeq.get(seq);
    // display rule — see opSrNo in @innovic/shared (the note is read by people)
    const label = `${opSrNo(seq)}. ${no.operation || '(unnamed)'}`;
    if (!oo) {
      added.push(label);
      continue;
    }
    const parts: string[] = [];
    if (oo.operation !== no.operation) {
      parts.push(`op "${oo.operation}" → "${no.operation}"`);
    }
    if (oo.opType !== no.opType) {
      parts.push(`type ${oo.opType} → ${no.opType}`);
    }
    if ((oo.machineCode ?? null) !== (no.machineCode ?? null)) {
      parts.push(`machine ${oo.machineCode ?? '—'} → ${no.machineCode ?? '—'}`);
    }
    if (Number(oo.cycleTimeMin) !== Number(no.cycleTimeMin)) {
      parts.push(`cycle ${oo.cycleTimeMin} → ${no.cycleTimeMin}`);
    }
    if ((oo.ospVendorCode ?? null) !== (no.ospVendorCode ?? null)) {
      parts.push(`vendor ${oo.ospVendorCode ?? '—'} → ${no.ospVendorCode ?? '—'}`);
    }
    if ((oo.ospLeadDays ?? null) !== (no.ospLeadDays ?? null)) {
      parts.push(`lead ${oo.ospLeadDays ?? '—'} → ${no.ospLeadDays ?? '—'}d`);
    }
    if ((oo.program ?? null) !== (no.program ?? null)) {
      parts.push(`program ${noteVal(oo.program)} → ${noteVal(no.program)}`);
    }
    if ((oo.toolNo ?? null) !== (no.toolNo ?? null)) {
      parts.push(`tool ${noteVal(oo.toolNo)} → ${noteVal(no.toolNo)}`);
    }
    if ((oo.toolDetails ?? null) !== (no.toolDetails ?? null)) {
      parts.push(`tool details ${noteVal(oo.toolDetails)} → ${noteVal(no.toolDetails)}`);
    }
    if ((oo.remarks ?? null) !== (no.remarks ?? null)) {
      parts.push(`remarks ${noteVal(oo.remarks)} → ${noteVal(no.remarks)}`);
    }
    if (Boolean(oo.qcRequired) !== Boolean(no.qcRequired)) {
      parts.push(`QC ${oo.qcRequired ? 'yes' : 'no'} → ${no.qcRequired ? 'yes' : 'no'}`);
    }
    if (parts.length > 0) changed.push(`${label} (${parts.join(', ')})`);
  }
  for (const [seq, oo] of oldBySeq) {
    if (!newBySeq.has(seq)) {
      removed.push(`${opSrNo(seq)}. ${oo.operation || '(unnamed)'}`);
    }
  }

  const segs: string[] = [];
  if (added.length > 0) segs.push(`Added: ${added.join(', ')}`);
  if (removed.length > 0) segs.push(`Removed: ${removed.join(', ')}`);
  if (changed.length > 0) segs.push(`Changed: ${changed.join(', ')}`);
  return segs.length > 0 ? segs.join(' · ') : 'No op changes';
}

// ─── Audit trail (ADR-197) ────────────────────────────────────────────────
//
// The History tab reads before → after from `changes`, so both sides are
// built as a person reads them: ids already turned into codes, plan / op
// types into their screen words. Labels are the form's own (docs/NAMING.md).

export const PLAN_TYPE_LABEL: Record<string, string> = {
  manufacture: 'Manufacture',
  full_outsource: 'Full Outsource',
  direct_purchase: 'Buy',
};

const OP_TYPE_LABEL: Record<string, string> = {
  process: 'In-house',
  outsource: 'OSP',
  qc: 'QC',
};

export function labelOf(map: Record<string, string>): (v: unknown) => string | null {
  return (v) => (v === null || v === undefined || v === '' ? null : (map[String(v)] ?? String(v)));
}

/** The route card header as the form shows it. */
interface RcHeaderView {
  code?: string;
  itemCode?: string | null;
  planType?: string | null;
  rawMaterialGradeText?: string | null;
  rawMaterialSizeText?: string | null;
  rawMaterialItemCode?: string | null;
  rmQtyPerPiece?: number | null;
  notes?: string | null;
}

const RC_HEADER_FIELDS: readonly DiffField[] = [
  { key: 'code', label: 'RC No.' },
  { key: 'itemCode', label: 'Item Code' },
  { key: 'planType', label: 'Plan Type', format: labelOf(PLAN_TYPE_LABEL) },
  { key: 'rawMaterialGradeText', label: 'RM Grade' },
  { key: 'rawMaterialSizeText', label: 'RM Size' },
  { key: 'rawMaterialItemCode', label: 'RM Item' },
  { key: 'rmQtyPerPiece', label: 'RM Qty per piece' },
  { key: 'notes', label: 'Notes' },
];

const RC_OP_FIELDS: readonly DiffField[] = [
  { key: 'operation', label: 'Operation' },
  { key: 'opType', label: 'Op Type', format: labelOf(OP_TYPE_LABEL) },
  { key: 'machineCode', label: 'Machine' },
  { key: 'ospVendorCode', label: 'Vendor' },
  { key: 'cycleTimeMin', label: 'Cycle Time (min)' },
  { key: 'ospLeadDays', label: 'Lead Days' },
  { key: 'program', label: 'Program No.' },
  { key: 'toolNo', label: 'Tool No.' },
  { key: 'toolDetails', label: 'Tool Details' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'qcRequired', label: 'QC' },
];

/** Every op field empty — the "before" of an added op, the "after" of a removed one. */
const EMPTY_OP_VIEW: Record<string, null> = Object.fromEntries(
  RC_OP_FIELDS.map((f) => [f.key, null]),
);

function opView(o: DiffOp): Record<string, unknown> {
  // A legacy op with no QC flag reads as "No", so it is not a change to "No".
  return { ...o, qcRequired: Boolean(o.qcRequired) };
}

function rcOpRef(o: DiffOp): string {
  return `Op ${opSrNo(o.opSeq)} · ${o.operation || '(unnamed)'}`;
}

/** The Route Card Rev bump every saved revision carries. */
function revChange(before: number, after: number): ActivityChange {
  return { field: 'currentRevision', label: 'Route Card Rev', before, after };
}

interface RcOpLogRow {
  action: ActivityAction;
  opRef: string;
  changes: ActivityChange[];
  detail: string;
}

/** One log row per op that was added, removed or changed — ops are keyed by
 *  their position (opSeq), the same way the revision note compares them. */
export function routeCardOpLogRows(oldOps: DiffOp[], newOps: DiffOp[]): RcOpLogRow[] {
  const oldBySeq = new Map(oldOps.map((o) => [o.opSeq, o]));
  const newSeqs = new Set(newOps.map((o) => o.opSeq));
  const out: RcOpLogRow[] = [];
  for (const no of newOps) {
    const oo = oldBySeq.get(no.opSeq);
    if (!oo) {
      out.push({
        action: ActivityAction.Create,
        opRef: rcOpRef(no),
        changes: diffFields(EMPTY_OP_VIEW, opView(no), RC_OP_FIELDS).filter(
          (c) => c.after !== false,
        ),
        detail: 'Op added',
      });
      continue;
    }
    const changes = diffFields(opView(oo), opView(no), RC_OP_FIELDS);
    if (changes.length > 0) {
      out.push({ action: ActivityAction.Edit, opRef: rcOpRef(no), changes, detail: 'Op changed' });
    }
  }
  for (const oo of oldOps) {
    if (newSeqs.has(oo.opSeq)) continue;
    out.push({
      action: ActivityAction.Edit,
      opRef: rcOpRef(oo),
      changes: diffFields(opView(oo), EMPTY_OP_VIEW, RC_OP_FIELDS).filter(
        (c) => c.before !== false,
      ),
      detail: 'Op removed',
    });
  }
  return out;
}

/** The EDIT rows for one saved revision: the header row (its field changes +
 *  the Route Card Rev bump) and one row per changed op. */
async function logRouteCardRevision(
  tx: DbTransaction,
  companyId: string,
  user: AuthContext,
  rc: { id: string; code: string },
  headerChanges: ActivityChange[],
  opRows: RcOpLogRow[],
  detail: string,
): Promise<void> {
  if (headerChanges.length > 0) {
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Edit,
        entity: 'RouteCard',
        entityId: rc.id,
        refId: rc.code,
        changes: headerChanges,
        detail,
      },
      companyId,
      user,
    );
  }
  for (const r of opRows) {
    await emitActivityLog(
      tx,
      {
        action: r.action,
        entity: 'RouteCard',
        entityId: rc.id,
        refId: rc.code,
        opRef: r.opRef,
        changes: r.changes,
        detail: `${rc.code} ${r.opRef} — ${r.detail}`,
      },
      companyId,
      user,
    );
  }
}

// ─── Writes ───────────────────────────────────────────────────────────────

function rcDetailString(code: string, itemCode: string | null): string {
  return itemCode ? `${code} (${itemCode})` : code;
}

export async function createRouteCard(
  input: CreateRouteCardInput,
  user: AuthContext,
): Promise<RouteCardDetail> {
  await requireFormAccess(user, 'routecard_create', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // LOCK ORDER — plans BEFORE route_cards (Section 20.3), the same reason the
    // edit path does it, and NOT because a card row already exists. An earlier
    // version of this comment claimed create was safe since Execute has no
    // existing card to contend for; that is only true of saveRouteCardForItem's
    // UPDATE branch. Its INSERT branch contends for the PARTIAL UNIQUE INDEX
    // route_cards_company_item_uniq instead: item X has no card, one user saves
    // a new Route Card for X while another presses Execute on a blank-RM plan
    // for X, and Execute blocks on this transaction's uncommitted index tuple
    // while this transaction blocks on the plan row Execute holds — 40P01, raw
    // database error to whichever loses. Taking the plan locks first makes both
    // paths plans → route_cards.
    await lockBackfillCandidates(tx, companyId, input.itemId);

    // Validate item + capture display label for activity log.
    const item = await assertItemExists(tx, input.itemId, companyId);

    // Routing rule: a QC op may not sit directly after an OSP op. Route cards
    // have no rework/grandfather exemption — a routing saved as the item's
    // master must be clean. (Ops are ordered as sent; op_seq = index + 1.)
    assertNoQcDirectlyAfterOutsource(input.ops);

    // Validate referenced machines + vendors exist.
    const machineIds = input.ops.map((o) => o.machineId).filter((x): x is string => Boolean(x));
    const vendorIds = input.ops.map((o) => o.ospVendorId).filter((x): x is string => Boolean(x));
    const machinesLookup = await assertMachineIdsExist(tx, machineIds, companyId);
    const vendorsLookup = await assertVendorIdsExist(tx, vendorIds, companyId);

    // One active RC per item per company.
    const existing = await tx
      .select({ id: routeCards.id, code: routeCards.code })
      .from(routeCards)
      .where(
        and(
          eq(routeCards.companyId, companyId),
          eq(routeCards.itemId, input.itemId),
          isNull(routeCards.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictError(
        `An active Route Card already exists for ${item.code} (${existing[0]!.code}). Edit that one to add a revision.`,
      );
    }

    // Auto code when not supplied; reject if supplied + already used.
    // S2: a typed number is checked under the same series lock (lib/doc-series-lock).
    await lockDocSeries(tx, companyId, 'route_cards');
    const code = input.code?.trim() || (await nextRouteCardCode(tx, companyId));
    if (input.code) {
      const dup = await tx
        .select({ id: routeCards.id })
        .from(routeCards)
        .where(
          and(
            eq(routeCards.companyId, companyId),
            eq(routeCards.code, code),
            isNull(routeCards.deletedAt),
          ),
        )
        .limit(1);
      if (dup.length > 0) throw new ConflictError(`Route Card No. "${code}" already exists`);
    }

    const rawMaterial = await resolveRcRawMaterial(tx, companyId, input);

    const inserted = await tx
      .insert(routeCards)
      .values({
        companyId,
        code,
        itemId: input.itemId,
        currentRevision: 0,
        ...rawMaterial,
        notes: input.notes ?? null,
        planType: input.planType ?? 'manufacture',
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = inserted[0]!;

    const opValues = assignOpValues(input.ops, header.id, companyId, user.id);
    await tx.insert(routeCardOps).values(opValues);

    const snapshot = buildOpsSnapshot(input.ops, machinesLookup, vendorsLookup);
    await tx.insert(routeCardRevisions).values({
      companyId,
      routeCardId: header.id,
      revisionNo: 0,
      notes: 'Initial creation',
      opsSnapshot: snapshot,
      createdBy: user.id,
    });

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Create,
        entity: 'RouteCard',
        entityId: header.id,
        refId: header.code,
        detail: rcDetailString(header.code, item.code),
      },
      companyId,
      user,
    );

    // T2 (plan-rm-backfill) — the trigger that closes the designed
    // `route_card_pending` path: a plan may be made FIRST and this card AFTER,
    // and until now nothing carried the card's raw material back to the
    // waiting plan. The plan kept its blanks for ever, so Create Production
    // Order (which reads the PLAN's stored snapshot) showed nothing even
    // though the card had EN24 / DIA 32.
    //
    // Fills BLANKS only, never a plan whose Job Card exists, inside THIS
    // transaction — a failed backfill rolls the new card back with it. The
    // raw material is read back through the one shared lookup (newest card
    // first, which is the card just inserted above), so plan and card can
    // never be filled from two different queries.
    const rcRm = await readRouteCardRawMaterial(tx, companyId, input.itemId);
    if (rcRm) await backfillPlansFromRouteCard(tx, companyId, input.itemId, rcRm, user);

    return loadRouteCardDetail(tx, header.id, companyId);
  });
}

/** The checks an edit must pass before anything is written — ONE place, used
 *  by the writer (updateRouteCardTx) and by the edit-approval staging precheck
 *  (updateRouteCardOrStage, saveRouteCardForItem), so a proposal the writer
 *  would refuse is refused before it is staged, not at approval. `header` is
 *  the card row as stored (locked by the caller).
 *
 *  `routingUnchanged` (an approved edit whose "Operations" box was NOT
 *  approved, so the STORED ops + raw material are resubmitted as they stand):
 *  only what changes is checked — the routing rule, machine / vendor and raw
 *  material checks are skipped, so a grandfathered routing (QC after OSP from
 *  a Job Card auto-save) cannot block approving, say, its Notes. */
export async function validateRouteCardEdit(
  tx: DbTransaction,
  companyId: string,
  id: string,
  header: typeof routeCards.$inferSelect,
  input: UpdateRouteCardInput,
  routingUnchanged = false,
): Promise<{
  item: { code: string; name: string };
  machinesLookup: MachinesLookup;
  vendorsLookup: VendorsLookup;
  rawMaterial: ResolvedRawMaterial;
}> {
  // Validate item exists (may have changed if user re-pointed).
  const item = await assertItemExists(tx, input.itemId, companyId);

  // If item changed, ensure no other active RC owns the new item.
  if (input.itemId !== header.itemId) {
    const other = await tx
      .select({ id: routeCards.id, code: routeCards.code })
      .from(routeCards)
      .where(
        and(
          eq(routeCards.companyId, companyId),
          eq(routeCards.itemId, input.itemId),
          isNull(routeCards.deletedAt),
          sql`${routeCards.id} != ${id}::uuid`,
        ),
      )
      .limit(1);
    if (other.length > 0) {
      throw new ConflictError(
        `Another Route Card already covers ${item.code} (${other[0]!.code}).`,
      );
    }
  }

  // code collision check (only when it changed).
  if (input.code !== header.code) {
    const dup = await tx
      .select({ id: routeCards.id })
      .from(routeCards)
      .where(
        and(
          eq(routeCards.companyId, companyId),
          eq(routeCards.code, input.code),
          isNull(routeCards.deletedAt),
          sql`${routeCards.id} != ${id}::uuid`,
        ),
      )
      .limit(1);
    if (dup.length > 0) throw new ConflictError(`Route Card No. "${input.code}" already exists`);
  }

  if (routingUnchanged) {
    // Lookups only for the revision snapshot; the stored RM as it stands.
    return {
      item,
      machinesLookup: await loadMachinesByIds(
        tx,
        input.ops.map((o) => o.machineId).filter((x): x is string => Boolean(x)),
        companyId,
      ),
      vendorsLookup: await loadVendorsByIds(
        tx,
        input.ops.map((o) => o.ospVendorId).filter((x): x is string => Boolean(x)),
        companyId,
      ),
      rawMaterial: {
        rawMaterialGradeId: header.rawMaterialGradeId,
        rawMaterialGradeText: header.rawMaterialGradeText,
        rawMaterialSizeId: header.rawMaterialSizeId,
        rawMaterialSizeText: header.rawMaterialSizeText,
        rawMaterialItemId: header.rawMaterialItemId,
        rmQtyPerPiece: header.rmQtyPerPiece,
      },
    };
  }

  // Routing rule: a QC op may not sit directly after an OSP op. Same as
  // create — no rework/grandfather exemption on an item's master routing.
  assertNoQcDirectlyAfterOutsource(input.ops);

  // Validate ops references.
  const machineIds = input.ops.map((o) => o.machineId).filter((x): x is string => Boolean(x));
  const vendorIds = input.ops.map((o) => o.ospVendorId).filter((x): x is string => Boolean(x));
  const machinesLookup = await assertMachineIdsExist(tx, machineIds, companyId);
  // Vendors already on this route card's ops stay allowed even if inactive.
  const currentOpVendors = await tx
    .select({ id: routeCardOps.ospVendorId })
    .from(routeCardOps)
    .where(
      and(
        eq(routeCardOps.routeCardId, id),
        eq(routeCardOps.companyId, companyId),
        isNull(routeCardOps.deletedAt),
      ),
    );
  const vendorsLookup = await assertVendorIdsExist(
    tx,
    vendorIds,
    companyId,
    new Set(currentOpVendors.flatMap((r) => (r.id ? [r.id] : []))),
  );

  const rawMaterial = await resolveRcRawMaterial(tx, companyId, input, {
    rawMaterialItemId: header.rawMaterialItemId,
    rmQtyPerPiece: header.rmQtyPerPiece,
  });
  return { item, machinesLookup, vendorsLookup, rawMaterial };
}

export async function updateRouteCard(
  id: string,
  input: UpdateRouteCardInput,
  user: AuthContext,
): Promise<RouteCardDetail> {
  // The `edit` check lives HERE, not in updateRouteCardTx, so the edit-approval
  // engine's applyEdit can replay an approved edit for an approver who holds
  // `approve` but not `edit` (the same split as updateBomMaster).
  await requireFormAccess(user, 'routecard_create', 'edit');
  return withUserContext(user, (tx) => updateRouteCardTx(tx, id, input, user));
}

/**
 * The Route Card edit entry point the HTTP route calls (ADR-249 Step B2). With
 * the company's edit-approval gate on, an edit to a live card is STAGED for
 * per-box approval and `{ staged: true, request }` comes back; otherwise it
 * saves directly through updateRouteCard, exactly as before.
 */
export async function updateRouteCardOrStage(
  id: string,
  input: UpdateRouteCardInput,
  user: AuthContext,
): Promise<RouteCardDetail | DocumentEditStagedResult> {
  await requireFormAccess(user, 'routecard_create', 'edit');
  const companyId = requireCompany(user);
  // Imported dynamically: the engine's registry imports the Route Card entry,
  // which imports this file — a static import would be a cycle.
  const { requestDocumentEdit } = await import('../document-edits/service');
  const request = await requestDocumentEdit(
    'RouteCard',
    id,
    input,
    input.expectedUpdatedAt,
    user,
    async (tx, target) => {
      // §20.3 — approving a move to item B would lock B's plans AFTER the
      // route_cards row (the reverse of executePlan), so a re-point is not
      // staged at all.
      if (input.itemId !== target.doc['itemId']) {
        throw new ConflictError(
          'An approved Route Card cannot be moved to another item while Document Edit ' +
            'Approval is on — create a Route Card for that item instead.',
        );
      }
      // The writer's own checks, under the locks loadForDiff took.
      await validateRouteCardEdit(
        tx,
        companyId,
        id,
        target.doc as unknown as typeof routeCards.$inferSelect,
        input,
      );
    },
  );
  if (request) return { staged: true, request };
  return updateRouteCard(id, input, user);
}

/** The Route Card writer, inside the caller's transaction. PUT (through
 *  updateRouteCard) and the edit-approval applyEdit both land here, so an
 *  approved edit gets the same checks, revision bump, plan backfill and
 *  History as a direct save. */
export async function updateRouteCardTx(
  tx: DbTransaction,
  id: string,
  input: UpdateRouteCardInput,
  user: AuthContext,
  /** `routingUnchanged`: see validateRouteCardEdit — set by the edit-approval
   *  applyEdit when only header boxes were approved. */
  opts?: { routingUnchanged?: boolean },
): Promise<RouteCardDetail> {
  const companyId = requireCompany(user);
  // LOCK ORDER — plans BEFORE route_cards (CLAUDE.md Section 20.3). This is
  // the FIRST statement of the transaction, ahead of the route_cards row lock
  // below, because this path ends in a T2 backfill that locks plan rows
  // (backfillPlansFromRouteCard, bottom of this function). `executePlan`
  // (modules/plans/service.ts) goes the other way round — it locks the plan
  // row FOR UPDATE and only later writes this item's route_cards row through
  // `saveRouteCardForItem` — so route_cards → plans here would let one user
  // saving the Route Card for item X and another pressing Execute on a plan
  // for item X deadlock (Postgres 40P01), with the loser getting a raw
  // database error. Taking the plan locks first makes both paths
  // plans → route_cards, so one simply waits for the other.
  //
  // It locks exactly the rows the backfill will touch, using the SAME
  // predicate (backfillCandidateGuard), which keys on the PLAN's blank
  // columns, its item and its Job Card — never on the card's values — so
  // writing the route_cards row in between cannot change the set. The
  // backfill's own FOR UPDATE then re-locks rows this transaction already
  // holds, which is free. createRouteCard takes the same pre-lock, for the
  // partial-unique-index reason spelled out there.
  await lockBackfillCandidates(tx, companyId, input.itemId);

  const headers = await tx
    .select()
    .from(routeCards)
    .where(
      and(eq(routeCards.id, id), eq(routeCards.companyId, companyId), isNull(routeCards.deletedAt)),
    )
    .for('update')
    .limit(1);
  const header = headers[0];
  if (!header) throw new NotFoundError('Route Card not found. It may have been moved to Trash.');
  // R5: refuse the save if someone else edited the Route Card after this form opened it.
  assertUnchangedSinceOpened(header.updatedAt, input.expectedUpdatedAt);

  // Item, code, routing rule, machines / vendors, raw material — one place
  // (validateRouteCardEdit), shared with the edit-approval staging precheck.
  // Legacy JC edits reach the route card through saveRouteCardForItem, not
  // here, so a grandfathered JC's auto-save is not caught by the QC rule.
  const { item, machinesLookup, vendorsLookup, rawMaterial } = await validateRouteCardEdit(
    tx,
    companyId,
    id,
    header,
    input,
    opts?.routingUnchanged === true,
  );

  // What changed ABOVE the operation table — computed here, while `header`
  // still holds the pre-save values. These edits bump the revision like any
  // other save, so leaving them out of the note meant a card could go from
  // Rev 2 to Rev 3 with "No op changes" written against it and no record
  // anywhere that the raw material grade had been swapped.
  const headerChanges: string[] = [];
  if (input.code !== header.code) {
    headerChanges.push(`Code ${header.code} → ${input.code}`);
  }
  let prevItemCode: string | null = item.code;
  if (input.itemId !== header.itemId) {
    // Plain select, not assertItemExists: the OLD item may since have been
    // deleted, and that must not block recording that it was replaced.
    const prev = await tx
      .select({ code: items.code })
      .from(items)
      .where(eq(items.id, header.itemId))
      .limit(1);
    prevItemCode = prev[0]?.code ?? null;
    headerChanges.push(`Item ${prev[0]?.code ?? '—'} → ${item.code}`);
  }
  if ((rawMaterial.rawMaterialGradeText ?? null) !== (header.rawMaterialGradeText ?? null)) {
    headerChanges.push(
      `Grade ${noteVal(header.rawMaterialGradeText)} → ${noteVal(rawMaterial.rawMaterialGradeText)}`,
    );
  }
  if ((rawMaterial.rawMaterialSizeText ?? null) !== (header.rawMaterialSizeText ?? null)) {
    headerChanges.push(
      `Size ${noteVal(header.rawMaterialSizeText)} → ${noteVal(rawMaterial.rawMaterialSizeText)}`,
    );
  }
  if (
    (rawMaterial.rawMaterialItemId ?? null) !== (header.rawMaterialItemId ?? null) ||
    (rawMaterial.rmQtyPerPiece ?? null) !== (header.rmQtyPerPiece ?? null)
  ) {
    const codes = await rmItemCodes(tx, companyId, [
      header.rawMaterialItemId,
      rawMaterial.rawMaterialItemId,
    ]);
    headerChanges.push(
      `RM item ${rmItemNote(codes, header.rawMaterialItemId, header.rmQtyPerPiece)} → ${rmItemNote(codes, rawMaterial.rawMaterialItemId, rawMaterial.rmQtyPerPiece)}`,
    );
  }
  // The plan type is a header fact like grade and size: a change to it is a
  // revision and belongs in the auto-note next to them.
  const nextPlanType = input.planType ?? header.planType;
  if (nextPlanType !== header.planType) {
    headerChanges.push(`Plan type ${header.planType} → ${nextPlanType}`);
  }
  if ((input.notes ?? null) !== (header.notes ?? null)) {
    headerChanges.push(`Notes ${noteVal(header.notes)} → ${noteVal(input.notes)}`);
  }

  // ADR-197 — the same header, as a person reads it, for the log's
  // before → after. Read here, before the UPDATE below.
  const rmCodes = await rmItemCodes(tx, companyId, [
    header.rawMaterialItemId,
    rawMaterial.rawMaterialItemId,
  ]);
  const beforeView: RcHeaderView = {
    code: header.code,
    itemCode: prevItemCode,
    planType: header.planType,
    rawMaterialGradeText: header.rawMaterialGradeText,
    rawMaterialSizeText: header.rawMaterialSizeText,
    rawMaterialItemCode: header.rawMaterialItemId
      ? (rmCodes.get(header.rawMaterialItemId) ?? null)
      : null,
    rmQtyPerPiece: header.rmQtyPerPiece,
    notes: header.notes,
  };
  const afterView: RcHeaderView = {
    code: input.code,
    itemCode: item.code,
    planType: nextPlanType,
    rawMaterialGradeText: rawMaterial.rawMaterialGradeText,
    rawMaterialSizeText: rawMaterial.rawMaterialSizeText,
    rawMaterialItemCode: rawMaterial.rawMaterialItemId
      ? (rmCodes.get(rawMaterial.rawMaterialItemId) ?? null)
      : null,
    rmQtyPerPiece: rawMaterial.rmQtyPerPiece,
    notes: input.notes ?? null,
  };

  // Header fields the ops-replace helper does not own. rawMaterial is always
  // written, never merged — sending null (or leaving the field out) clears
  // the grade or size instead of keeping the old one.
  await tx
    .update(routeCards)
    .set({
      code: input.code,
      itemId: input.itemId,
      ...rawMaterial,
      notes: input.notes ?? null,
      planType: input.planType ?? header.planType,
      updatedBy: user.id,
      updatedAt: new Date(),
    })
    .where(eq(routeCards.id, id));

  // Ops swap + revision bump + snapshot live in ONE place
  // (replaceRouteCardOps) shared with the auto-save path below.
  // skipWhenUnchanged is false here: an explicit user save always
  // records a revision, exactly as it did before this refactor.
  const replaced = await replaceRouteCardOps(
    tx,
    {
      routeCardId: id,
      companyId,
      currentRevision: header.currentRevision,
      ops: input.ops,
      machinesLookup,
      vendorsLookup,
      note: input.revisionNote?.trim() || null,
      headerNote: headerChanges.length > 0 ? headerChanges.join(', ') : null,
    },
    user,
  );

  // An explicit save always records a revision, so the header row always
  // carries at least the Route Card Rev bump.
  const revisionNote = input.revisionNote?.trim();
  await logRouteCardRevision(
    tx,
    companyId,
    user,
    { id, code: input.code },
    [
      ...diffFields(beforeView, afterView, RC_HEADER_FIELDS),
      revChange(header.currentRevision, replaced.newRevision),
    ],
    routeCardOpLogRows(replaced.oldOps, replaced.newOps),
    `Edited ${rcDetailString(input.code, item.code)}${revisionNote ? ` — ${revisionNote}` : ''}`,
  );

  // T2 (plan-rm-backfill) on the EDIT side — the create-only version of this
  // left a hole as wide as the one it closed: a card saved with blank raw
  // material, or one whose grade / size was typed in a week later, never
  // reached the plans already waiting on it, so they kept their blanks for
  // ever and Create Production Order stayed empty.
  //
  // Same shape and the same lookup as createRouteCard, inside THIS
  // transaction so a failed backfill rolls the edit back with it. Still
  // fill-BLANKS-only and now per HALF (a blank grade OR a blank size, jc_id
  // NULL — the guards live in backfillPlansFromRouteCard), so an edit can
  // never overwrite a grade or a size a planner typed.
  //
  // LOCK ORDER — the plan rows this locks were ALREADY locked at the top of
  // this transaction (lockBackfillCandidates), with the same predicate and
  // for this reason: `executePlan` locks plans before route_cards, and this
  // path must not go the other way or the two deadlock. Re-locking rows we
  // already hold is free. Do not move this call above the pre-lock, and do
  // not drop the pre-lock.
  //
  // NOT on a re-point. This form can move a card from item A to item B, and
  // the raw material on it was chosen for A. Backfilling then stamps A's
  // grade and size onto every blank-RM plan of B while A's plans keep what
  // this card already gave them — one card's material landing on two parts.
  // A re-pointed card fills B's plans the next time someone saves it with
  // the material B actually needs.
  if (input.itemId === header.itemId) {
    const rcRm = await readRouteCardRawMaterial(tx, companyId, input.itemId);
    if (rcRm) await backfillPlansFromRouteCard(tx, companyId, input.itemId, rcRm, user);
  }

  return loadRouteCardDetail(tx, id, companyId);
}

export async function softDeleteRouteCard(
  id: string,
  user: AuthContext,
  /** Why it was deleted (ADR-197). Optional at the door so an older screen
   *  still deletes; the Route Card screens always ask for one. */
  reason?: string | null,
): Promise<RouteCard> {
  // ADR-232 — deleting any record needs L6 Super Admin.
  await requireDeleteRight(user, 'Route Cards');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const headers = await tx
      .select()
      .from(routeCards)
      .where(
        and(
          eq(routeCards.id, id),
          eq(routeCards.companyId, companyId),
          isNull(routeCards.deletedAt),
        ),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError('Route Card not found. It may have been moved to Trash.');

    // Look up the item for the activity-log label only; downstream
    // JC creation uses route_card_ops snapshots, so no link block.
    const itemRows = await tx
      .select({ code: items.code })
      .from(items)
      .where(and(eq(items.id, header.itemId), isNull(items.deletedAt)))
      .limit(1);
    const itemCode = itemRows[0]?.code ?? null;

    const stamp = softDeleteStamp(user);
    await tx
      .update(routeCards)
      .set({ ...stamp, updatedBy: user.id, updatedAt: stamp.deletedAt })
      .where(eq(routeCards.id, id));
    // The ops go to Trash with their card, stamped the same way.
    await tx
      .update(routeCardOps)
      .set({ ...stamp, updatedBy: user.id, updatedAt: stamp.deletedAt })
      .where(
        and(
          eq(routeCardOps.routeCardId, id),
          eq(routeCardOps.companyId, companyId),
          isNull(routeCardOps.deletedAt),
        ),
      );

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Delete,
        entity: 'RouteCard',
        entityId: id,
        refId: header.code,
        reason: reason ?? null,
        detail: rcDetailString(header.code, itemCode),
      },
      companyId,
      user,
    );

    return {
      id: header.id,
      companyId: header.companyId,
      code: header.code,
      itemId: header.itemId,
      currentRevision: header.currentRevision,
      rawMaterialGradeId: header.rawMaterialGradeId,
      rawMaterialGradeText: header.rawMaterialGradeText,
      rawMaterialSizeId: header.rawMaterialSizeId,
      rawMaterialSizeText: header.rawMaterialSizeText,
      rawMaterialItemId: header.rawMaterialItemId,
      rawMaterialItemCode: null,
      rmQtyPerPiece: header.rmQtyPerPiece,
      notes: header.notes,
      planType: header.planType,
      createdAt: tsLike(header.createdAt),
      createdBy: header.createdBy,
      updatedAt: tsLike(header.updatedAt),
      updatedBy: header.updatedBy,
      deletedAt: stamp.deletedAt.toISOString(),
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Item codes for the revision note's "RM item A → B" (ADR-193 phase 3a). No
 *  deleted_at filter: the OLD item may since have been deleted. */
async function rmItemCodes(
  tx: DbTransaction,
  companyId: string,
  ids: Array<string | null>,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(and(eq(items.companyId, companyId), inArray(items.id, unique)));
  return new Map(rows.map((r) => [r.id, r.code]));
}

/** Is a raw-material text column BLANK — never set, or left as an empty string
 *  by older data? ADR-218: blank is the only state a document downstream of the
 *  Route Card may write into, so this one test decides every fill. Empty string
 *  counts as blank because it holds no information: filling it loses nothing.
 *  (plans/rm-backfill.ts keys on NULL alone; a plan row cannot hold '' because
 *  every writer trims to null, and a card's history is longer.) */
function isBlankRmText(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === '';
}

/** Which raw-material halves a Job Card / plan auto-save may fill on an
 *  EXISTING card (ADR-218: a half the card holds blank, from non-blank incoming
 *  values; the RM item moves as a pair). One test, used by the direct fill and
 *  by a staged routing change (ADR-249 Step B2). */
export function rmHalvesToFill(
  card: {
    rawMaterialGradeText: string | null;
    rawMaterialSizeText: string | null;
    rawMaterialItemId: string | null;
    rmQtyPerPiece: number | null;
  },
  incoming: ResolvedRawMaterial,
): { grade: boolean; size: boolean; rmItem: boolean } {
  return {
    grade:
      isBlankRmText(card.rawMaterialGradeText) && !isBlankRmText(incoming.rawMaterialGradeText),
    size: isBlankRmText(card.rawMaterialSizeText) && !isBlankRmText(incoming.rawMaterialSizeText),
    rmItem:
      card.rawMaterialItemId === null &&
      card.rmQtyPerPiece === null &&
      Boolean(incoming.rawMaterialItemId) &&
      incoming.rmQtyPerPiece != null,
  };
}

/** The same test as SQL, for the UPDATE's WHERE — the concurrency guard that
 *  makes the fill fill-blanks-only at the database, not just in memory.
 *  `btrim` so this agrees EXACTLY with isBlankRmText: every half's guard is
 *  AND-ed into one UPDATE, so a disagreement on a whitespace-only column makes
 *  the whole statement match zero rows and silently drops a sibling half's
 *  legitimate fill. */
function blankRmTextSql(col: AnyColumn): SQL {
  return sql`coalesce(btrim(${col}), '') = ''`;
}

function rmItemNote(codes: Map<string, string>, id: string | null, qty: number | null): string {
  if (!id) return '—';
  return `${codes.get(id) ?? '?'} × ${qty ?? '—'} per piece`;
}

function assignOpValues(
  ops: CreateRouteCardOpInput[],
  routeCardId: string,
  companyId: string,
  userId: string,
): Array<typeof routeCardOps.$inferInsert> {
  return ops.map((o, i) => ({
    companyId,
    routeCardId,
    opSeq: i + 1,
    machineId: o.machineId ?? null,
    machineCodeText: o.machineCodeText ?? null,
    operation: o.operation,
    opType: o.opType,
    cycleTimeMin: o.cycleTimeMin.toFixed(2),
    program: o.program ?? null,
    toolNo: o.toolNo ?? null,
    toolDetails: o.toolDetails ?? null,
    remarks: o.remarks ?? null,
    qcRequired: o.qcRequired,
    ospVendorId: o.ospVendorId ?? null,
    ospVendorCodeText: o.ospVendorCodeText ?? null,
    ospLeadDays: o.ospLeadDays ?? null,
    createdBy: userId,
    updatedBy: userId,
  }));
}

function buildOpsSnapshot(
  ops: CreateRouteCardOpInput[],
  machinesLookup: MachinesLookup,
  vendorsLookup: VendorsLookup,
): unknown {
  return ops.map((o, i) => ({
    opSeq: i + 1,
    machineId: o.machineId ?? null,
    machineCode:
      (o.machineId ? machinesLookup.byId.get(o.machineId)?.code : null) ??
      o.machineCodeText ??
      null,
    operation: o.operation,
    opType: o.opType,
    cycleTimeMin: o.cycleTimeMin.toFixed(2),
    program: o.program ?? null,
    toolNo: o.toolNo ?? null,
    toolDetails: o.toolDetails ?? null,
    // In the snapshot too (migration 0195). A field left out of here is gone
    // from the history the moment the next revision is raised: the op rows are
    // deleted and re-inserted, and this jsonb is all that remains of the old ones.
    remarks: o.remarks ?? null,
    ospVendorCode:
      (o.ospVendorId ? vendorsLookup.byId.get(o.ospVendorId)?.code : null) ??
      o.ospVendorCodeText ??
      null,
    ospLeadDays: o.ospLeadDays ?? null,
    qcRequired: Boolean(o.qcRequired),
  }));
}

// ─── Shared ops-replace + revision bump ───────────────────────────────────
//
// One implementation of "snapshot the ops that are there, swap in the new
// ones, bump current_revision, log a revision row". Used by updateRouteCard
// (explicit user edit) and by saveRouteCardForItem (auto-save from a Job
// Card / plan execute).

/** A route card op reduced to the fields that are actually persisted, so two
 *  op lists can be compared for equality without caring about row ids. */
interface ComparableOp {
  opSeq: number;
  machineId: string | null;
  machineCodeText: string | null;
  operation: string;
  opType: string;
  cycleTimeMin: number;
  program: string | null;
  toolNo: string | null;
  toolDetails: string | null;
  // remarks is deliberately NOT compared. This equality test is what lets the
  // auto-save path (Job Card / plan execute) leave an unchanged routing's op
  // rows alone. Those source documents carry no remarks, so comparing it would
  // make every auto-save look like a change and blank the note out.
  qcRequired: boolean;
  ospVendorId: string | null;
  ospVendorCodeText: string | null;
  ospLeadDays: number | null;
}

function comparableFromInput(o: CreateRouteCardOpInput, index: number): ComparableOp {
  return {
    opSeq: index + 1,
    machineId: o.machineId ?? null,
    machineCodeText: o.machineCodeText ?? null,
    operation: o.operation,
    opType: o.opType,
    cycleTimeMin: Number(o.cycleTimeMin ?? 0),
    program: o.program ?? null,
    toolNo: o.toolNo ?? null,
    toolDetails: o.toolDetails ?? null,
    qcRequired: Boolean(o.qcRequired),
    ospVendorId: o.ospVendorId ?? null,
    ospVendorCodeText: o.ospVendorCodeText ?? null,
    ospLeadDays: o.ospLeadDays ?? null,
  };
}

function comparableFromRow(r: typeof routeCardOps.$inferSelect): ComparableOp {
  return {
    opSeq: r.opSeq,
    machineId: r.machineId ?? null,
    machineCodeText: r.machineCodeText ?? null,
    operation: r.operation,
    opType: r.opType,
    cycleTimeMin: Number(r.cycleTimeMin),
    program: r.program ?? null,
    toolNo: r.toolNo ?? null,
    toolDetails: r.toolDetails ?? null,
    qcRequired: Boolean(r.qcRequired),
    ospVendorId: r.ospVendorId ?? null,
    ospVendorCodeText: r.ospVendorCodeText ?? null,
    ospLeadDays: r.ospLeadDays ?? null,
  };
}

function opsAreIdentical(current: ComparableOp[], next: ComparableOp[]): boolean {
  if (current.length !== next.length) return false;
  return JSON.stringify(current) === JSON.stringify(next);
}

interface ReplaceRouteCardOpsParams {
  routeCardId: string;
  companyId: string;
  /** The card's revision BEFORE this call. */
  currentRevision: number;
  ops: CreateRouteCardOpInput[];
  machinesLookup: MachinesLookup;
  vendorsLookup: VendorsLookup;
  /** Explicit revision note; when null/empty an auto diff note is generated. */
  note?: string | null;
  /** Prefix put in front of the auto diff note (auto-save names its source doc). */
  notePrefix?: string | null;
  /** Changes to the card's HEADER (code, item, grade, size, notes) — appended
   *  to whatever note the ops produce. Without this a save that only swapped
   *  the raw material grade bumped the revision and recorded nothing about
   *  what actually changed. Appended even when the user typed their own note,
   *  so a header change can never go unrecorded. */
  headerNote?: string | null;
  /** When true, an ops list identical to the stored one is a no-op: no revision
   *  bump, no snapshot row. Used by the auto-save path so re-running the same
   *  routing does not inflate the revision history. */
  skipWhenUnchanged?: boolean;
  /** Carry each step's existing `remarks` across the delete + re-insert when the
   *  incoming op supplies none. Set by the AUTO-SAVE only — see the comment at
   *  the use site for why an explicit card edit must not do this. */
  preserveRemarks?: boolean;
}

/** The auto-save's remark carry-over (0195) — see the note at its use in
 *  replaceRouteCardOps. One place, also used to build a staged routing change
 *  (ADR-249 Step B2) so the approver sees the remarks that would be kept. */
function carryRemarksForward(
  ops: CreateRouteCardOpInput[],
  prevOps: ReadonlyArray<{
    opSeq: number;
    operation: string;
    opType: string;
    machineId: string | null;
    ospVendorId: string | null;
    remarks: string | null;
  }>,
): CreateRouteCardOpInput[] {
  return ops.map((o, i) => {
    if (o.remarks != null && o.remarks.trim() !== '') return o;
    const prev = prevOps[i];
    if (!prev?.remarks) return o;
    if (prev.opSeq !== i + 1) return o;
    if (prev.operation.trim().toUpperCase() !== o.operation.trim().toUpperCase()) return o;
    if (prev.opType !== o.opType) return o;
    // Name + position + kind are NOT enough: two DEBURR steps on different
    // benches are routine, and deleting the first would move the first
    // one's remark onto the second. The machine / vendor must match too.
    if (prev.machineId !== (o.machineId ?? null)) return o;
    if (prev.ospVendorId !== (o.ospVendorId ?? null)) return o;
    return { ...o, remarks: prev.remarks };
  });
}

async function replaceRouteCardOps(
  tx: DbTransaction,
  p: ReplaceRouteCardOpsParams,
  user: AuthContext,
): Promise<{ newRevision: number; changed: boolean; oldOps: DiffOp[]; newOps: DiffOp[] }> {
  // Capture PRE-update ops for the revision snapshot + diff note.
  const oldOpRows = await tx
    .select({
      op: routeCardOps,
      machineCode: machines.code,
      ospVendorCode: vendors.code,
    })
    .from(routeCardOps)
    .leftJoin(machines, eq(machines.id, routeCardOps.machineId))
    .leftJoin(vendors, eq(vendors.id, routeCardOps.ospVendorId))
    .where(
      and(
        eq(routeCardOps.routeCardId, p.routeCardId),
        eq(routeCardOps.companyId, p.companyId),
        isNull(routeCardOps.deletedAt),
      ),
    )
    .orderBy(asc(routeCardOps.opSeq));

  if (
    p.skipWhenUnchanged === true &&
    opsAreIdentical(
      oldOpRows.map((r) => comparableFromRow(r.op)),
      p.ops.map(comparableFromInput),
    )
  ) {
    return { newRevision: p.currentRevision, changed: false, oldOps: [], newOps: [] };
  }

  // An auto-save from a Job Card / plan rewrites the routing from a document
  // that carries no remarks of its own (they deliberately never reach jc_ops),
  // so a plain re-insert would blank a note the planner typed here. Carry the
  // old remark forward — but only onto a step that is unmistakably the same one:
  // same position, same name, same kind. If the step moved or changed, the
  // remark may no longer be true of it, so it is dropped rather than guessed.
  // An EXPLICIT card edit never takes this path: there, an emptied box means the
  // user cleared it on purpose and it must clear.
  const opsToWrite: CreateRouteCardOpInput[] =
    p.preserveRemarks === true
      ? carryRemarksForward(
          p.ops,
          oldOpRows.map((r) => r.op),
        )
      : p.ops;

  const oldSnapshot: DiffOp[] = oldOpRows.map((r) => ({
    opSeq: r.op.opSeq,
    machineCode: r.machineCode ?? r.op.machineCodeText ?? null,
    operation: r.op.operation,
    opType: r.op.opType,
    cycleTimeMin: r.op.cycleTimeMin,
    ospVendorCode: r.ospVendorCode ?? r.op.ospVendorCodeText ?? null,
    ospLeadDays: r.op.ospLeadDays,
    program: r.op.program,
    toolNo: r.op.toolNo,
    toolDetails: r.op.toolDetails,
    remarks: r.op.remarks,
    qcRequired: r.op.qcRequired,
  }));

  const newSnapshot: DiffOp[] = opsToWrite.map((o, i) => ({
    opSeq: i + 1,
    machineCode:
      (o.machineId ? p.machinesLookup.byId.get(o.machineId)?.code : null) ??
      o.machineCodeText ??
      null,
    operation: o.operation,
    opType: o.opType,
    cycleTimeMin: o.cycleTimeMin.toFixed(2),
    ospVendorCode:
      (o.ospVendorId ? p.vendorsLookup.byId.get(o.ospVendorId)?.code : null) ??
      o.ospVendorCodeText ??
      null,
    ospLeadDays: o.ospLeadDays ?? null,
    program: o.program ?? null,
    toolNo: o.toolNo ?? null,
    toolDetails: o.toolDetails ?? null,
    remarks: o.remarks ?? null,
    qcRequired: Boolean(o.qcRequired),
  }));

  const autoNote = computeRouteCardDiffNote(oldSnapshot, newSnapshot);
  const explicit = p.note?.trim();
  const opsNote = explicit ? explicit : p.notePrefix ? `${p.notePrefix} — ${autoNote}` : autoNote;
  const headerNote = p.headerNote?.trim();
  const finalNote = headerNote ? `${opsNote} · ${headerNote}` : opsNote;

  // Hard-delete old op rows (pre-state is captured in the snapshot).
  await tx
    .delete(routeCardOps)
    .where(
      and(eq(routeCardOps.routeCardId, p.routeCardId), eq(routeCardOps.companyId, p.companyId)),
    );

  const newRevision = p.currentRevision + 1;

  await tx
    .update(routeCards)
    .set({ currentRevision: newRevision, updatedBy: user.id, updatedAt: new Date() })
    .where(and(eq(routeCards.id, p.routeCardId), eq(routeCards.companyId, p.companyId)));

  await tx
    .insert(routeCardOps)
    .values(assignOpValues(opsToWrite, p.routeCardId, p.companyId, user.id));

  await tx.insert(routeCardRevisions).values({
    companyId: p.companyId,
    routeCardId: p.routeCardId,
    revisionNo: newRevision,
    notes: finalNote,
    opsSnapshot: buildOpsSnapshot(opsToWrite, p.machinesLookup, p.vendorsLookup),
    createdBy: user.id,
  });

  return { newRevision, changed: true, oldOps: oldSnapshot, newOps: newSnapshot };
}

// ─── Auto-save from a source document (Job Card / plan execute) ───────────

/** Drop a trailing QC op that the SYSTEM appended (ADR-069 Rule B — job-cards
 *  `withTerminalQcOp`, plans `needsDefaultQcOp`).
 *
 *  Why this matters: that QC op is generated, not entered. Stored on the route
 *  card it would load back into the next plan, and the JC write would append a
 *  fresh one on top — the routing would grow one QC op every cycle.
 *
 *  The test is the exact inverse of the append rule: strip the last op only
 *  when it looks exactly like the generated one (opType 'qc', named
 *  "Final Inspection" — DEFAULT_FINAL_QC_OP, cycle time 0, qcRequired true)
 *  AND the remaining prefix is one that `needsDefaultQcOp` would append that
 *  same op to. So anything stripped is re-created byte-identically
 *  downstream, and an op that would NOT be re-created (a mid-route Final
 *  Inspection, a Final Inspection following an outsource step, a QC step the
 *  user named something else) is left untouched.
 *
 *  The name compare is case-folded on BOTH sides: the op name is free text and
 *  the default is mixed-case, so folding only one side would never match. */
export function stripAutoTerminalQcOp(ops: CreateRouteCardOpInput[]): CreateRouteCardOpInput[] {
  const last = ops[ops.length - 1];
  if (!last) return ops;
  if (last.opType !== 'qc') return ops;
  if (last.operation.trim().toUpperCase() !== DEFAULT_FINAL_QC_OP.toUpperCase()) return ops;
  if (Number(last.cycleTimeMin ?? 0) !== 0) return ops;
  if (last.qcRequired !== true) return ops;
  const head = ops.slice(0, -1);
  return needsDefaultQcOp(head) ? head : ops;
}

/**
 * ADR-249 Step B2 — stage a Job Card / plan routing change as a Route Card edit
 * request, INSIDE the caller's transaction (requestDocumentEditInTx runs in a
 * savepoint, so a refusal rolls back only the request and the caller carries
 * on). Returns:
 *   'direct' — the gate is off (or the card is not live): the caller rewrites
 *              the card exactly as before;
 *   'staged' — a request is waiting for approval; the card is untouched;
 *   { notSentReason } — the request was refused (one already waiting,
 *              nothing to approve): the routing is kept as stored, a blank
 *              raw-material half may still be filled (the caller falls through
 *              to the direct path with the STORED ops), the reason is returned
 *              to the saving screen, and the caller's save goes on.
 *
 * The proposal is the card's CURRENT header plus the new routing (remarks
 * carried as the direct auto-save carries them) and — only when the proposer
 * passes canWriteCard, as on the gate-off path — any blank raw-material half
 * filled (ADR-218). Approving it replays through overwriteRouteCardFromSource,
 * the gate-off writer, so it writes what the direct rewrite would have written.
 *
 * Lock order: the caller already holds its plan row, so loadForDiff is told
 * (stagingFromSourceDoc) to skip the plans pre-lock and lock only route_cards
 * + its ops — the same rows, in the same order, as the direct rewrite.
 */
async function stageRoutingFromSourceDoc(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
  card: {
    id: string;
    code: string;
    rawMaterialGradeId: string | null;
    rawMaterialGradeText: string | null;
    rawMaterialSizeId: string | null;
    rawMaterialSizeText: string | null;
    rawMaterialItemId: string | null;
    rmQtyPerPiece: number | null;
    notes: string | null;
    planType: RouteCard['planType'];
  },
  storedOps: Array<typeof routeCardOps.$inferSelect>,
  cleanOps: CreateRouteCardOpInput[],
  rawMaterial: ResolvedRawMaterial,
  user: AuthContext,
  sourceCode: string,
  canWriteCard: () => Promise<boolean>,
): Promise<'direct' | 'staged' | { notSentReason: string }> {
  // The blank-RM fill rides along only when the proposer may fill it, exactly
  // as the gate-off write path asks (ADR-218 canWriteCard).
  const fillRm = await canWriteCard();
  const fill = fillRm
    ? rmHalvesToFill(card, rawMaterial)
    : { grade: false, size: false, rmItem: false };
  const proposal: RouteCardEditPayload = {
    code: card.code,
    itemId,
    rawMaterialGradeId: fill.grade ? rawMaterial.rawMaterialGradeId : card.rawMaterialGradeId,
    rawMaterialGradeText: fill.grade ? rawMaterial.rawMaterialGradeText : card.rawMaterialGradeText,
    rawMaterialSizeId: fill.size ? rawMaterial.rawMaterialSizeId : card.rawMaterialSizeId,
    rawMaterialSizeText: fill.size ? rawMaterial.rawMaterialSizeText : card.rawMaterialSizeText,
    rawMaterialItemId: fill.rmItem ? rawMaterial.rawMaterialItemId : card.rawMaterialItemId,
    rmQtyPerPiece: fill.rmItem ? rawMaterial.rmQtyPerPiece : card.rmQtyPerPiece,
    notes: card.notes,
    // Left out = the writer keeps the stored plan type (the edit input cannot
    // carry 'assembly', which only the system sets).
    planType: card.planType === 'assembly' ? undefined : card.planType,
    ops: carryRemarksForward(cleanOps, storedOps),
    revisionNote: null,
    // Shown on the request's History row (the engine's request note).
    reason: `Routing changed on ${sourceCode}`,
    sourceCode,
    fillRm,
  };
  try {
    const { requestDocumentEditInTx } = await import('../document-edits/service');
    const request = await stagingFromSourceDoc.run(true, () =>
      requestDocumentEditInTx(
        tx,
        'RouteCard',
        card.id,
        proposal,
        undefined,
        user,
        // No precheck: the gate-off write path runs none of the Route Card
        // form's checks (grandfathered routings), and approval replays through
        // that same path (overwriteRouteCardFromSource), so one Job Card gives
        // the same card with the gate on or off.
        undefined,
        // The proposer needs no Route Card Edit tick: they never edit the card
        // themselves, the approver's Approve tick decides (no silent drop).
        { proposedBySourceDoc: true },
      ),
    );
    return request ? 'staged' : 'direct';
  } catch (e) {
    // Never fail the Job Card / plan over its Route Card. A refusal the engine
    // or the card's checks raise is expected; anything else is logged.
    if (!(e instanceof AppError)) {
      logger.warn(
        { err: e, routeCardId: card.id, sourceCode },
        'Route Card routing change could not be staged — card kept as stored',
      );
    }
    // Said to the user on the saving screen — never a silent drop.
    return {
      notSentReason: routingNotSentReason(card.code, e instanceof AppError ? e.message : null),
    };
  }
}

/** The card shape the source-document write path needs. */
export interface SourceDocCard {
  id: string;
  code: string;
  currentRevision: number;
  rawMaterialGradeText: string | null;
  rawMaterialSizeText: string | null;
  rawMaterialItemId: string | null;
  rmQtyPerPiece: number | null;
}

/**
 * The Job Card / plan write path onto an EXISTING card: fill blank raw
 * material only (ADR-218, behind `canWriteCard`), replace the routing (remarks
 * carried, no revision when nothing changed), log the revision. ONE writer for
 * the gate-off auto-save, the not-sent fall-through, and the approval of a
 * routing change staged from a source document (ADR-249 Step B2) — so one Job
 * Card gives the same card whether the gate is on or off. Deliberately not
 * the Route Card form's checks (validateRouteCardEdit): this path never had
 * them (grandfathered routings), and approval must not add them.
 */
export async function overwriteRouteCardFromSource(
  tx: DbTransaction,
  companyId: string,
  card: SourceDocCard,
  ops: CreateRouteCardOpInput[],
  rawMaterial: ResolvedRawMaterial,
  user: AuthContext,
  sourceCode: string,
  canWriteCard: () => Promise<boolean>,
): Promise<JcRouteCardWriteBack | null> {
  const machinesLookup = await loadMachinesByIds(
    tx,
    ops.map((o) => o.machineId).filter((x): x is string => Boolean(x)),
    companyId,
  );
  const vendorsLookup = await loadVendorsByIds(
    tx,
    ops.map((o) => o.ospVendorId).filter((x): x is string => Boolean(x)),
    companyId,
  );
  // RAW MATERIAL IS FILL-BLANKS-ONLY (ADR-218; CLAUDE.md §20.1 "one number,
  // one writer"). The Route Card for a part — or the BOM line for a BOM
  // child — is the ONE author of grade / size / RM item / RM qty per piece.
  // This function is called BY the documents downstream of the card (plan
  // execute, Job Card create / edit), so it may fill a half the card has
  // never had and it may NEVER replace one it already holds.
  //
  // It used to move "forwards": any non-blank incoming value overwrote the
  // card. That silently rewrote the master — IN-RC-00005 went Rev 0 → 1 and
  // gained EN24 / DIA 36 from IN-JC-26-00004, with no one asking for it.
  //
  // PER FIELD, NOT PER ROW, and each pair moves as a pair, exactly as
  // plans/rm-backfill.ts does it (backfillCandidateGuard + its per-half
  // UPDATE): a card that holds a size and no grade receives ONLY its grade,
  // and the id and the text of one half always come from the SAME document —
  // never an id from here beside text from there.
  //
  // A fill is TRIGGERED BY NON-BLANK INCOMING TEXT (not by an id alone).
  // Every caller resolves the pair through the same resolver, which rewrites
  // the text from the master whenever an id is given, so "id without text"
  // does not arise; keying on the text also means a fill can never repeat
  // itself and inflate the revision history.
  const rmPatch: Partial<ResolvedRawMaterial> = {};
  const rmChanges: string[] = [];
  // Repeated on the UPDATE's WHERE below — that is the concurrency guard: if
  // anyone fills the same half between this read and the write, the UPDATE
  // matches no row, nothing is claimed as written and the revision does not
  // move. No new lock is taken (see the lock-order note on
  // lockBackfillCandidates: route_cards must not be locked before plans).
  const rmBlankGuards: SQL[] = [];
  const fill = rmHalvesToFill(card, rawMaterial);
  if (fill.grade) {
    rmChanges.push(
      `Grade ${noteVal(card.rawMaterialGradeText)} → ${noteVal(rawMaterial.rawMaterialGradeText)}`,
    );
    rmPatch.rawMaterialGradeId = rawMaterial.rawMaterialGradeId;
    rmPatch.rawMaterialGradeText = rawMaterial.rawMaterialGradeText;
    rmBlankGuards.push(blankRmTextSql(routeCards.rawMaterialGradeText));
  }
  if (fill.size) {
    rmChanges.push(
      `Size ${noteVal(card.rawMaterialSizeText)} → ${noteVal(rawMaterial.rawMaterialSizeText)}`,
    );
    rmPatch.rawMaterialSizeId = rawMaterial.rawMaterialSizeId;
    rmPatch.rawMaterialSizeText = rawMaterial.rawMaterialSizeText;
    rmBlankGuards.push(blankRmTextSql(routeCards.rawMaterialSizeText));
  }
  // ADR-193 phase 3a: the RM item + qty per piece fill the same way, as a
  // pair (resolveRmItem guarantees both or neither). Blank means BOTH columns
  // are null — the same test rm-backfill.ts uses for a plan's pair.
  if (fill.rmItem && rawMaterial.rawMaterialItemId) {
    const codes = await rmItemCodes(tx, companyId, [rawMaterial.rawMaterialItemId]);
    rmChanges.push(
      `RM item — → ${rmItemNote(codes, rawMaterial.rawMaterialItemId, rawMaterial.rmQtyPerPiece)}`,
    );
    rmPatch.rawMaterialItemId = rawMaterial.rawMaterialItemId;
    rmPatch.rmQtyPerPiece = rawMaterial.rmQtyPerPiece;
    rmBlankGuards.push(isNull(routeCards.rawMaterialItemId));
    rmBlankGuards.push(isNull(routeCards.rmQtyPerPiece));
  }
  let rmFilled = false;
  if (rmChanges.length > 0 && (await canWriteCard())) {
    const updated = await tx
      .update(routeCards)
      .set({ ...rmPatch, updatedBy: user.id, updatedAt: new Date() })
      .where(and(eq(routeCards.id, card.id), eq(routeCards.companyId, companyId), ...rmBlankGuards))
      .returning({ id: routeCards.id });
    rmFilled = updated.length > 0;
  }
  // What was ACTUALLY written. A zero-row UPDATE (someone filled the same
  // half first) must not be reported as a change, must not bump the revision
  // and must not appear in History.
  const rmWritten: Partial<ResolvedRawMaterial> = rmFilled ? rmPatch : {};

  const replaced = await replaceRouteCardOps(
    tx,
    {
      routeCardId: card.id,
      companyId,
      currentRevision: card.currentRevision,
      ops,
      machinesLookup,
      vendorsLookup,
      notePrefix: `Updated from ${sourceCode}`,
      headerNote: rmFilled ? rmChanges.join(', ') : null,
      // Filling a blank half IS a change, so it earns a revision even when
      // the operations came back identical. But ONLY a half that was really
      // written: if nothing was filled and the ops are identical, the card is
      // left completely alone — no revision bump, no revision-log row (the
      // owner's complaint was a Rev that moved for nothing).
      skipWhenUnchanged: !rmFilled,
      // The source document has no remarks; keep the card's own (0195).
      preserveRemarks: true,
    },
    user,
  );
  if (replaced.changed) {
    // ADR-197 — the auto-save is a revision like any other: header row with
    // the raw-material moves + the Route Card Rev bump, then the op rows.
    // Only the halves actually written are named, so a value this save
    // DECLINED to overwrite never shows up as a change (it was not one).
    const rmCodes =
      rmWritten.rawMaterialItemId !== undefined
        ? await rmItemCodes(tx, companyId, [card.rawMaterialItemId, rmWritten.rawMaterialItemId])
        : new Map<string, string>();
    const rmCode = (rid: string | null): string | null => (rid ? (rmCodes.get(rid) ?? null) : null);
    const beforeView: RcHeaderView = {
      rawMaterialGradeText: card.rawMaterialGradeText,
      rawMaterialSizeText: card.rawMaterialSizeText,
      rawMaterialItemCode: rmCode(card.rawMaterialItemId),
      rmQtyPerPiece: card.rmQtyPerPiece,
    };
    const afterView: RcHeaderView = {};
    if (rmWritten.rawMaterialGradeText !== undefined) {
      afterView.rawMaterialGradeText = rmWritten.rawMaterialGradeText;
    }
    if (rmWritten.rawMaterialSizeText !== undefined) {
      afterView.rawMaterialSizeText = rmWritten.rawMaterialSizeText;
    }
    if (rmWritten.rawMaterialItemId !== undefined) {
      afterView.rawMaterialItemCode = rmCode(rmWritten.rawMaterialItemId);
      afterView.rmQtyPerPiece = rmWritten.rmQtyPerPiece ?? null;
    }
    await logRouteCardRevision(
      tx,
      companyId,
      user,
      { id: card.id, code: card.code },
      [
        ...diffFields(beforeView, afterView, RC_HEADER_FIELDS),
        revChange(card.currentRevision, replaced.newRevision),
      ],
      routeCardOpLogRows(replaced.oldOps, replaced.newOps),
      `${card.code} updated from ${sourceCode}`,
    );
  }
  return replaced.changed
    ? {
        routeCardId: card.id,
        routeCardCode: card.code,
        routeCardRevision: replaced.newRevision,
        created: false,
      }
    : null;
}

/** Write the item's route card from a source document's operations — the write
 *  half of legacy `saveRouteCardForItem` (legacy L6918) that ADR-051 left as a
 *  follow-up. Callers: job-cards create/edit and plans execute.
 *
 *  Runs inside the CALLER'S transaction on purpose: the route card must be
 *  atomic with the Job Card, so a failure rolls both back instead of leaving a
 *  Job Card beside a half-written route card.
 *
 *  Behaviour (legacy parity):
 *    - nothing to save (empty after stripping the auto QC op) → no-op
 *    - no active card for the item → create at revision 0 + a revision snapshot
 *      noted "Created from <source code>", WITH the material it was given. A
 *      hand-raised job-work Job Card for an item that has no card is how that
 *      card is born, so this branch still writes material in full.
 *    - active card exists, routing DIFFERS, edit-approval gate ON (ADR-249
 *      Step B2) → the card is NOT rewritten: the change is staged as a Route
 *      Card edit request (stageRoutingFromSourceDoc) and a write-back with
 *      `sentForApproval: true` at the card's CURRENT Rev is returned; if it
 *      cannot be staged (one already waiting, nothing to approve) the routing
 *      is kept as stored, only the blank-RM fill below may still run, and the
 *      write-back carries `notSentReason` so the screen says why.
 *      Either way the caller's save goes on.
 *    - active card exists (gate off) → replace its ops, bump the revision, snapshot noted
 *      with the source code. One active card per item per company, matching the
 *      `route_cards_company_item_uniq` partial unique index — never a second card.
 *    - stored ops already identical AND no blank material filled → left
 *      completely untouched: no revision bump, no revision-log row, no History
 *      row, so repeatedly executing the same routing does not inflate the
 *      revision history.
 *
 *  RAW MATERIAL IS FILL-BLANKS-ONLY ON AN EXISTING CARD (ADR-218) — see the
 *  long comment at the use site below. The card is the ONE author of what a
 *  part is cut from; this function is called BY documents downstream of it, so
 *  on an existing card it may only fill a half that is blank and may never
 *  replace a filled one.
 *
 *  PERMISSIONS (ADR-218) — read this precisely, it guards ONE thing. The
 *  RAW-MATERIAL FILL asks for `routecard_create` edit, and only that. The
 *  routing rewrite and the no-card CREATE branch are deliberately NOT gated:
 *  both have always been allowed to anyone who could save the calling document,
 *  and refusing them here would roll that document back — Route Card is
 *  view-only for several production users today, so it would stop shop-floor
 *  work that has never needed the right. The check is also the NON-THROWING
 *  helper: no right means the material fill is skipped and the caller's own
 *  save still succeeds. Tightening the routing rewrite is a separate decision
 *  with its own blast radius. All three callers hand us the real AuthContext. */
export async function saveRouteCardForItem(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
  ops: CreateRouteCardOpInput[],
  user: AuthContext,
  /** Code of the document this routing came from (JC code or plan code) — goes
   *  into the revision note so history says where the change came from. */
  sourceCode: string,
  /** The grade + size the source document was planned against. Required, not
   *  optional: there are only three callers and each one has this to hand, and
   *  an optional argument is exactly how it went missing in the first place. */
  rawMaterial: ResolvedRawMaterial,
): Promise<JcRouteCardWriteBack | null> {
  // Returns what was written (null = the card was not touched) so the saving
  // screen can tell the user "Route Card IN-RC-… updated to Rev n" instead of
  // changing the item's standard routing silently (2026-09-28 form audit).
  const cleanOps = stripAutoTerminalQcOp(ops);
  if (cleanOps.length === 0) return null;

  // ADR-218 — the permission check this path never had. Asked at most once per
  // save, and only when a write is actually about to happen (see the
  // PERMISSIONS note in the doc comment above). Same form key and tier as
  // updateRouteCard, but the NON-THROWING helper on purpose: this runs as a
  // side effect of saving a Job Card or executing a plan, and refusing here
  // would roll back that document over a Route Card right the operator never
  // needed before (owner decision 2026-10-06 — Route Card is view-only for
  // several production users today). No right = the card is left alone and the
  // caller's own save still succeeds.
  let editGate: boolean | null = null;
  const canWriteCard = async (): Promise<boolean> => {
    if (editGate === null) editGate = await hasFormAccess(user, 'routecard_create', 'edit');
    return editGate;
  };

  const existing = await tx
    .select({
      id: routeCards.id,
      code: routeCards.code,
      currentRevision: routeCards.currentRevision,
      rawMaterialGradeId: routeCards.rawMaterialGradeId,
      rawMaterialGradeText: routeCards.rawMaterialGradeText,
      rawMaterialSizeId: routeCards.rawMaterialSizeId,
      rawMaterialSizeText: routeCards.rawMaterialSizeText,
      rawMaterialItemId: routeCards.rawMaterialItemId,
      rmQtyPerPiece: routeCards.rmQtyPerPiece,
      notes: routeCards.notes,
      planType: routeCards.planType,
    })
    .from(routeCards)
    .where(
      and(
        eq(routeCards.companyId, companyId),
        eq(routeCards.itemId, itemId),
        isNull(routeCards.deletedAt),
      ),
    )
    .limit(1);

  const card = existing[0];
  if (card) {
    // ADR-249 Step B2 — the auto-save no longer rewrites a live card's
    // routing behind the planner's back. When the routing this document
    // brings DIFFERS from the stored one and the company's edit-approval gate
    // is on, the change is STAGED as a Route Card edit for approval and the
    // card is left as it is; the Job Card / plan still saves. Gate off (or the
    // card not live) → the direct rewrite below runs exactly as before. An
    // unchanged routing never reaches the engine: it takes the path below,
    // which may only fill blank raw material (ADR-218) and otherwise does
    // nothing.
    const storedOps = await tx
      .select()
      .from(routeCardOps)
      .where(
        and(
          eq(routeCardOps.routeCardId, card.id),
          eq(routeCardOps.companyId, companyId),
          isNull(routeCardOps.deletedAt),
        ),
      )
      .orderBy(asc(routeCardOps.opSeq));
    const staging = opsAreIdentical(
      storedOps.map(comparableFromRow),
      cleanOps.map(comparableFromInput),
    )
      ? 'direct'
      : await stageRoutingFromSourceDoc(
          tx,
          companyId,
          itemId,
          card,
          storedOps,
          cleanOps,
          rawMaterial,
          user,
          sourceCode,
          canWriteCard,
        );
    if (staging === 'staged') {
      // The card is unchanged (still at its current Rev); the saving screen
      // says the routing change went for approval (sentForApproval).
      return {
        routeCardId: card.id,
        routeCardCode: card.code,
        routeCardRevision: card.currentRevision,
        created: false,
        sentForApproval: true,
      };
    }
    // The direct rewrite — the gate is off, the routing is unchanged, or the
    // change could not be staged. When it could not, the STORED routing is
    // resubmitted, so only a blank raw-material half can still be filled
    // (ADR-218) — the routing itself is never rewritten behind the approval.
    const notSent = staging === 'direct' ? null : staging.notSentReason;
    const written = await overwriteRouteCardFromSource(
      tx,
      companyId,
      card,
      notSent ? storedOps.map(opInputFromRow) : cleanOps,
      rawMaterial,
      user,
      sourceCode,
      canWriteCard,
    );
    if (!notSent) return written;
    // Not silent: the screen says why this routing did not go for approval,
    // beside whatever the raw-material fill did write.
    return {
      ...(written ?? {
        routeCardId: card.id,
        routeCardCode: card.code,
        routeCardRevision: card.currentRevision,
        created: false,
      }),
      notSentReason: notSent,
    };
  }

  const machinesLookup = await loadMachinesByIds(
    tx,
    cleanOps.map((o) => o.machineId).filter((x): x is string => Boolean(x)),
    companyId,
  );
  const vendorsLookup = await loadVendorsByIds(
    tx,
    cleanOps.map((o) => o.ospVendorId).filter((x): x is string => Boolean(x)),
    companyId,
  );

  // The item has NO card: this is the card being born, so the material it was
  // given goes on in full (a hand-raised job-work Job Card for an item with no
  // card is exactly how that happens). Nothing is overwritten here — there is
  // nothing to overwrite, so ADR-218's rule has no surface and this branch is
  // left exactly as it has always behaved, ungated: gating it would stop a
  // job-work Job Card for a brand-new item.
  const code = await nextRouteCardCode(tx, companyId);
  const inserted = await tx
    .insert(routeCards)
    .values({
      companyId,
      code,
      itemId,
      currentRevision: 0,
      ...rawMaterial,
      notes: null,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning({ id: routeCards.id });
  const header = inserted[0]!;

  await tx.insert(routeCardOps).values(assignOpValues(cleanOps, header.id, companyId, user.id));

  await tx.insert(routeCardRevisions).values({
    companyId,
    routeCardId: header.id,
    revisionNo: 0,
    notes: `Created from ${sourceCode}`,
    opsSnapshot: buildOpsSnapshot(cleanOps, machinesLookup, vendorsLookup),
    createdBy: user.id,
  });
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Create,
      entity: 'RouteCard',
      entityId: header.id,
      refId: code,
      detail: `${code} created from ${sourceCode}`,
    },
    companyId,
    user,
  );
  return { routeCardId: header.id, routeCardCode: code, routeCardRevision: 0, created: true };
}
