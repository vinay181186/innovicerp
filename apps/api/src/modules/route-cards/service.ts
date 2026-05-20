// Route Card service (RC-3). Ports legacy renderRouteCards /
// saveRouteCardForItem / editRouteCard / delRouteCard
// (legacy/InnovicERP_v82_12_3.html L10078, L6918, L10169).
//
// Architectural notes:
//
// 1. Revision lifecycle. createRouteCard writes current_revision=1 +
//    a matching route_card_revisions row with the initial ops as the
//    snapshot. updateRouteCard bumps current_revision by 1, snapshots
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
// 4. Audit emission. CREATE / EDIT / DELETE rows land in activity_log
//    with entity='Route Card' so the activity-log viewer can filter
//    for route-card changes (legacy L7004 / L10275).

import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  items,
  machines,
  routeCardOps,
  routeCardRevisions,
  routeCards,
  vendors,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
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
  if (!r) throw new ValidationError(`Item id "${id}" not found`);
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
    throw new ValidationError(`Machine id(s) not found: ${missing.join(', ')}`);
  }
  return lookup;
}

async function assertVendorIdsExist(
  tx: DbTransaction,
  ids: string[],
  companyId: string,
): Promise<VendorsLookup> {
  const lookup = await loadVendorsByIds(tx, ids, companyId);
  const unique = Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  if (lookup.byId.size !== unique.length) {
    const missing = unique.filter((id) => !lookup.byId.has(id));
    throw new ValidationError(`Vendor id(s) not found: ${missing.join(', ')}`);
  }
  return lookup;
}

