// ADR-292 report 5 — Engineering Changes not yet implemented (Waiting
// Approval / Approved): which of the three sign-offs are done and which are
// missing, and how many operations the ECR holds.

import {
  ECR_APPROVER_ROLE_LABELS,
  ECR_APPROVER_ROLES,
  ECR_CLASSIFICATION_LABELS,
  ECR_STATUS_LABELS,
  type EcrApproverRole,
  type EcrClassification,
  type EcrStatus,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { dateCell, numCell, REPORT_ROW_CAP, textCell, type SqlRow } from './report-helpers';

export const pendingEcrReport: RegisteredReport = {
  definition: {
    slug: 'pending-ecr',
    title: 'Pending Engineering Changes',
    description:
      'Engineering Changes waiting approval or approved but not implemented: approvals done and missing, and the operations held.',
    group: 'Design',
    dept: 'design',
    filters: [],
    columns: [
      { key: 'ecr_code', label: 'ECR No.', type: 'text' },
      { key: 'ecr_status', label: 'ECR Status', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'from_rev', label: 'From Rev', type: 'text' },
      { key: 'to_rev', label: 'To Rev', type: 'text' },
      { key: 'classification', label: 'Change Type', type: 'text' },
      { key: 'raised_on', label: 'Raised On', type: 'date' },
      { key: 'raised_by', label: 'Raised By', type: 'text' },
      { key: 'approvals_done', label: 'Approvals Done', type: 'text' },
      { key: 'approvals_missing', label: 'Approvals Missing', type: 'text' },
      { key: 'held_ops', label: 'Held Ops', type: 'number' },
      { key: 'age_days', label: 'Age (days)', type: 'number' },
    ],
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT e.code AS ecr_code, e.status, i.code AS item_code, fr.rev AS from_rev, tr.rev AS to_rev,
             e.classification,
             (e.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS raised_on,
             COALESCE(NULLIF(btrim(u.full_name), ''), split_part(u.email, '@', 1)) AS raised_by,
             ARRAY(SELECT a.role FROM public.engineering_change_approvals a
                    WHERE a.ecr_id = e.id AND a.deleted_at IS NULL AND a.decision = 'approved'
                    ORDER BY a.role) AS roles_done,
             (SELECT COUNT(*) FROM public.jc_ops o
               WHERE o.hold_ecr_id = e.id AND o.hold_kind IS NOT NULL AND o.deleted_at IS NULL)::int AS held_ops,
             GREATEST(0, CURRENT_DATE - (e.created_at AT TIME ZONE 'Asia/Kolkata')::date)::int AS age_days
        FROM public.engineering_changes e
        JOIN public.items i ON i.id = e.item_id
        JOIN public.item_revisions fr ON fr.id = e.from_item_revision_id
        LEFT JOIN public.item_revisions tr ON tr.id = e.to_item_revision_id
        LEFT JOIN public.users u ON u.id = e.created_by
       WHERE e.company_id = ${companyId}::uuid AND e.deleted_at IS NULL
         AND e.status IN ('submitted', 'approved')
       ORDER BY e.created_at, e.code
       LIMIT ${REPORT_ROW_CAP}`);
    const rows = (result as unknown as SqlRow[]).map((r) => {
      const done = (r['roles_done'] as EcrApproverRole[] | null) ?? [];
      const missing = ECR_APPROVER_ROLES.filter((x) => !done.includes(x));
      return {
        ecr_code: textCell(r['ecr_code']),
        ecr_status: ECR_STATUS_LABELS[r['status'] as EcrStatus] ?? textCell(r['status']),
        item_code: textCell(r['item_code']),
        from_rev: textCell(r['from_rev']),
        to_rev: textCell(r['to_rev']),
        classification:
          ECR_CLASSIFICATION_LABELS[r['classification'] as EcrClassification] ??
          textCell(r['classification']),
        raised_on: dateCell(r['raised_on']),
        raised_by: textCell(r['raised_by']),
        approvals_done: done.map((x) => ECR_APPROVER_ROLE_LABELS[x] ?? x).join(', ') || null,
        approvals_missing: missing.map((x) => ECR_APPROVER_ROLE_LABELS[x]).join(', ') || null,
        held_ops: numCell(r['held_ops']),
        age_days: numCell(r['age_days']),
      };
    });
    return { columns: pendingEcrReport.definition.columns, rows };
  },
};
