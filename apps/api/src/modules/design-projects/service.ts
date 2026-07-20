// Design Projects service (Design slice C).
//
// Manages the multi-table Design Engineering subsystem:
// projects + tasks + issues + DCR/DCN. Mirrors legacy renderDesignProjects
// (HTML L7570) + _dpRenderDetail (L7623) + all helper modals.
// Numbering: DP-NNNN / DCR-NNNN / DCN-NNNN.

import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type {
  AddDesignCommentInput,
  CreateDesignDcnInput,
  CreateDesignDcrInput,
  CreateDesignIssueInput,
  CreateDesignProjectInput,
  CreateDesignTaskInput,
  DesignDcn,
  DesignDcr,
  DesignDiscussion,
  DesignIssue,
  DesignProject,
  DesignProjectDetail,
  DesignProjectListItem,
  DesignTask,
  DocumentTraceability,
  RelatedDoc,
  ListDesignProjectsQuery,
  ListDesignProjectsResponse,
  ToggleDesignChecklistItemInput,
  UpdateDesignDcnInput,
  UpdateDesignDcrInput,
  UpdateDesignIssueInput,
  UpdateDesignProjectInput,
  UpdateDesignTaskInput,
} from '@innovic/shared';
import {
  clients,
  designDcns,
  designDcrs,
  designIssues,
  designProjects,
  designTasks,
  designWorkLog,
  salesOrders,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { buildTimeline, section, toIsoDate } from '../../lib/traceability';

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

async function nextSequence(
  tx: Parameters<Parameters<typeof withUserContext>[1]>[0],
  table: string,
  prefix: string,
  companyId: string,
): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(
      MAX(NULLIF(regexp_replace(code, '^' || ${prefix}, ''), '')::int),
      0
    ) + 1 AS next_num
    FROM public.${sql.raw(table)}
    WHERE company_id = ${companyId}::uuid
      AND code LIKE ${`${prefix}%`}
      AND code ~ ${`^${prefix}\\d+$`}
  `)) as unknown as Array<{ next_num: number }>;
  const next = Number(rows[0]?.next_num ?? 1);
  return `${prefix}${String(next).padStart(4, '0')}`;
}

export async function getNextDesignProjectCode(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({
    code: await nextSequence(tx, 'design_projects', 'DP-', companyId),
  }));
}

// ─── Projects — list ─────────────────────────────────────────────────────

export async function listDesignProjects(
  input: ListDesignProjectsQuery,
  user: AuthContext,
): Promise<ListDesignProjectsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (
          dp.code ILIKE ${term}
          OR dp.project_name ILIKE ${term}
          OR dp.so_code_text ILIKE ${term}
          OR dp.client_text ILIKE ${term}
        )`
      : sql``;
    let filterFrag = sql``;
    if (input.filter === 'active') filterFrag = sql`AND dp.status = 'Design Active'`;
    else if (input.filter === 'released') filterFrag = sql`AND dp.status = 'Released'`;
    else if (input.filter === 'hold') filterFrag = sql`AND dp.status = 'On Hold'`;

    const result = await tx.execute(sql`
      SELECT
        dp.id, dp.company_id AS "companyId", dp.code,
        dp.project_name AS "projectName",
        dp.sales_order_id AS "salesOrderId",
        dp.so_code_text AS "soCodeText",
        dp.client_id AS "clientId",
        dp.client_text AS "clientText",
        dp.lead_text AS "leadText",
        dp.engineers,
        dp.status,
        dp.start_date AS "startDate",
        dp.target_date AS "targetDate",
        dp.description,
        dp.checklist,
        dp.released_date AS "releasedDate",
        dp.released_by_text AS "releasedByText",
        dp.created_at AS "createdAt", dp.created_by AS "createdBy",
        dp.updated_at AS "updatedAt", dp.updated_by AS "updatedBy",
        dp.deleted_at AS "deletedAt",
        COALESCE(t.task_total, 0)::int AS "taskTotal",
        COALESCE(t.task_done, 0)::int AS "taskDone",
        CASE WHEN COALESCE(t.task_total, 0) > 0
          THEN ROUND(COALESCE(t.task_done, 0)::numeric * 100 / t.task_total)::int
          ELSE 0
        END AS "taskProgressPct",
        COALESCE(i.open_count, 0)::int AS "openIssuesCount"
      FROM public.design_projects dp
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS task_total,
          COUNT(*) FILTER (WHERE status = 'Completed')::int AS task_done
        FROM public.design_tasks
        WHERE design_project_id = dp.id AND deleted_at IS NULL
      ) t ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS open_count
        FROM public.design_issues
        WHERE design_project_id = dp.id
          AND deleted_at IS NULL
          AND status IN ('Open', 'In Progress')
      ) i ON true
      WHERE dp.company_id = ${companyId}::uuid
        AND dp.deleted_at IS NULL
        ${searchFrag}
        ${filterFrag}
      ORDER BY dp.created_at DESC, dp.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [eq(designProjects.companyId, companyId), isNull(designProjects.deletedAt)];
    const totalRows = await tx
      .select({ value: count() })
      .from(designProjects)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    const sumRows = (await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM public.design_projects
          WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL) AS total,
        (SELECT COUNT(*)::int FROM public.design_projects
          WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
          AND status = 'Design Active') AS active,
        (SELECT COUNT(*)::int FROM public.design_projects
          WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
          AND status = 'Released') AS released,
        (SELECT COUNT(*)::int FROM public.design_projects
          WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
          AND status = 'On Hold') AS on_hold,
        (SELECT COUNT(*)::int FROM public.design_tasks
          WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL) AS total_tasks,
        (SELECT COUNT(*)::int FROM public.design_tasks
          WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
          AND status = 'Completed') AS done_tasks,
        (SELECT COUNT(*)::int FROM public.design_issues
          WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
          AND status IN ('Open','In Progress')) AS open_issues
    `)) as unknown as Array<Record<string, unknown>>;
    const sum = sumRows[0] ?? {};

    const itemsOut = (result as unknown as Array<Record<string, unknown>>).map(toProjectListItem);
    return {
      items: itemsOut,
      total,
      limit: input.limit,
      offset: input.offset,
      summary: {
        total: Number(sum['total'] ?? 0),
        active: Number(sum['active'] ?? 0),
        released: Number(sum['released'] ?? 0),
        onHold: Number(sum['on_hold'] ?? 0),
        totalTasks: Number(sum['total_tasks'] ?? 0),
        doneTasks: Number(sum['done_tasks'] ?? 0),
        openIssues: Number(sum['open_issues'] ?? 0),
      },
    };
  });
}