// Generate next IN-RC-NNNNN per company. Mirrors legacy _nextRcNo
// helper (L6933-6934) — finds the highest numeric suffix used so far
// and adds 1, zero-padded to 5 digits.
async function nextRouteCardCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT code FROM public.route_cards
    WHERE company_id = ${companyId}::uuid
      AND deleted_at IS NULL
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

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listRouteCards(
  input: ListRouteCardsQuery,
  user: AuthContext,
): Promise<ListRouteCardsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (rc.code ILIKE ${term} OR i.code ILIKE ${term} OR i.name ILIKE ${term})`
      : sql``;
    const itemFrag = input.itemId ? sql`AND rc.item_id = ${input.itemId}::uuid` : sql``;

    const result = await tx.execute(sql`
      SELECT
        rc.id, rc.company_id AS "companyId", rc.code, rc.item_id AS "itemId",
        rc.current_revision AS "currentRevision", rc.notes,
        rc.created_at AS "createdAt", rc.created_by AS "createdBy",
        rc.updated_at AS "updatedAt", rc.updated_by AS "updatedBy",
        rc.deleted_at AS "deletedAt",
        i.code AS "itemCode", i.name AS "itemName",
        COALESCE(op_agg.op_count, 0)::int AS "opCount"
      FROM public.route_cards rc
      LEFT JOIN public.items i ON i.id = rc.item_id AND i.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS op_count
        FROM public.route_card_ops o
        WHERE o.route_card_id = rc.id AND o.deleted_at IS NULL
      ) op_agg ON TRUE
      WHERE rc.company_id = ${companyId}::uuid
        AND rc.deleted_at IS NULL
        ${searchFrag}
        ${itemFrag}
      ORDER BY rc.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [eq(routeCards.companyId, companyId), isNull(routeCards.deletedAt)];
    if (input.itemId) conditions.push(eq(routeCards.itemId, input.itemId));
    const totalRows = await tx
      .select({ value: count() })
      .from(routeCards)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

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
    notes: (r['notes'] as string | null) ?? null,
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
  if (!header) throw new NotFoundError(`Route card ${id} not found`);

  // Item display
  const itemRows = await tx
    .select({ code: items.code, name: items.name })
    .from(items)
    .where(and(eq(items.id, header.itemId), isNull(items.deletedAt)))
    .limit(1);
  const item = itemRows[0] ?? null;

  // Ops with joined machine + vendor display.
  const opRows = await tx
    .select({
      op: routeCardOps,
      machineCode: machines.code,
      machineName: machines.name,
      ospVendorCode: vendors.code,
      ospVendorName: vendors.name,
    })
    .from(routeCardOps)
    .leftJoin(machines, eq(machines.id, routeCardOps.machineId))
    .leftJoin(vendors, eq(vendors.id, routeCardOps.ospVendorId))
    .where(
      and(
        eq(routeCardOps.routeCardId, id),
        eq(routeCardOps.companyId, companyId),
        isNull(routeCardOps.deletedAt),
      ),
    )
    .orderBy(asc(routeCardOps.opSeq));

  const revisionRows = await tx
    .select()
    .from(routeCardRevisions)
    .where(and(eq(routeCardRevisions.routeCardId, id), eq(routeCardRevisions.companyId, companyId)))
    .orderBy(desc(routeCardRevisions.revisionNo));

  return {
    id: header.id,
    companyId: header.companyId,
    code: header.code,
    itemId: header.itemId,
    currentRevision: header.currentRevision,
    notes: header.notes,
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
        ospVendorCode: r.ospVendorCode,
        ospVendorName: r.ospVendorName,
      }),
    ),
    revisions: revisionRows.map(
      (r): RouteCardRevision => ({
        id: r.id,
        companyId: r.companyId,
        routeCardId: r.routeCardId,
        revisionNo: r.revisionNo,
        notes: r.notes,
        opsSnapshot: r.opsSnapshot as RouteCardRevision['opsSnapshot'],
        createdAt: tsLike(r.createdAt),
        createdBy: r.createdBy,
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
    const label = `${seq}. ${no.operation || '(unnamed)'}`;
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
    if (parts.length > 0) changed.push(`${label} (${parts.join(', ')})`);
  }
  for (const [seq, oo] of oldBySeq) {
    if (!newBySeq.has(seq)) {
      removed.push(`${seq}. ${oo.operation || '(unnamed)'}`);
    }
  }

  const segs: string[] = [];
  if (added.length > 0) segs.push(`Added: ${added.join(', ')}`);
  if (removed.length > 0) segs.push(`Removed: ${removed.join(', ')}`);
  if (changed.length > 0) segs.push(`Changed: ${changed.join(', ')}`);
  return segs.length > 0 ? segs.join(' · ') : 'No op changes';
}

// ─── Writes ───────────────────────────────────────────────────────────────

function rcDetailString(code: string, itemCode: string | null): string {
  return itemCode ? `${code} (${itemCode})` : code;
}

export async function createRouteCard(
  input: CreateRouteCardInput,
  user: AuthContext,
): Promise<RouteCardDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // Validate item + capture display label for activity log.
    const item = await assertItemExists(tx, input.itemId, companyId);

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
        `An active route card already exists for ${item.code} (${existing[0]!.code}). Edit that one to add a revision.`,
      );
    }

    // Auto code when not supplied; reject if supplied + already used.
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
      if (dup.length > 0) throw new ConflictError(`Route card code "${code}" already exists`);
    }

    const inserted = await tx
      .insert(routeCards)
      .values({
        companyId,
        code,
        itemId: input.itemId,
        currentRevision: 1,
        notes: input.notes ?? null,
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
      revisionNo: 1,
      notes: 'Initial creation',
      opsSnapshot: snapshot,
      createdBy: user.id,
    });

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'Route Card',
        detail: rcDetailString(header.code, item.code),
        refId: header.code,
      },
      companyId,
      user,
    );

    return loadRouteCardDetail(tx, header.id, companyId);
  });
}

