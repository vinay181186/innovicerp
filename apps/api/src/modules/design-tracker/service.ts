// Design Tracker service (Design slice B).
//
// Per-SO design assignment with revision tracking. Mirrors legacy
// renderDesignTracker + helpers (HTML L7259–7489). Numbering: DSN-NNNN.
//
// Status machine (legacy verbatim):
//   In Progress → Review (via submitReview)
//   Review      → Approved (admin only)
//               → Revision (admin only; increments revision counter)
//   Revision    → In Progress (via update setting status back)
//   Approved is terminal except via _dsnRevise which counts up

import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreateDesignTrackerInput,
  DesignTimeLogEntry,
  DesignTracker,
  DesignTrackerDetailResponse,
  DesignTrackerListItem,
  ListDesignTrackerQuery,
  ListDesignTrackerResponse,
  LogDesignTimeInput,
  ReviseDesignInput,
  UpdateDesignTrackerInput,
} from '@innovic/shared';
import {
  designTimeLog,
  designTracker,
  salesOrders,
  salesOrderLines,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';

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

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return Number(v) || 0;
}

const CODE_PREFIX = 'DSN-';
const CODE_PAD = 4;

async function nextDesignCode(
  tx: Parameters<Parameters<typeof withUserContext>[1]>[0],
  companyId: string,
): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(
      MAX(NULLIF(regexp_replace(code, '^${sql.raw(CODE_PREFIX)}', ''), '')::int),
      0
    ) + 1 AS next_num
    FROM public.design_tracker
    WHERE company_id = ${companyId}::uuid
      AND code LIKE ${`${CODE_PREFIX}%`}
      AND code ~ ${`^${CODE_PREFIX}\\d+$`}
  `)) as unknown as Array<{ next_num: number }>;
  const next = Number(rows[0]?.next_num ?? 1);
  return `${CODE_PREFIX}${String(next).padStart(CODE_PAD, '0')}`;
}

export async function listDesignTracker(
  input: ListDesignTrackerQuery,
  user: AuthContext,
): Promise<ListDesignTrackerResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const today = new Date().toISOString().slice(0, 10);
    const searchFrag = term
      ? sql`AND (
          dt.code ILIKE ${term}
          OR dt.so_code_text ILIKE ${term}
          OR dt.item_code_text ILIKE ${term}
          OR dt.designer ILIKE ${term}
        )`
      : sql``;

    let filterFrag = sql``;
    if (input.filter === 'pending') filterFrag = sql`AND dt.status = 'Pending'`;
    else if (input.filter === 'progress') filterFrag = sql`AND dt.status = 'In Progress'`;
    else if (input.filter === 'review') filterFrag = sql`AND dt.status = 'Review'`;
    else if (input.filter === 'approved') filterFrag = sql`AND dt.status = 'Approved'`;
    else if (input.filter === 'overdue')
      filterFrag = sql`AND dt.target_date < ${today}::date AND dt.status <> 'Approved'`;
    else if (input.status) filterFrag = sql`AND dt.status = ${input.status}`;

    const result = await tx.execute(sql`
      SELECT
        dt.id, dt.company_id AS "companyId", dt.code,
        dt.sales_order_id AS "salesOrderId",
        dt.so_code_text AS "soCodeText",
        dt.item_id AS "itemId",
        dt.item_code_text AS "itemCodeText",
        dt.item_name_text AS "itemNameText",
        dt.designer,
        dt.estimated_hours AS "estimatedHours",
        dt.start_date AS "startDate",
        dt.target_date AS "targetDate",
        dt.status,
        dt.revision,
        dt.remarks,
        dt.approved_at AS "approvedAt",
        dt.approved_by_text AS "approvedByText",
        dt.review_submitted_at AS "reviewSubmittedAt",
        dt.revision_history AS "revisionHistory",
        dt.created_at AS "createdAt", dt.created_by AS "createdBy",
        dt.updated_at AS "updatedAt", dt.updated_by AS "updatedBy",
        dt.deleted_at AS "deletedAt",
        COALESCE(tl.total_hours, 0)::float AS "totalHours"
      FROM public.design_tracker dt
      LEFT JOIN LATERAL (
        SELECT SUM(hours)::numeric AS total_hours
        FROM public.design_time_log
        WHERE design_tracker_id = dt.id AND deleted_at IS NULL
      ) tl ON true
      WHERE dt.company_id = ${companyId}::uuid
        AND dt.deleted_at IS NULL
        ${searchFrag}
        ${filterFrag}
      ORDER BY dt.created_at DESC, dt.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [eq(designTracker.companyId, companyId), isNull(designTracker.deletedAt)];
    const totalRows = await tx
      .select({ value: count() })
      .from(designTracker)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    // Summary across all non-deleted designs for this company
    const sumRows = (await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'Pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'In Progress')::int AS in_progress,
        COUNT(*) FILTER (WHERE status = 'Review')::int AS review,
        COUNT(*) FILTER (WHERE status = 'Approved')::int AS approved,
        COUNT(*) FILTER (
          WHERE target_date < ${today}::date AND status <> 'Approved'
        )::int AS overdue
      FROM public.design_tracker
      WHERE company_id = ${companyId}::uuid
        AND deleted_at IS NULL
    `)) as unknown as Array<Record<string, unknown>>;
    const sum = sumRows[0] ?? {};

    const itemsOut = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return {
      items: itemsOut,
      total,
      limit: input.limit,
      offset: input.offset,
      summary: {
        total: Number(sum['total'] ?? 0),
        pending: Number(sum['pending'] ?? 0),
        inProgress: Number(sum['in_progress'] ?? 0),
        review: Number(sum['review'] ?? 0),
        approved: Number(sum['approved'] ?? 0),
        overdue: Number(sum['overdue'] ?? 0),
      },
    };
  });
}

function toListItem(r: Record<string, unknown>): DesignTrackerListItem {
  const rh = r['revisionHistory'];
  const revisionHistory = Array.isArray(rh)
    ? (rh as Array<{ rev: number; date: string; reason: string; by: string }>)
    : [];
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    salesOrderId: (r['salesOrderId'] as string | null) ?? null,
    soCodeText: (r['soCodeText'] as string | null) ?? null,
    itemId: (r['itemId'] as string | null) ?? null,
    itemCodeText: (r['itemCodeText'] as string | null) ?? null,
    itemNameText: (r['itemNameText'] as string | null) ?? null,
    designer: String(r['designer'] ?? ''),
    estimatedHours: num(r['estimatedHours']),
    startDate: dateLike(r['startDate']),
    targetDate: dateLike(r['targetDate']),
    status: (r['status'] as DesignTracker['status']) ?? 'In Progress',
    revision: Number(r['revision'] ?? 0),
    remarks: (r['remarks'] as string | null) ?? null,
    approvedAt: r['approvedAt'] != null ? tsLike(r['approvedAt']) : null,
    approvedByText: (r['approvedByText'] as string | null) ?? null,
    reviewSubmittedAt:
      r['reviewSubmittedAt'] != null ? tsLike(r['reviewSubmittedAt']) : null,
    revisionHistory,
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: r['deletedAt'] != null ? tsLike(r['deletedAt']) : null,
    totalHours: num(r['totalHours']),
  };
}

export async function getDesignTrackerDetail(
  id: string,
  user: AuthContext,
): Promise<DesignTrackerDetailResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(designTracker)
      .where(
        and(
          eq(designTracker.id, id),
          eq(designTracker.companyId, companyId),
          isNull(designTracker.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError(`Design ${id} not found`);

    const logs = await tx
      .select()
      .from(designTimeLog)
      .where(and(eq(designTimeLog.designTrackerId, id), isNull(designTimeLog.deletedAt)))
      .orderBy(sql`${designTimeLog.logDate} DESC`);

    const timeLog: DesignTimeLogEntry[] = logs.map((l) => ({
      id: l.id,
      designTrackerId: l.designTrackerId,
      logDate: dateLike(l.logDate),
      hours: num(l.hours),
      workerText: l.workerText,
      description: l.description,
      createdAt: tsLike(l.createdAt),
    }));
    const totalHours = timeLog.reduce((s, t) => s + t.hours, 0);

    return {
      tracker: rowToTracker(row),
      timeLog,
      totalHours,
    };
  });
}

function rowToTracker(row: typeof designTracker.$inferSelect): DesignTracker {
  const rh = row.revisionHistory as unknown;
  const revisionHistory = Array.isArray(rh)
    ? (rh as Array<{ rev: number; date: string; reason: string; by: string }>)
    : [];
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    salesOrderId: row.salesOrderId,
    soCodeText: row.soCodeText,
    itemId: row.itemId,
    itemCodeText: row.itemCodeText,
    itemNameText: row.itemNameText,
    designer: row.designer,
    estimatedHours: num(row.estimatedHours),
    startDate: dateLike(row.startDate),
    targetDate: dateLike(row.targetDate),
    status: row.status as DesignTracker['status'],
    revision: row.revision,
    remarks: row.remarks,
    approvedAt: row.approvedAt != null ? tsLike(row.approvedAt) : null,
    approvedByText: row.approvedByText,
    reviewSubmittedAt: row.reviewSubmittedAt != null ? tsLike(row.reviewSubmittedAt) : null,
    revisionHistory,
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt != null ? tsLike(row.deletedAt) : null,
  };
}

export async function createDesignTracker(
  input: CreateDesignTrackerInput,
  user: AuthContext,
): Promise<DesignTracker> {
  const companyId = requireCompany(user);
  const userId = user.id;

  return withUserContext(user, async (tx) => {
    // SO must exist + first-line item snapshot for the "Item" column
    const soRows = await tx
      .select({
        id: salesOrders.id,
        code: salesOrders.code,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, input.salesOrderId),
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
        ),
      )
      .limit(1);
    const so = soRows[0];
    if (!so) throw new NotFoundError(`Sales Order ${input.salesOrderId} not found`);

    // Reject if an existing (non-deleted) design already targets this SO
    const dup = await tx
      .select({ id: designTracker.id })
      .from(designTracker)
      .where(
        and(
          eq(designTracker.companyId, companyId),
          eq(designTracker.salesOrderId, so.id),
          isNull(designTracker.deletedAt),
        ),
      )
      .limit(1);
    if (dup[0]) {
      throw new ConflictError(`A design is already assigned to ${so.code}`);
    }

    // Best-effort item snapshot from first SO line
    const lineRows = await tx
      .select({
        itemId: salesOrderLines.itemId,
        itemCodeText: salesOrderLines.itemCodeText,
        partName: salesOrderLines.partName,
      })
      .from(salesOrderLines)
      .where(
        and(
          eq(salesOrderLines.salesOrderId, so.id),
          isNull(salesOrderLines.deletedAt),
        ),
      )
      .orderBy(salesOrderLines.lineNo)
      .limit(1);
    const firstLine = lineRows[0];

    const code = await nextDesignCode(tx, companyId);
    const inserted = await tx
      .insert(designTracker)
      .values({
        companyId,
        code,
        salesOrderId: so.id,
        soCodeText: so.code,
        itemId: firstLine?.itemId ?? null,
        itemCodeText: firstLine?.itemCodeText ?? null,
        itemNameText: firstLine?.partName ?? null,
        designer: input.designer,
        estimatedHours: String(input.estimatedHours ?? 0),
        startDate: input.startDate,
        targetDate: input.targetDate,
        status: 'In Progress',
        revision: 0,
        remarks: input.remarks ?? null,
        revisionHistory: [],
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new ValidationError('Failed to insert design');
    return rowToTracker(row);
  });
}

export async function updateDesignTracker(
  id: string,
  input: UpdateDesignTrackerInput,
  user: AuthContext,
): Promise<DesignTracker> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(designTracker)
      .where(
        and(
          eq(designTracker.id, id),
          eq(designTracker.companyId, companyId),
          isNull(designTracker.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundError(`Design ${id} not found`);

    const patch: Partial<typeof designTracker.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: userId,
    };
    if (input.designer !== undefined) patch.designer = input.designer;
    if (input.status !== undefined) patch.status = input.status;
    if (input.estimatedHours !== undefined) patch.estimatedHours = String(input.estimatedHours);
    if (input.targetDate !== undefined) patch.targetDate = input.targetDate;
    if (input.remarks !== undefined) patch.remarks = input.remarks;

    const updated = await tx
      .update(designTracker)
      .set(patch)
      .where(eq(designTracker.id, existing.id))
      .returning();
    const row = updated[0];
    if (!row) throw new ValidationError('Failed to update design');
    return rowToTracker(row);
  });
}

export async function logDesignTime(
  designTrackerId: string,
  input: LogDesignTimeInput,
  user: AuthContext,
): Promise<DesignTimeLogEntry> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({ id: designTracker.id })
      .from(designTracker)
      .where(
        and(
          eq(designTracker.id, designTrackerId),
          eq(designTracker.companyId, companyId),
          isNull(designTracker.deletedAt),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundError(`Design ${designTrackerId} not found`);

    const inserted = await tx
      .insert(designTimeLog)
      .values({
        companyId,
        designTrackerId,
        logDate: input.logDate,
        hours: String(input.hours),
        workerText: input.workerText,
        description: input.description ?? null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new ValidationError('Failed to log time');
    return {
      id: row.id,
      designTrackerId: row.designTrackerId,
      logDate: dateLike(row.logDate),
      hours: num(row.hours),
      workerText: row.workerText,
      description: row.description,
      createdAt: tsLike(row.createdAt),
    };
  });
}

export async function submitDesignForReview(
  id: string,
  user: AuthContext,
): Promise<DesignTracker> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(designTracker)
      .where(
        and(
          eq(designTracker.id, id),
          eq(designTracker.companyId, companyId),
          isNull(designTracker.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundError(`Design ${id} not found`);
    if (existing.status !== 'In Progress' && existing.status !== 'Revision') {
      throw new ConflictError(
        `Design ${existing.code} cannot be submitted: current status is ${existing.status}`,
      );
    }
    const updated = await tx
      .update(designTracker)
      .set({
        status: 'Review',
        reviewSubmittedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(designTracker.id, existing.id))
      .returning();
    return rowToTracker(updated[0]!);
  });
}

export async function approveDesign(id: string, user: AuthContext): Promise<DesignTracker> {
  if (user.role !== 'admin' && user.role !== 'manager') {
    throw new AuthorizationError('Only admin/manager can approve designs');
  }
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(designTracker)
      .where(
        and(
          eq(designTracker.id, id),
          eq(designTracker.companyId, companyId),
          isNull(designTracker.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundError(`Design ${id} not found`);
    if (existing.status !== 'Review') {
      throw new ConflictError(
        `Design ${existing.code} cannot be approved: must be in Review (currently ${existing.status})`,
      );
    }
    const updated = await tx
      .update(designTracker)
      .set({
        status: 'Approved',
        approvedAt: new Date(),
        approvedByText: user.email ?? user.id,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(designTracker.id, existing.id))
      .returning();
    return rowToTracker(updated[0]!);
  });
}

export async function reviseDesign(
  id: string,
  input: ReviseDesignInput,
  user: AuthContext,
): Promise<DesignTracker> {
  if (user.role !== 'admin' && user.role !== 'manager') {
    throw new AuthorizationError('Only admin/manager can send designs back for revision');
  }
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(designTracker)
      .where(
        and(
          eq(designTracker.id, id),
          eq(designTracker.companyId, companyId),
          isNull(designTracker.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundError(`Design ${id} not found`);
    if (existing.status !== 'Review') {
      throw new ConflictError(
        `Design ${existing.code} cannot be sent back: must be in Review (currently ${existing.status})`,
      );
    }
    const newRevision = existing.revision + 1;
    const existingHistory = Array.isArray(existing.revisionHistory)
      ? (existing.revisionHistory as Array<{
          rev: number;
          date: string;
          reason: string;
          by: string;
        }>)
      : [];
    const updatedHistory = [
      ...existingHistory,
      {
        rev: newRevision,
        date: new Date().toISOString().slice(0, 10),
        reason: input.reason,
        by: user.email ?? user.id,
      },
    ];
    const updated = await tx
      .update(designTracker)
      .set({
        status: 'Revision',
        revision: newRevision,
        revisionHistory: updatedHistory,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(designTracker.id, existing.id))
      .returning();
    return rowToTracker(updated[0]!);
  });
}

/** True if design for the SO is approved (used by BOM Master gate on Equipment SOs). */
export async function isDesignApprovedForSo(
  salesOrderId: string,
  user: AuthContext,
): Promise<boolean> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({ status: designTracker.status })
      .from(designTracker)
      .where(
        and(
          eq(designTracker.salesOrderId, salesOrderId),
          eq(designTracker.companyId, companyId),
          isNull(designTracker.deletedAt),
        ),
      )
      .limit(1);
    if (rows.length === 0) return true; // no design assigned → no gate
    return rows[0]!.status === 'Approved';
  });
}