function toProjectListItem(r: Record<string, unknown>): DesignProjectListItem {
  const engineers = Array.isArray(r['engineers']) ? (r['engineers'] as string[]) : [];
  const checklist = (r['checklist'] as Record<string, boolean> | null) ?? {};
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    projectName: String(r['projectName'] ?? ''),
    salesOrderId: (r['salesOrderId'] as string | null) ?? null,
    soCodeText: (r['soCodeText'] as string | null) ?? null,
    clientId: (r['clientId'] as string | null) ?? null,
    clientText: (r['clientText'] as string | null) ?? null,
    leadText: (r['leadText'] as string | null) ?? null,
    engineers,
    status: r['status'] as DesignProject['status'],
    startDate: dateLike(r['startDate']),
    targetDate: dateLike(r['targetDate']),
    description: (r['description'] as string | null) ?? null,
    checklist,
    releasedDate: r['releasedDate'] != null ? dateLike(r['releasedDate']) : null,
    releasedByText: (r['releasedByText'] as string | null) ?? null,
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: r['deletedAt'] != null ? tsLike(r['deletedAt']) : null,
    taskTotal: Number(r['taskTotal'] ?? 0),
    taskDone: Number(r['taskDone'] ?? 0),
    taskProgressPct: Number(r['taskProgressPct'] ?? 0),
    openIssuesCount: Number(r['openIssuesCount'] ?? 0),
  };
}

// ─── Projects — detail ───────────────────────────────────────────────────

