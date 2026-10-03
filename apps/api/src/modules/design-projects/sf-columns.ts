// Sort & Filter (ADR-200) — the Design Projects list's sortable / filterable
// fields. listDesignProjects reads design_projects dp with the task (t) and
// open-issue (i) LATERAL counts for its list, its count and its summary
// alike (DESIGN_PROJECT_FROM below), so every expression is the one the
// SELECT shows for that column — Tasks (done), Progress % and Open Issues
// included.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

/** The list's FROM: the project plus its task and open-issue counts. */
export const DESIGN_PROJECT_FROM = sql`
  FROM public.design_projects dp
  -- ADR-207: the Internal SO No., live off the driving SO.
  LEFT JOIN public.sales_orders so_i
    ON so_i.id = dp.sales_order_id AND so_i.deleted_at IS NULL
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
  ) i ON true`;

export const TASK_DONE_SQL = sql`COALESCE(t.task_done, 0)::int`;
export const TASK_TOTAL_SQL = sql`COALESCE(t.task_total, 0)::int`;
export const TASK_PROGRESS_SQL = sql`(CASE WHEN COALESCE(t.task_total, 0) > 0
  THEN ROUND(COALESCE(t.task_done, 0)::numeric * 100 / t.task_total)::int
  ELSE 0 END)`;
export const OPEN_ISSUES_SQL = sql`COALESCE(i.open_count, 0)::int`;

export const DESIGN_PROJECT_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`dp.code`, type: 'text' },
  projectName: { sql: sql`dp.project_name`, type: 'text' },
  soCode: { sql: sql`dp.so_code_text`, type: 'text' },
  customer: { sql: sql`dp.client_text`, type: 'text' },
  lead: { sql: sql`dp.lead_text`, type: 'text' },
  dueDate: { sql: sql`dp.target_date`, type: 'date' },
  status: { sql: sql`dp.status`, type: 'list' },
  taskDone: { sql: TASK_DONE_SQL, type: 'num' },
  progress: { sql: TASK_PROGRESS_SQL, type: 'num' },
  openIssues: { sql: OPEN_ISSUES_SQL, type: 'num' },
};