export async function updateRouteCard(
  id: string,
  input: UpdateRouteCardInput,
  user: AuthContext,
): Promise<RouteCardDetail> {
  requireWriteRole(user);
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
    if (!header) throw new NotFoundError(`Route card ${id} not found`);

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
          `Another route card already covers ${item.code} (${other[0]!.code}).`,
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
      if (dup.length > 0) throw new ConflictError(`Route card code "${input.code}" already exists`);
    }

    // Validate ops references.
    const machineIds = input.ops.map((o) => o.machineId).filter((x): x is string => Boolean(x));
    const vendorIds = input.ops.map((o) => o.ospVendorId).filter((x): x is string => Boolean(x));
    const machinesLookup = await assertMachineIdsExist(tx, machineIds, companyId);
    const vendorsLookup = await assertVendorIdsExist(tx, vendorIds, companyId);

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
      .where(and(eq(routeCardOps.routeCardId, id), isNull(routeCardOps.deletedAt)));
    const oldSnapshot: DiffOp[] = oldOpRows.map((r) => ({
      opSeq: r.op.opSeq,
      machineCode: r.machineCode ?? r.op.machineCodeText ?? null,
      operation: r.op.operation,
      opType: r.op.opType,
      cycleTimeMin: r.op.cycleTimeMin,
      ospVendorCode: r.ospVendorCode ?? r.op.ospVendorCodeText ?? null,
      ospLeadDays: r.op.ospLeadDays,
    }));

    const newSnapshot: DiffOp[] = input.ops.map((o, i) => ({
      opSeq: i + 1,
      machineCode:
        (o.machineId ? machinesLookup.byId.get(o.machineId)?.code : null) ??
        o.machineCodeText ??
        null,
      operation: o.operation,
      opType: o.opType,
      cycleTimeMin: o.cycleTimeMin.toFixed(2),
      ospVendorCode:
        (o.ospVendorId ? vendorsLookup.byId.get(o.ospVendorId)?.code : null) ??
        o.ospVendorCodeText ??
        null,
      ospLeadDays: o.ospLeadDays ?? null,
    }));

    const autoNote = computeRouteCardDiffNote(oldSnapshot, newSnapshot);
    const finalNote = input.revisionNote?.trim() || autoNote;

    // Hard-delete old op rows (pre-state is captured in the snapshot).
    await tx.delete(routeCardOps).where(eq(routeCardOps.routeCardId, id));

    const newRevision = header.currentRevision + 1;

    await tx
      .update(routeCards)
      .set({
        code: input.code,
        itemId: input.itemId,
        notes: input.notes ?? null,
        currentRevision: newRevision,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(routeCards.id, id));

    const opValues = assignOpValues(input.ops, id, companyId, user.id);
    await tx.insert(routeCardOps).values(opValues);

    await tx.insert(routeCardRevisions).values({
      companyId,
      routeCardId: id,
      revisionNo: newRevision,
      notes: finalNote,
      opsSnapshot: buildOpsSnapshot(input.ops, machinesLookup, vendorsLookup),
      createdBy: user.id,
    });

    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'Route Card',
        detail: `${rcDetailString(input.code, item.code)} (Rev ${header.currentRevision} → ${newRevision})`,
        refId: input.code,
      },
      companyId,
      user,
    );

    return loadRouteCardDetail(tx, id, companyId);
  });
}

export async function softDeleteRouteCard(id: string, user: AuthContext): Promise<RouteCard> {
  if (user.role !== 'admin') {
    throw new AuthorizationError(`Role "${user.role}" cannot delete route cards — admin required`);
  }
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
    if (!header) throw new NotFoundError(`Route card ${id} not found`);

    // Look up the item for the activity-log label only; downstream
    // JC creation uses route_card_ops snapshots, so no link block.
    const itemRows = await tx
      .select({ code: items.code })
      .from(items)
      .where(and(eq(items.id, header.itemId), isNull(items.deletedAt)))
      .limit(1);
    const itemCode = itemRows[0]?.code ?? null;

    await tx
      .update(routeCards)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(routeCards.id, id));

    await emitActivityLog(
      tx,
      {
        action: 'DELETE',
        entity: 'Route Card',
        detail: rcDetailString(header.code, itemCode),
        refId: header.code,
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
      notes: header.notes,
      createdAt: tsLike(header.createdAt),
      createdBy: header.createdBy,
      updatedAt: tsLike(header.updatedAt),
      updatedBy: header.updatedBy,
      deletedAt: new Date().toISOString(),
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

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
    ospVendorCode:
      (o.ospVendorId ? vendorsLookup.byId.get(o.ospVendorId)?.code : null) ??
      o.ospVendorCodeText ??
      null,
    ospLeadDays: o.ospLeadDays ?? null,
  }));
}