export async function getDesignProjectDetail(
  id: string,
  user: AuthContext,
): Promise<DesignProjectDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const headers = await tx.execute(sql`
      SELECT
        dp.id, dp.company_id AS "companyId", dp.code,
        dp.project_name AS "projectName",
        dp.sales_order_id AS "salesOrderId",
        dp.so_code_text AS "soCodeText",
        dp.client_id AS "clientId",
        dp.client_text AS "clientText",
        dp.lead_text AS "leadText",
        dp.engineers,
        dp.status,
        dp.start_date AS "startDate",
        dp.target_date AS "targetDate",
        dp.description,
        dp.checklist,
        dp.released_date AS "releasedDate",
        dp.released_by_text AS "releasedByText",
        dp.created_at AS "createdAt", dp.created_by AS "createdBy",
        dp.updated_at AS "updatedAt", dp.updated_by AS "updatedBy",
        dp.deleted_at AS "deletedAt",
        COALESCE(t.task_total, 0)::int AS "taskTotal",
        COALESCE(t.task_done, 0)::int AS "taskDone",
        CASE WHEN COALESCE(t.task_total, 0) > 0
          THEN ROUND(COALESCE(t.task_done, 0)::numeric * 100 / t.task_total)::int
          ELSE 0
        END AS "taskProgressPct",
        COALESCE(i.open_count, 0)::int AS "openIssuesCount"
      FROM public.design_projects dp
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS task_total,
               COUNT(*) FILTER (WHERE status='Completed')::int AS task_done
        FROM public.design_tasks
        WHERE design_project_id = dp.id AND deleted_at IS NULL
      ) t ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS open_count
        FROM public.design_issues
        WHERE design_project_id = dp.id AND deleted_at IS NULL
          AND status IN ('Open','In Progress')
      ) i ON true
      WHERE dp.id = ${id}::uuid
        AND dp.company_id = ${companyId}::uuid
        AND dp.deleted_at IS NULL
      LIMIT 1
    `);
    const h = (headers as unknown as Array<Record<string, unknown>>)[0];
    if (!h) throw new NotFoundError(`Design project ${id} not found`);

    const tasksRows = await tx
      .select()
      .from(designTasks)
      .where(
        and(
          eq(designTasks.designProjectId, id),
          eq(designTasks.companyId, companyId),
          isNull(designTasks.deletedAt),
        ),
      )
      .orderBy(sql`${designTasks.createdAt} ASC`);
    const tasks = tasksRows.map(rowToTask);

    const issuesRows = await tx
      .select()
      .from(designIssues)
      .where(
        and(
          eq(designIssues.designProjectId, id),
          eq(designIssues.companyId, companyId),
          isNull(designIssues.deletedAt),
        ),
      )
      .orderBy(sql`${designIssues.createdAt} ASC`);
    const issues = issuesRows.map(rowToIssue);

    const dcrsRows = await tx
      .select()
      .from(designDcrs)
      .where(
        and(
          eq(designDcrs.designProjectId, id),
          eq(designDcrs.companyId, companyId),
          isNull(designDcrs.deletedAt),
        ),
      )
      .orderBy(sql`${designDcrs.createdAt} ASC`);
    const dcrs = dcrsRows.map(rowToDcr);

    const dcnsRows = await tx
      .select()
      .from(designDcns)
      .where(
        and(
          eq(designDcns.designProjectId, id),
          eq(designDcns.companyId, companyId),
          isNull(designDcns.deletedAt),
        ),
      )
      .orderBy(sql`${designDcns.createdAt} ASC`);
    const dcns = dcnsRows.map(rowToDcn);

    return {
      project: toProjectListItem(h),
      tasks,
      issues,
      dcrs,
      dcns,
    };
  });
}

function rowToTask(row: typeof designTasks.$inferSelect): DesignTask {
  const d = row.discussions as unknown;
  const discussions: DesignDiscussion[] = Array.isArray(d) ? (d as DesignDiscussion[]) : [];
  return {
    id: row.id,
    designProjectId: row.designProjectId,
    title: row.title,
    partText: row.partText,
    assigneeText: row.assigneeText,
    priority: row.priority as DesignTask['priority'],
    status: row.status as DesignTask['status'],
    dueDate: row.dueDate != null ? dateLike(row.dueDate) : null,
    description: row.description,
    completedAt: row.completedAt != null ? tsLike(row.completedAt) : null,
    discussions,
    createdAt: tsLike(row.createdAt),
    updatedAt: tsLike(row.updatedAt),
  };
}

function rowToIssue(row: typeof designIssues.$inferSelect): DesignIssue {
  const d = row.discussions as unknown;
  const discussions: DesignDiscussion[] = Array.isArray(d) ? (d as DesignDiscussion[]) : [];
  return {
    id: row.id,
    designProjectId: row.designProjectId,
    designTaskId: row.designTaskId,
    title: row.title,
    partText: row.partText,
    severity: row.severity as DesignIssue['severity'],
    status: row.status as DesignIssue['status'],
    raisedByText: row.raisedByText,
    assignedToText: row.assignedToText,
    raisedDate: dateLike(row.raisedDate),
    resolvedDate: row.resolvedDate != null ? dateLike(row.resolvedDate) : null,
    description: row.description,
    discussions,
    createdAt: tsLike(row.createdAt),
    updatedAt: tsLike(row.updatedAt),
  };
}

function rowToDcr(row: typeof designDcrs.$inferSelect): DesignDcr {
  return {
    id: row.id,
    designProjectId: row.designProjectId,
    code: row.code,
    title: row.title,
    changeType: row.changeType as DesignDcr['changeType'],
    partAffected: row.partAffected,
    priority: row.priority as DesignDcr['priority'],
    status: row.status as DesignDcr['status'],
    requestedByText: row.requestedByText,
    requestDate: dateLike(row.requestDate),
    description: row.description,
    createdAt: tsLike(row.createdAt),
    updatedAt: tsLike(row.updatedAt),
  };
}

