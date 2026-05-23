// Design project summary — one row per design_projects with rolled-up
// task counts, progress %, open-issue count, checklist progress, work-log
// hours. Mirrors the first table of legacy `_rptDesign` (HTML L8417–8418).

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

const CHECKLIST_TOTAL = 12;

export const designProjectSummaryReport: RegisteredReport = {
  definition: {
    slug: 'design-project-summary',
    title: 'Design Project Summary',
    description:
      'Per-project rollup: tasks done/total, open issues, checklist progress, logged hours, target date.',
    group: 'Design',
    filters: [
      {
        key: 'status',
        label: 'Status',
        kind: 'enum',
        options: ['Design Active', 'In Review', 'Released', 'On Hold'],
      },
    ],
    columns: [
      { key: 'project_no', label: 'Project No', type: 'text' },
      { key: 'project_name', label: 'Project', type: 'text' },
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'lead', label: 'Lead', type: 'text' },
      { key: 'tasks', label: 'Tasks', type: 'text' },
      { key: 'progress_pct', label: 'Progress %', type: 'text' },
      { key: 'open_issues', label: 'Open Issues', type: 'number' },
      { key: 'checklist', label: 'Checklist', type: 'text' },
      { key: 'hours', label: 'Hours', type: 'number' },
      { key: 'target', label: 'Target', type: 'date' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const status = filters['status'];
    const statusFrag = status ? sql`AND dp.status = ${status}` : sql``;

    const result = await tx.execute(sql`
      SELECT
        dp.code AS project_no,
        dp.project_name AS project_name,
        COALESCE(dp.client_text, '—') AS client,
        dp.status AS status,
        COALESCE(dp.lead_text, '—') AS lead,
        COALESCE(t.done, 0)::int AS task_done,
        COALESCE(t.total, 0)::int AS task_total,
        CASE WHEN COALESCE(t.total, 0) > 0
          THEN ROUND(COALESCE(t.done, 0)::numeric * 100 / t.total)::int
          ELSE 0
        END AS progress_pct,
        COALESCE(i.open_count, 0)::int AS open_issues,
        (
          SELECT COUNT(*)::int
          FROM jsonb_object_keys(dp.checklist) k
          WHERE (dp.checklist ->> k)::boolean IS TRUE
        ) AS checklist_done,
        COALESCE(wl.total_hours, 0)::numeric(10, 2) AS hours,
        dp.target_date AS target_date
      FROM public.design_projects dp
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'Completed')::int AS done
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
      LEFT JOIN LATERAL (
        SELECT SUM(hours)::numeric AS total_hours
        FROM public.design_work_log
        WHERE design_project_id = dp.id AND deleted_at IS NULL
      ) wl ON true
      WHERE dp.company_id = ${companyId}::uuid
        AND dp.deleted_at IS NULL
        ${statusFrag}
      ORDER BY dp.created_at DESC
      LIMIT 1000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      project_no: String(r['project_no'] ?? ''),
      project_name: String(r['project_name'] ?? ''),
      client: String(r['client'] ?? ''),
      status: String(r['status'] ?? ''),
      lead: String(r['lead'] ?? ''),
      tasks: `${Number(r['task_done'] ?? 0)}/${Number(r['task_total'] ?? 0)}`,
      progress_pct: `${Number(r['progress_pct'] ?? 0)}%`,
      open_issues: Number(r['open_issues'] ?? 0),
      checklist: `${Number(r['checklist_done'] ?? 0)}/${CHECKLIST_TOTAL}`,
      hours: Number(r['hours'] ?? 0),
      target:
        r['target_date'] instanceof Date
          ? r['target_date'].toISOString().slice(0, 10)
          : r['target_date'] != null
            ? String(r['target_date'])
            : null,
    }));

    return { columns: designProjectSummaryReport.definition.columns, rows };
  },
};
