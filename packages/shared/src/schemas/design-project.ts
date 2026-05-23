// Design Engineering shared schemas (Design slices C/D/E).
//
// Multi-table newer subsystem (legacy v82.0+). Covers Design Projects + Tasks
// + Issues + Work Log + DCR/DCN. Mirrors:
//   renderDesignProjects    HTML L7570 + _dpRenderDetail L7623
//   renderDesignIssuesPage  L7890
//   renderDesignWorkLog     L7935

import { z } from 'zod';

// ─── Enums ─────────────────────────────────────────────────────────────────

export const DESIGN_PROJECT_STATUSES = [
  'Design Active',
  'In Review',
  'Released',
  'On Hold',
] as const;
export type DesignProjectStatus = (typeof DESIGN_PROJECT_STATUSES)[number];
export const designProjectStatusSchema = z.enum(DESIGN_PROJECT_STATUSES);

export const DESIGN_TASK_STATUSES = [
  'Not Started',
  'In Progress',
  'In Review',
  'Completed',
] as const;
export type DesignTaskStatus = (typeof DESIGN_TASK_STATUSES)[number];
export const designTaskStatusSchema = z.enum(DESIGN_TASK_STATUSES);

export const DESIGN_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export type DesignPriority = (typeof DESIGN_PRIORITIES)[number];
export const designPrioritySchema = z.enum(DESIGN_PRIORITIES);

export const DESIGN_ISSUE_SEVERITIES = ['Critical', 'Major', 'Minor'] as const;
export type DesignIssueSeverity = (typeof DESIGN_ISSUE_SEVERITIES)[number];
export const designIssueSeveritySchema = z.enum(DESIGN_ISSUE_SEVERITIES);

export const DESIGN_ISSUE_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'] as const;
export type DesignIssueStatus = (typeof DESIGN_ISSUE_STATUSES)[number];
export const designIssueStatusSchema = z.enum(DESIGN_ISSUE_STATUSES);

export const DESIGN_WORK_CATEGORIES = [
  'Design',
  'Review',
  'Rework',
  'Issue Resolution',
  'Client Support',
  'Meeting',
  'Documentation',
  'Testing/FEA',
  'Other',
] as const;
export type DesignWorkCategory = (typeof DESIGN_WORK_CATEGORIES)[number];
export const designWorkCategorySchema = z.enum(DESIGN_WORK_CATEGORIES);

export const DESIGN_DCR_CHANGE_TYPES = [
  'Client Request',
  'Manufacturing Issue',
  'QC Finding',
  'Cost Optimization',
  'Safety',
  'Material Change',
  'Other',
] as const;
export type DesignDcrChangeType = (typeof DESIGN_DCR_CHANGE_TYPES)[number];
export const designDcrChangeTypeSchema = z.enum(DESIGN_DCR_CHANGE_TYPES);

export const DESIGN_DCR_STATUSES = [
  'Submitted',
  'Under Review',
  'Accepted',
  'Rejected',
] as const;
export type DesignDcrStatus = (typeof DESIGN_DCR_STATUSES)[number];
export const designDcrStatusSchema = z.enum(DESIGN_DCR_STATUSES);

export const DESIGN_DCN_STATUSES = [
  'Draft',
  'In Progress',
  'Review',
  'Approved',
  'Released',
] as const;
export type DesignDcnStatus = (typeof DESIGN_DCN_STATUSES)[number];
export const designDcnStatusSchema = z.enum(DESIGN_DCN_STATUSES);

export const DESIGN_DCR_PRIORITIES = ['Urgent', 'Normal', 'Low'] as const;
export type DesignDcrPriority = (typeof DESIGN_DCR_PRIORITIES)[number];
export const designDcrPrioritySchema = z.enum(DESIGN_DCR_PRIORITIES);

// ─── Read shapes ───────────────────────────────────────────────────────────

export const designDiscussionSchema = z.object({
  author: z.string(),
  text: z.string(),
  date: z.string(),
});
export type DesignDiscussion = z.infer<typeof designDiscussionSchema>;

export const designProjectSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  projectName: z.string(),
  salesOrderId: z.string().uuid().nullable(),
  soCodeText: z.string().nullable(),
  clientId: z.string().uuid().nullable(),
  clientText: z.string().nullable(),
  leadText: z.string().nullable(),
  engineers: z.array(z.string()),
  status: designProjectStatusSchema,
  startDate: z.string(),
  targetDate: z.string(),
  description: z.string().nullable(),
  checklist: z.record(z.string(), z.boolean()),
  releasedDate: z.string().nullable(),
  releasedByText: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type DesignProject = z.infer<typeof designProjectSchema>;