function rowToDcn(row: typeof designDcns.$inferSelect): DesignDcn {
  return {
    id: row.id,
    designProjectId: row.designProjectId,
    linkedDcrId: row.linkedDcrId,
    code: row.code,
    title: row.title,
    status: row.status as DesignDcn['status'],
    description: row.description,
    releasedDate: row.releasedDate != null ? dateLike(row.releasedDate) : null,
    createdAt: tsLike(row.createdAt),
    updatedAt: tsLike(row.updatedAt),
  };
}

// ─── Projects — create / update / release / checklist ─────────────────────

export async function createDesignProject(
  input: CreateDesignProjectInput,
  user: AuthContext,
): Promise<DesignProject> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    let soCode: string | null = null;
    let clientId: string | null = null;
    let clientText: string | null = input.clientText ?? null;
    if (input.salesOrderId) {
      const soRows = await tx
        .select({
          id: salesOrders.id,
          code: salesOrders.code,
          clientId: salesOrders.clientId,
          customerName: salesOrders.customerName,
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
      soCode = so.code;
      clientId = so.clientId ?? null;
      if (!clientText && so.customerName) clientText = so.customerName;
    }
    if (clientId) {
      const cRows = await tx
        .select({ name: clients.name })
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
        .limit(1);
      if (cRows[0] && !clientText) clientText = cRows[0].name;
    }

    const code = await nextSequence(tx, 'design_projects', 'DP-', companyId);
    const inserted = await tx
      .insert(designProjects)
      .values({
        companyId,
        code,
        projectName: input.projectName,
        salesOrderId: input.salesOrderId ?? null,
        soCodeText: soCode,
        clientId,
        clientText,
        leadText: input.leadText ?? null,
        engineers: input.engineers,
        status: input.status,
        startDate: input.startDate,
        targetDate: input.targetDate,
        description: input.description ?? null,
        checklist: {},
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new ValidationError('Failed to insert design project');
    return rowToProject(row);
  });
}

function rowToProject(row: typeof designProjects.$inferSelect): DesignProject {
  const engineers = Array.isArray(row.engineers) ? (row.engineers as string[]) : [];
  const checklist = (row.checklist as Record<string, boolean> | null) ?? {};
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    projectName: row.projectName,
    salesOrderId: row.salesOrderId,
    soCodeText: row.soCodeText,
    clientId: row.clientId,
    clientText: row.clientText,
    leadText: row.leadText,
    engineers,
    status: row.status as DesignProject['status'],
    startDate: dateLike(row.startDate),
    targetDate: dateLike(row.targetDate),
    description: row.description,
    checklist,
    releasedDate: row.releasedDate != null ? dateLike(row.releasedDate) : null,
    releasedByText: row.releasedByText,
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt != null ? tsLike(row.deletedAt) : null,
  };
}

export async function updateDesignProject(
  id: string,
  input: UpdateDesignProjectInput,
  user: AuthContext,
): Promise<DesignProject> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(designProjects)
      .where(
        and(
          eq(designProjects.id, id),
          eq(designProjects.companyId, companyId),
          isNull(designProjects.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundError(`Design project ${id} not found`);

    const patch: Partial<typeof designProjects.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: userId,
    };
    if (input.projectName !== undefined) patch.projectName = input.projectName;
    if (input.clientText !== undefined) patch.clientText = input.clientText;
    if (input.leadText !== undefined) patch.leadText = input.leadText;
    if (input.engineers !== undefined) patch.engineers = input.engineers;
    if (input.status !== undefined) patch.status = input.status;
    if (input.targetDate !== undefined) patch.targetDate = input.targetDate;
    if (input.description !== undefined) patch.description = input.description;

    const updated = await tx
      .update(designProjects)
      .set(patch)
      .where(eq(designProjects.id, existing.id))
      .returning();
    return rowToProject(updated[0]!);
  });
}

export async function toggleDesignChecklistItem(
  projectId: string,
  input: ToggleDesignChecklistItemInput,
  user: AuthContext,
): Promise<DesignProject> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(designProjects)
      .where(
        and(
          eq(designProjects.id, projectId),
          eq(designProjects.companyId, companyId),
          isNull(designProjects.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundError(`Design project ${projectId} not found`);
    const checklist = (existing.checklist as Record<string, boolean> | null) ?? {};
    const next = { ...checklist, [input.key]: !checklist[input.key] };
    const updated = await tx
      .update(designProjects)
      .set({ checklist: next, updatedAt: new Date(), updatedBy: userId })
      .where(eq(designProjects.id, existing.id))
      .returning();
    return rowToProject(updated[0]!);
  });
}

