// Open issue aging — design issues that are still Open or In Progress,
// sorted oldest-first by raised date so stale items surface. Mirrors the
// third table of legacy `_rptDesign` (HTML L8421–8422).

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

export const designIssueAgingReport: RegisteredReport = {
  definition: {
    slug: 'design-issue-aging',
    title: 'Open Issue Aging',
    description:
      'Design issues with status Open or In Progress, sorted by age (days since raised) descending — stalest items at top.',
    group: 'Design',
    filters: [
      {
        key: 'severity',
        label: 'Severity',
        kind: 'enum',
        options: ['Critical', 'Major', 'Minor'],
      },
    ],
    columns: [
      { key: 'title', label: 'Issue', type: 'text' },
      { key: 'project', label: 'Project', type: 'text' },
      { key: 'severity', label: 'Severity', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'assigned_to', label: 'Assigned To', type: 'text' },
      { key: 'age_days', label: 'Age (days)', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const severity = filters['severity'];
    const sevFrag = severity ? sql`AND di.severity = ${severity}` : sql``;

    const result = await tx.execute(sql`
      SELECT
        di.title AS title,
        COALESCE(dp.project_name, '—') AS project,
        di.severity AS severity,
        di.status AS status,
        COALESCE(di.assigned_to_text, '—') AS assigned_to,
        GREATEST(0, (CURRENT_DATE - di.raised_date))::int AS age_days
      FROM public.design_issues di
      LEFT JOIN public.design_projects dp
        ON dp.id = di.design_project_id
       AND dp.deleted_at IS NULL
      WHERE di.company_id = ${companyId}::uuid
        AND di.deleted_at IS NULL
        AND di.status IN ('Open', 'In Progress')
        ${sevFrag}
      ORDER BY age_days DESC, di.raised_date ASC
      LIMIT 1000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      title: String(r['title'] ?? ''),
      project: String(r['project'] ?? ''),
      severity: String(r['severity'] ?? ''),
      status: String(r['status'] ?? ''),
      assigned_to: String(r['assigned_to'] ?? ''),
      age_days: Number(r['age_days'] ?? 0),
    }));

    return { columns: designIssueAgingReport.definition.columns, rows };
  },
};
