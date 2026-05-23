// Engineer workload — one row per engineer with assigned-task counts
// (active / completed / overdue), open-issue count, total work-log hours.
// Mirrors the second table of legacy `_rptDesign` (HTML L8419–8420).
//
// The legacy engineer list is `_dpGetEngineers()` which reads from
// `db.users`. Here we derive the union of engineers actually referenced
// across `design_tasks.assignee_text`, `design_issues.assigned_to_text`,
// and `design_work_log.engineer_text` — flexible vs the legacy fixed list,
// matches reality if a name only appears in one place.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

export const designEngineerWorkloadReport: RegisteredReport = {
  definition: {
    slug: 'design-engineer-workload',
    title: 'Engineer Workload',
    description:
      'Per-engineer load: tasks total/active/completed/overdue + open issues + logged hours.',
    group: 'Design',
    filters: [],
    columns: [
      { key: 'engineer', label: 'Engineer', type: 'text' },
      { key: 'total_tasks', label: 'Total Tasks', type: 'number' },
      { key: 'active', label: 'Active', type: 'number' },
      { key: 'completed', label: 'Completed', type: 'number' },
      { key: 'overdue', label: 'Overdue', type: 'number' },
      { key: 'open_issues', label: 'Open Issues', type: 'number' },
      { key: 'hours', label: 'Hours', type: 'number' },
    ],
  },
  async run({ tx, companyId }) {
    const today = new Date().toISOString().slice(0, 10);

    const result = await tx.execute(sql`
      WITH engineers AS (
        SELECT DISTINCT assignee_text AS name
          FROM public.design_tasks
          WHERE company_id = ${companyId}::uuid
            AND deleted_at IS NULL
            AND assignee_text IS NOT NULL
            AND assignee_text <> ''
        UNION
        SELECT DISTINCT assigned_to_text AS name
          FROM public.design_issues
          WHERE company_id = ${companyId}::uuid
            AND deleted_at IS NULL
            AND assigned_to_text IS NOT NULL
            AND assigned_to_text <> ''
        UNION
        SELECT DISTINCT engineer_text AS name
          FROM public.design_work_log
          WHERE company_id = ${companyId}::uuid
            AND deleted_at IS NULL
            AND engineer_text IS NOT NULL
            AND engineer_text <> ''
      )
      SELECT
        e.name AS engineer,
        COALESCE(tt.total, 0)::int AS total_tasks,
        COALESCE(tt.active, 0)::int AS active,
        COALESCE(tt.completed, 0)::int AS completed,
        COALESCE(tt.overdue, 0)::int AS overdue,
        COALESCE(ii.open_count, 0)::int AS open_issues,
        COALESCE(wl.hours, 0)::numeric(10, 2) AS hours
      FROM engineers e
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status <> 'Completed')::int AS active,
          COUNT(*) FILTER (WHERE status = 'Completed')::int AS completed,
          COUNT(*) FILTER (
            WHERE status <> 'Completed'
              AND due_date IS NOT NULL
              AND due_date < ${today}::date
          )::int AS overdue
        FROM public.design_tasks
        WHERE company_id = ${companyId}::uuid
          AND deleted_at IS NULL
          AND assignee_text = e.name
      ) tt ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS open_count
        FROM public.design_issues
        WHERE company_id = ${companyId}::uuid
          AND deleted_at IS NULL
          AND assigned_to_text = e.name
          AND status IN ('Open', 'In Progress')
      ) ii ON true
      LEFT JOIN LATERAL (
        SELECT SUM(hours)::numeric AS hours
        FROM public.design_work_log
        WHERE company_id = ${companyId}::uuid
          AND deleted_at IS NULL
          AND engineer_text = e.name
      ) wl ON true
      ORDER BY total_tasks DESC, e.name ASC
      LIMIT 500
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      engineer: String(r['engineer'] ?? ''),
      total_tasks: Number(r['total_tasks'] ?? 0),
      active: Number(r['active'] ?? 0),
      completed: Number(r['completed'] ?? 0),
      overdue: Number(r['overdue'] ?? 0),
      open_issues: Number(r['open_issues'] ?? 0),
      hours: Number(r['hours'] ?? 0),
    }));

    return { columns: designEngineerWorkloadReport.definition.columns, rows };
  },
};