export async function releaseDesignProject(
  id: string,
  user: AuthContext,
): Promise<DesignProject> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(designProjects)
      .where(
        and(
          eq(designProjects.id, id),
          eq(designProjects.companyId, companyId),
          isNull(designProjects.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundError(`Design project ${id} not found`);
    const updated = await tx
      .update(designProjects)
      .set({
        status: 'Released',
        releasedDate: new Date().toISOString().slice(0, 10),
        releasedByText: user.email ?? user.id,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(designProjects.id, existing.id))
      .returning();
    return rowToProject(updated[0]!);
  });
}

// ─── Tasks ────────────────────────────────────────────────────────────────

export async function createDesignTask(
  projectId: string,
  input: CreateDesignTaskInput,
  user: AuthContext,
): Promise<DesignTask> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const projRows = await tx
      .select({ id: designProjects.id })
      .from(designProjects)
      .where(
        and(
          eq(designProjects.id, projectId),
          eq(designProjects.companyId, companyId),
          isNull(designProjects.deletedAt),
        ),
      )
      .limit(1);
    if (!projRows[0]) throw new NotFoundError(`Design project ${projectId} not found`);

    const inserted = await tx
      .insert(designTasks)
      .values({
        companyId,
        designProjectId: projectId,
        title: input.title,
        partText: input.partText ?? null,
        assigneeText: input.assigneeText ?? null,
        priority: input.priority,
        status: input.status,
        dueDate: input.dueDate ?? null,
        description: input.description ?? null,
        discussions: [],
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    return rowToTask(inserted[0]!);
  });
}

export async function updateDesignTask(
  id: string,
  input: UpdateDesignTaskInput,
  user: AuthContext,
): Promise<DesignTask> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(designTasks)
      .where(
        and(
          eq(designTasks.id, id),
          eq(designTasks.companyId, companyId),
          isNull(designTasks.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundError(`Design task ${id} not found`);

    const patch: Partial<typeof designTasks.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: userId,
    };
    if (input.title !== undefined) patch.title = input.title;
    if (input.partText !== undefined) patch.partText = input.partText;
    if (input.assigneeText !== undefined) patch.assigneeText = input.assigneeText;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.status !== undefined) {
      patch.status = input.status;
      // Legacy behaviour — completedAt is set when transitioning into Completed
      if (input.status === 'Completed' && existing.status !== 'Completed') {
        patch.completedAt = new Date();
      } else if (input.status !== 'Completed') {
        patch.completedAt = null;
      }
    }
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate ?? null;
    if (input.description !== undefined) patch.description = input.description;

    const updated = await tx
      .update(designTasks)
      .set(patch)
      .where(eq(designTasks.id, existing.id))
      .returning();
    return rowToTask(updated[0]!);
  });
}

export async function addDesignTaskComment(
  taskId: string,
  input: AddDesignCommentInput,
  user: AuthContext,
): Promise<DesignTask> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(designTasks)
      .where(
        and(
          eq(designTasks.id, taskId),
          eq(designTasks.companyId, companyId),
          isNull(designTasks.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundError(`Design task ${taskId} not found`);
    const list = (Array.isArray(existing.discussions) ? existing.discussions : []) as DesignDiscussion[];
    const next: DesignDiscussion[] = [
      ...list,
      {
        author: user.email ?? user.id,
        text: input.text,
        date: new Date().toISOString().slice(0, 10),
      },
    ];
    const updated = await tx
      .update(designTasks)
      .set({ discussions: next, updatedAt: new Date(), updatedBy: userId })
      .where(eq(designTasks.id, existing.id))
      .returning();
    return rowToTask(updated[0]!);
  });
}

// ─── Issues ──────────────────────────────────────────────────────────────

export async function createDesignIssue(
  projectId: string,
  input: CreateDesignIssueInput,
  user: AuthContext,
): Promise<DesignIssue> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const projRows = await tx
      .select({ id: designProjects.id })
      .from(designProjects)
      .where(
        and(
          eq(designProjects.id, projectId),
          eq(designProjects.companyId, companyId),
          isNull(designProjects.deletedAt),
        ),
      )
      .limit(1);
    if (!projRows[0]) throw new NotFoundError(`Design project ${projectId} not found`);

    if (input.designTaskId) {
      const tRows = await tx
        .select({ id: designTasks.id })
        .from(designTasks)
        .where(
          and(
            eq(designTasks.id, input.designTaskId),
            eq(designTasks.designProjectId, projectId),
            isNull(designTasks.deletedAt),
          ),
        )
        .limit(1);
      if (!tRows[0]) throw new NotFoundError(`Task ${input.designTaskId} not in project`);
    }

    const inserted = await tx
      .insert(designIssues)
      .values({
        companyId,
        designProjectId: projectId,
        designTaskId: input.designTaskId ?? null,
        title: input.title,
        partText: input.partText ?? null,
        severity: input.severity,
        status: input.status,
        raisedByText: input.raisedByText ?? (user.email ?? user.id),
        assignedToText: input.assignedToText ?? null,
        raisedDate: new Date().toISOString().slice(0, 10),
        description: input.description ?? null,
        discussions: [],
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    return rowToIssue(inserted[0]!);
  });
}