export const designProjectListItemSchema = designProjectSchema.extend({
  taskTotal: z.number().int().nonnegative(),
  taskDone: z.number().int().nonnegative(),
  taskProgressPct: z.number().int().nonnegative(),
  openIssuesCount: z.number().int().nonnegative(),
});
export type DesignProjectListItem = z.infer<typeof designProjectListItemSchema>;

export const designTaskSchema = z.object({
  id: z.string().uuid(),
  designProjectId: z.string().uuid(),
  title: z.string(),
  partText: z.string().nullable(),
  assigneeText: z.string().nullable(),
  priority: designPrioritySchema,
  status: designTaskStatusSchema,
  dueDate: z.string().nullable(),
  description: z.string().nullable(),
  completedAt: z.string().nullable(),
  discussions: z.array(designDiscussionSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DesignTask = z.infer<typeof designTaskSchema>;

export const designIssueSchema = z.object({
  id: z.string().uuid(),
  designProjectId: z.string().uuid(),
  designTaskId: z.string().uuid().nullable(),
  title: z.string(),
  partText: z.string().nullable(),
  severity: designIssueSeveritySchema,
  status: designIssueStatusSchema,
  raisedByText: z.string().nullable(),
  assignedToText: z.string().nullable(),
  raisedDate: z.string(),
  resolvedDate: z.string().nullable(),
  description: z.string().nullable(),
  discussions: z.array(designDiscussionSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DesignIssue = z.infer<typeof designIssueSchema>;

export const designIssueListItemSchema = designIssueSchema.extend({
  projectName: z.string().nullable(),
  /** Days since raisedDate (computed). */
  ageDays: z.number().int().nonnegative(),
});
export type DesignIssueListItem = z.infer<typeof designIssueListItemSchema>;

export const designWorkLogEntrySchema = z.object({
  id: z.string().uuid(),
  logDate: z.string(),
  engineerText: z.string(),
  designProjectId: z.string().uuid().nullable(),
  projectName: z.string().nullable(),
  projectCode: z.string().nullable(),
  taskText: z.string().nullable(),
  category: designWorkCategorySchema,
  hours: z.number(),
  description: z.string().nullable(),
  createdAt: z.string(),
});
export type DesignWorkLogEntry = z.infer<typeof designWorkLogEntrySchema>;

export const designDcrSchema = z.object({
  id: z.string().uuid(),
  designProjectId: z.string().uuid(),
  code: z.string(),
  title: z.string(),
  changeType: designDcrChangeTypeSchema,
  partAffected: z.string().nullable(),
  priority: designDcrPrioritySchema,
  status: designDcrStatusSchema,
  requestedByText: z.string().nullable(),
  requestDate: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DesignDcr = z.infer<typeof designDcrSchema>;

export const designDcnSchema = z.object({
  id: z.string().uuid(),
  designProjectId: z.string().uuid(),
  linkedDcrId: z.string().uuid().nullable(),
  code: z.string(),
  title: z.string(),
  status: designDcnStatusSchema,
  description: z.string().nullable(),
  releasedDate: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DesignDcn = z.infer<typeof designDcnSchema>;

// ─── Project detail bundle (used by /design-projects/:id) ─────────────────

export interface DesignProjectDetail {
  project: DesignProjectListItem;
  tasks: DesignTask[];
  issues: DesignIssue[];
  dcrs: DesignDcr[];
  dcns: DesignDcn[];
}

// ─── Write inputs — projects ───────────────────────────────────────────────

export const createDesignProjectInputSchema = z.object({
  projectName: z.string().trim().min(1).max(200),
  salesOrderId: z.string().uuid().optional(),
  clientText: z.string().trim().max(200).optional(),
  leadText: z.string().trim().max(120).optional(),
  engineers: z.array(z.string().trim().min(1)).default([]),
  status: designProjectStatusSchema.default('Design Active'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().max(2000).optional(),
});
export type CreateDesignProjectInput = z.infer<typeof createDesignProjectInputSchema>;

export const updateDesignProjectInputSchema = z.object({
  projectName: z.string().trim().min(1).max(200).optional(),
  clientText: z.string().trim().max(200).optional(),
  leadText: z.string().trim().max(120).optional(),
  engineers: z.array(z.string().trim().min(1)).optional(),
  status: designProjectStatusSchema.optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  description: z.string().trim().max(2000).optional(),
});
export type UpdateDesignProjectInput = z.infer<typeof updateDesignProjectInputSchema>;

export const toggleDesignChecklistItemInputSchema = z.object({
  key: z.string().trim().min(1).max(64),
});
export type ToggleDesignChecklistItemInput = z.infer<typeof toggleDesignChecklistItemInputSchema>;

// ─── Write inputs — tasks ──────────────────────────────────────────────────

export const createDesignTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  partText: z.string().trim().max(200).optional(),
  assigneeText: z.string().trim().max(120).optional(),
  priority: designPrioritySchema.default('Medium'),
  status: designTaskStatusSchema.default('Not Started'),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  description: z.string().trim().max(2000).optional(),
});
export type CreateDesignTaskInput = z.infer<typeof createDesignTaskInputSchema>;

export const updateDesignTaskInputSchema = createDesignTaskInputSchema.partial();
export type UpdateDesignTaskInput = z.infer<typeof updateDesignTaskInputSchema>;

// ─── Write inputs — issues ─────────────────────────────────────────────────

export const createDesignIssueInputSchema = z.object({
  designTaskId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  partText: z.string().trim().max(200).optional(),
  severity: designIssueSeveritySchema.default('Major'),
  status: designIssueStatusSchema.default('Open'),
  raisedByText: z.string().trim().max(120).optional(),
  assignedToText: z.string().trim().max(120).optional(),
  description: z.string().trim().max(2000).optional(),
});
export type CreateDesignIssueInput = z.infer<typeof createDesignIssueInputSchema>;

export const updateDesignIssueInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    partText: z.string().trim().max(200).optional(),
    severity: designIssueSeveritySchema.optional(),
    status: designIssueStatusSchema.optional(),
    designTaskId: z.string().uuid().nullable().optional(),
    assignedToText: z.string().trim().max(120).optional(),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();
export type UpdateDesignIssueInput = z.infer<typeof updateDesignIssueInputSchema>;

// ─── Comment append (for both tasks and issues) ───────────────────────────

export const addDesignCommentInputSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});
export type AddDesignCommentInput = z.infer<typeof addDesignCommentInputSchema>;

// ─── Write inputs — work log ───────────────────────────────────────────────

export const createDesignWorkLogInputSchema = z.object({
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  designProjectId: z.string().uuid(),
  taskText: z.string().trim().max(200).optional(),
  category: designWorkCategorySchema.default('Design'),
  hours: z.coerce.number().positive().max(24),
  description: z.string().trim().max(1000).optional(),
});
export type CreateDesignWorkLogInput = z.infer<typeof createDesignWorkLogInputSchema>;

// ─── Write inputs — DCR/DCN ────────────────────────────────────────────────

export const createDesignDcrInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  changeType: designDcrChangeTypeSchema.default('Other'),
  partAffected: z.string().trim().max(200).optional(),
  priority: designDcrPrioritySchema.default('Normal'),
  requestedByText: z.string().trim().max(120).optional(),
  requestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().max(2000).optional(),
});
export type CreateDesignDcrInput = z.infer<typeof createDesignDcrInputSchema>;

export const updateDesignDcrInputSchema = createDesignDcrInputSchema.partial().extend({
  status: designDcrStatusSchema.optional(),
});
export type UpdateDesignDcrInput = z.infer<typeof updateDesignDcrInputSchema>;

export const createDesignDcnInputSchema = z.object({
  linkedDcrId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
});
export type CreateDesignDcnInput = z.infer<typeof createDesignDcnInputSchema>;

export const updateDesignDcnInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: designDcnStatusSchema.optional(),
  description: z.string().trim().max(2000).optional(),
});
export type UpdateDesignDcnInput = z.infer<typeof updateDesignDcnInputSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listDesignProjectsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  filter: z.enum(['all', 'active', 'released', 'hold']).default('all'),
  limit: z.coerce.number().int().positive().max(200).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListDesignProjectsQuery = z.infer<typeof listDesignProjectsQuerySchema>;

export interface ListDesignProjectsResponse {
  items: DesignProjectListItem[];
  total: number;
  limit: number;
  offset: number;
  summary: {
    total: number;
    active: number;
    released: number;
    onHold: number;
    totalTasks: number;
    doneTasks: number;
    openIssues: number;
  };
}

export const listDesignIssuesQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  filter: z.enum(['all', 'open', 'resolved', 'critical']).default('all'),
  limit: z.coerce.number().int().positive().max(500).default(200),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListDesignIssuesQuery = z.infer<typeof listDesignIssuesQuerySchema>;

export interface ListDesignIssuesResponse {
  items: DesignIssueListItem[];
  total: number;
  limit: number;
  offset: number;
  summary: {
    total: number;
    open: number;
    resolved: number;
    critical: number;
  };
}

export const listDesignWorkLogQuerySchema = z.object({
  engineer: z.string().min(1).max(120).optional(),
  /** YYYY-MM-DD inclusive */
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  designProjectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(2000).default(500),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListDesignWorkLogQuery = z.infer<typeof listDesignWorkLogQuerySchema>;

export interface ListDesignWorkLogResponse {
  items: DesignWorkLogEntry[];
  total: number;
  limit: number;
  offset: number;
}