export async function updateDesignIssue(
  id: string,
  input: UpdateDesignIssueInput,
  user: AuthContext,
): Promise<DesignIssue> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(designIssues)
      .where(
        and(
          eq(designIssues.id, id),
          eq(designIssues.companyId, companyId),
          isNull(designIssues.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundError(`Design issue ${id} not found`);

    const patch: Partial<typeof designIssues.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: userId,
    };
    if (input.title !== undefined) patch.title = input.title;
    if (input.partText !== undefined) patch.partText = input.partText;
    if (input.severity !== undefined) patch.severity = input.severity;
    if (input.status !== undefined) {
      patch.status = input.status;
      if (
        (input.status === 'Resolved' || input.status === 'Closed') &&
        existing.status !== 'Resolved' &&
        existing.status !== 'Closed'
      ) {
        patch.resolvedDate = new Date().toISOString().slice(0, 10);
      } else if (input.status === 'Open' || input.status === 'In Progress') {
        patch.resolvedDate = null;
      }
    }
    if (input.designTaskId !== undefined) patch.designTaskId = input.designTaskId;
    if (input.assignedToText !== undefined) patch.assignedToText = input.assignedToText;
    if (input.description !== undefined) patch.description = input.description;

    const updated = await tx
      .update(designIssues)
      .set(patch)
      .where(eq(designIssues.id, existing.id))
      .returning();
    return rowToIssue(updated[0]!);
  });
}

export async function addDesignIssueComment(
  issueId: string,
  input: AddDesignCommentInput,
  user: AuthContext,
): Promise<DesignIssue> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(designIssues)
      .where(
        and(
          eq(designIssues.id, issueId),
          eq(designIssues.companyId, companyId),
          isNull(designIssues.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundError(`Design issue ${issueId} not found`);
    const list = (Array.isArray(existing.discussions) ? existing.discussions : []) as DesignDiscussion[];
    const next: DesignDiscussion[] = [
      ...list,
      {
        author: user.email ?? user.id,
        text: input.text,
        date: new Date().toISOString().slice(0, 10),
      },
    ];
    const updated = await tx
      .update(designIssues)
      .set({ discussions: next, updatedAt: new Date(), updatedBy: userId })
      .where(eq(designIssues.id, existing.id))
      .returning();
    return rowToIssue(updated[0]!);
  });
}

// ─── DCR / DCN ───────────────────────────────────────────────────────────

export async function createDesignDcr(
  projectId: string,
  input: CreateDesignDcrInput,
  user: AuthContext,
): Promise<DesignDcr> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const projRows = await tx
      .select({ id: designProjects.id })
      .from(designProjects)
      .where(
        and(
          eq(designProjects.id, projectId),
          eq(designProjects.companyId, companyId),
          isNull(designProjects.deletedAt),
        ),
      )
      .limit(1);
    if (!projRows[0]) throw new NotFoundError(`Design project ${projectId} not found`);

    const code = await nextSequence(tx, 'design_dcrs', 'DCR-', companyId);
    const inserted = await tx
      .insert(designDcrs)
      .values({
        companyId,
        designProjectId: projectId,
        code,
        title: input.title,
        changeType: input.changeType,
        partAffected: input.partAffected ?? null,
        priority: input.priority,
        status: 'Submitted',
        requestedByText: input.requestedByText ?? (user.email ?? user.id),
        requestDate: input.requestDate,
        description: input.description ?? null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    return rowToDcr(inserted[0]!);
  });
}

export async function updateDesignDcr(
  id: string,
  input: UpdateDesignDcrInput,
  user: AuthContext,
): Promise<DesignDcr> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(designDcrs)
      .where(
        and(
          eq(designDcrs.id, id),
          eq(designDcrs.companyId, companyId),
          isNull(designDcrs.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundError(`DCR ${id} not found`);
    const patch: Partial<typeof designDcrs.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: userId,
    };
    if (input.title !== undefined) patch.title = input.title;
    if (input.changeType !== undefined) patch.changeType = input.changeType;
    if (input.partAffected !== undefined) patch.partAffected = input.partAffected;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.status !== undefined) patch.status = input.status;
    if (input.requestDate !== undefined) patch.requestDate = input.requestDate;
    if (input.description !== undefined) patch.description = input.description;

    const updated = await tx
      .update(designDcrs)
      .set(patch)
      .where(eq(designDcrs.id, existing.id))
      .returning();
    return rowToDcr(updated[0]!);
  });
}

export async function createDesignDcn(
  projectId: string,
  input: CreateDesignDcnInput,
  user: AuthContext,
): Promise<DesignDcn> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const projRows = await tx
      .select({ id: designProjects.id })
      .from(designProjects)
      .where(
        and(
          eq(designProjects.id, projectId),
          eq(designProjects.companyId, companyId),
          isNull(designProjects.deletedAt),
        ),
      )
      .limit(1);
    if (!projRows[0]) throw new NotFoundError(`Design project ${projectId} not found`);
    if (input.linkedDcrId) {
      const dcrRows = await tx
        .select({ id: designDcrs.id })
        .from(designDcrs)
        .where(
          and(
            eq(designDcrs.id, input.linkedDcrId),
            eq(designDcrs.designProjectId, projectId),
            isNull(designDcrs.deletedAt),
          ),
        )
        .limit(1);
      if (!dcrRows[0]) throw new NotFoundError(`DCR ${input.linkedDcrId} not in project`);
    }

    const code = await nextSequence(tx, 'design_dcns', 'DCN-', companyId);
    const inserted = await tx
      .insert(designDcns)
      .values({
        companyId,
        designProjectId: projectId,
        linkedDcrId: input.linkedDcrId ?? null,
        code,
        title: input.title,
        status: 'Draft',
        description: input.description ?? null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    return rowToDcn(inserted[0]!);
  });
}

export async function updateDesignDcn(
  id: string,
  input: UpdateDesignDcnInput,
  user: AuthContext,
): Promise<DesignDcn> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(designDcns)
      .where(
        and(
          eq(designDcns.id, id),
          eq(designDcns.companyId, companyId),
          isNull(designDcns.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundError(`DCN ${id} not found`);
    const patch: Partial<typeof designDcns.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: userId,
    };
    if (input.title !== undefined) patch.title = input.title;
    if (input.status !== undefined) {
      patch.status = input.status;
      if (input.status === 'Released' && existing.status !== 'Released') {
        patch.releasedDate = new Date().toISOString().slice(0, 10);
      }
    }
    if (input.description !== undefined) patch.description = input.description;

    const updated = await tx
      .update(designDcns)
      .set(patch)
      .where(eq(designDcns.id, existing.id))
      .returning();
    return rowToDcn(updated[0]!);
  });
}

// ─── Related documents (read-only traceability) ───────────────────────────
//
// GET /design-projects/:id/related. Assembles the FK-linked documents around a
// design project into a DocumentTraceability payload. Every subquery is
// company-scoped and soft-delete filtered, inside one withUserContext tx (RLS
// company isolation applies too). No business rule — pure read-side shaping.
//
// Upstream (source):
//   - design_projects.sales_order_id → sales_orders (the driving SO)
//   - design_projects.client_id      → clients (the customer)
// Downstream (children — all reference-only, no detail route exists):
//   - design_tasks    WHERE design_project_id = :id
//   - design_issues   WHERE design_project_id = :id
//   - design_work_log WHERE design_project_id = :id
//   - design_dcrs     WHERE design_project_id = :id
//   - design_dcns     WHERE design_project_id = :id

export async function getDesignProjectRelated(
  id: string,
  user: AuthContext,
): Promise<DocumentTraceability> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Confirm the project exists / is visible; grab its own code, date, status
    // and the upstream FK ids.
    const headers = await tx
      .select({
        id: designProjects.id,
        code: designProjects.code,
        status: designProjects.status,
        startDate: designProjects.startDate,
        salesOrderId: designProjects.salesOrderId,
        clientId: designProjects.clientId,
      })
      .from(designProjects)
      .where(
        and(
          eq(designProjects.id, id),
          eq(designProjects.companyId, companyId),
          isNull(designProjects.deletedAt),
        ),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError(`Design project ${id} not found`);

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

    // ── Upstream: sales order this project was created from ──────────────────
    const soRows = header.salesOrderId
      ? await tx
          .select({
            id: salesOrders.id,
            code: salesOrders.code,
            status: salesOrders.status,
            date: salesOrders.soDate,
          })
          .from(salesOrders)
          .where(
            and(
              eq(salesOrders.id, header.salesOrderId),
              eq(salesOrders.companyId, companyId),
              isNull(salesOrders.deletedAt),
            ),
          )
          .limit(1)
      : [];

    // ── Upstream: client (customer) ──────────────────────────────────────────
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

    // ── Downstream: tasks / issues / work-log / DCRs / DCNs ──────────────────
    const taskRows = await tx
      .select({
        id: designTasks.id,
        title: designTasks.title,
        status: designTasks.status,
        date: designTasks.dueDate,
      })
      .from(designTasks)
      .where(
        and(
          eq(designTasks.designProjectId, id),
          eq(designTasks.companyId, companyId),
          isNull(designTasks.deletedAt),
        ),
      )
      .orderBy(desc(designTasks.createdAt));

    const issueRows = await tx
      .select({
        id: designIssues.id,
        title: designIssues.title,
        status: designIssues.status,
        date: designIssues.raisedDate,
      })
      .from(designIssues)
      .where(
        and(
          eq(designIssues.designProjectId, id),
          eq(designIssues.companyId, companyId),
          isNull(designIssues.deletedAt),
        ),
      )
      .orderBy(desc(designIssues.raisedDate));

    // Work-log rows have no code/status — label by the task text (fallback:
    // engineer) and carry the engineer name as the row label.
    const workLogRows = await tx
      .select({
        id: designWorkLog.id,
        taskText: designWorkLog.taskText,
        engineerText: designWorkLog.engineerText,
        date: designWorkLog.logDate,
      })
      .from(designWorkLog)
      .where(
        and(
          eq(designWorkLog.designProjectId, id),
          eq(designWorkLog.companyId, companyId),
          isNull(designWorkLog.deletedAt),
        ),
      )
      .orderBy(desc(designWorkLog.logDate));

    const dcrRows = await tx
      .select({
        id: designDcrs.id,
        code: designDcrs.code,
        status: designDcrs.status,
        date: designDcrs.requestDate,
      })
      .from(designDcrs)
      .where(
        and(
          eq(designDcrs.designProjectId, id),
          eq(designDcrs.companyId, companyId),
          isNull(designDcrs.deletedAt),
        ),
      )
      .orderBy(desc(designDcrs.requestDate));

    const dcnRows = await tx
      .select({
        id: designDcns.id,
        code: designDcns.code,
        status: designDcns.status,
        date: designDcns.releasedDate,
      })
      .from(designDcns)
      .where(
        and(
          eq(designDcns.designProjectId, id),
          eq(designDcns.companyId, companyId),
          isNull(designDcns.deletedAt),
        ),
      )
      .orderBy(desc(designDcns.createdAt));

    // ── Upstream sections ────────────────────────────────────────────────────
    const soSection = section(
      'sales-order',
      'Sales Order',
      '📄',
      'sales-order',
      soRows.map((r) => row(r.id, r.code, r.status, r.date)),
    );
    const clientSection = section(
      'client',
      'Client',
      '👤',
      'client',
      client ? [row(client.id, client.code, null, null, { label: client.name })] : [],
    );

    // ── Downstream sections (all reference-only — no detail routes) ──────────
    const tasksSection = section(
      'design-tasks',
      'Design Tasks',
      '📐',
      null,
      taskRows.map((r) => row(r.id, r.title, r.status, r.date)),
    );
    const issuesSection = section(
      'design-issues',
      'Design Issues',
      '⚠',
      null,
      issueRows.map((r) => row(r.id, r.title, r.status, r.date)),
    );
    const workLogSection = section(
      'design-work-log',
      'Work Log Entries',
      '🕒',
      null,
      workLogRows.map((r) =>
        row(r.id, r.taskText ?? r.engineerText, null, r.date, { label: r.engineerText }),
      ),
    );
    const dcrSection = section(
      'design-dcrs',
      'DCRs',
      '📝',
      null,
      dcrRows.map((r) => row(r.id, r.code, r.status, r.date)),
    );
    const dcnSection = section(
      'design-dcns',
      'DCNs',
      '📄',
      null,
      dcnRows.map((r) => row(r.id, r.code, r.status, r.date)),
    );

    const upstream = [soSection, clientSection];
    const downstream = [tasksSection, issuesSection, workLogSection, dcrSection, dcnSection];
    return {
      self: { module: 'design-projects', code: header.code },
      upstream,
      downstream,
      related: [],
      timeline: buildTimeline(
        {
          ts: toIsoDate(header.startDate),
          label: 'Design Project created',
          code: header.code,
          routeKind: 'design-project',
          linkId: id,
        },
        [...upstream, ...downstream],
      ),
    };
  });
}
