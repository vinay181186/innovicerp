// ADR-264 phase 2 — Design checks. Each "still open" rule is the ONE fragment
// in lib/design-status.ts (the Design screens read the same words):
//   des_bom_pending — personal/rows-planning.ts bomPendingSql as is (equipment
//                     SO with no BOM / BOM Pending), dated by its first line
//                     Due Date.
//   des_projects    — design project not Released / On Hold
//                     (designProjectOpenSql), by Target Date.
//   des_tracker     — design tracker item not Approved
//                     (designTrackerPendingSql), by Target Date. The document
//                     column is the item (the tracker row has no number of its
//                     own on screen); reference = Designer.
//   des_issues      — design issue Open / In Progress (designIssueOpenSql),
//                     by Raised Date (age — an issue has no deadline). An issue
//                     has no number: the document column is its title.
//   des_dcr         — DCR Submitted / Under Review (designDcrPendingSql), by
//                     Request Date (age).
// Issues and DCRs have no page of their own: they open on their project.

import { docNavPage } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import {
  designDcrPendingSql,
  designIssueOpenSql,
  designProjectOpenSql,
  designTrackerPendingSql,
} from '../../../lib/design-status';
import type { RawRow } from '../personal/list-query';
import { bomPendingSql } from '../personal/rows-planning';
import type { CheckCtx, CheckDef } from './types';

export function designProjectsSql(c: CheckCtx): SQL {
  return sql`
    SELECT dp.id::text AS row_key, dp.id, dp.code, 'design_project'::text AS kind,
           dp.start_date::text AS doc_date, dp.target_date::text AS due_date,
           COALESCE(dp.target_date, dp.start_date)::text AS sort_key,
           COALESCE(cl.name, dp.client_text)::text AS party,
           NULL::text AS item_code, dp.project_name::text AS item_name,
           NULL::numeric AS qty, NULL::text AS uom, NULL::numeric AS amount,
           dp.created_by::text AS created_by,
           (CASE WHEN dp.target_date < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
           dp.status::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.design_projects dp
    LEFT JOIN public.clients cl ON cl.id = dp.client_id AND cl.deleted_at IS NULL
    WHERE dp.company_id = ${c.cid}::uuid AND dp.deleted_at IS NULL
      AND ${designProjectOpenSql('dp')}`;
}

export function designTrackerSql(c: CheckCtx): SQL {
  return sql`
    SELECT dt.id::text AS row_key, dt.id,
           COALESCE(i.code, dt.item_code_text, dt.code)::text AS code, 'design_tracker'::text AS kind,
           dt.start_date::text AS doc_date, dt.target_date::text AS due_date,
           COALESCE(dt.target_date, dt.start_date)::text AS sort_key,
           NULL::text AS party,
           COALESCE(i.code, dt.item_code_text)::text AS item_code,
           COALESCE(dt.item_name_text, i.name)::text AS item_name,
           NULL::numeric AS qty, NULL::text AS uom, NULL::numeric AS amount,
           dt.created_by::text AS created_by,
           (CASE WHEN dt.target_date < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
           NULLIF(btrim(dt.designer), '')::text AS x1, dt.code::text AS x2, dt.status::text AS x3
    FROM public.design_tracker dt
    LEFT JOIN public.items i ON i.id = dt.item_id
    WHERE dt.company_id = ${c.cid}::uuid AND dt.deleted_at IS NULL
      AND ${designTrackerPendingSql('dt')}`;
}

export function designIssuesSql(c: CheckCtx): SQL {
  return sql`
    SELECT di.id::text AS row_key, di.id, di.title::text AS code, 'design_issue'::text AS kind,
           di.raised_date::text AS doc_date, NULL::text AS due_date,
           di.raised_date::text AS sort_key,
           NULL::text AS party,
           NULL::text AS item_code, NULLIF(btrim(di.part_text), '')::text AS item_name,
           NULL::numeric AS qty, NULL::text AS uom, NULL::numeric AS amount,
           di.created_by::text AS created_by, 0::int AS is_late,
           dp.id::text AS x1, dp.code::text AS x2, di.status::text AS x3
    FROM public.design_issues di
    LEFT JOIN public.design_projects dp
      ON dp.id = di.design_project_id AND dp.deleted_at IS NULL
    WHERE di.company_id = ${c.cid}::uuid AND di.deleted_at IS NULL
      AND ${designIssueOpenSql('di')}`;
}

export function designDcrsSql(c: CheckCtx): SQL {
  return sql`
    SELECT dcr.id::text AS row_key, dcr.id, dcr.code, 'design_dcr'::text AS kind,
           dcr.request_date::text AS doc_date, NULL::text AS due_date,
           dcr.request_date::text AS sort_key,
           NULL::text AS party,
           NULL::text AS item_code, dcr.title::text AS item_name,
           NULL::numeric AS qty, NULL::text AS uom, NULL::numeric AS amount,
           dcr.created_by::text AS created_by, 0::int AS is_late,
           dp.id::text AS x1, dp.code::text AS x2, dcr.status::text AS x3
    FROM public.design_dcrs dcr
    LEFT JOIN public.design_projects dp
      ON dp.id = dcr.design_project_id AND dp.deleted_at IS NULL
    WHERE dcr.company_id = ${c.cid}::uuid AND dcr.deleted_at IS NULL
      AND ${designDcrPendingSql('dcr')}`;
}

/** The project page of an issue / DCR row (x1 = project id). */
const projectHref = (r: RawRow): string =>
  r.x1 ? docNavPage('design-project', r.x1) : '/design-projects';

export const DESIGN_CHECKS: readonly CheckDef[] = [
  {
    key: 'des_bom_pending',
    dept: 'design',
    label: 'Equipment SO waiting BOM',
    head: ['SO No.', 'Customer', 'Due Date'],
    href: '/bom-masters',
    query: (c) => bomPendingSql(c.cid, c.today, {}),
    docHref: (r) => docNavPage('sales-order', r.id),
    dated: true,
  },
  {
    key: 'des_projects',
    dept: 'design',
    label: 'Design projects open / overdue',
    head: ['Project No.', 'Customer', 'Target Date'],
    href: '/design-projects',
    query: designProjectsSql,
    docHref: (r) => docNavPage('design-project', r.id),
    dated: true,
    noQty: true,
  },
  {
    key: 'des_tracker',
    dept: 'design',
    label: 'Design tracker items pending',
    head: ['Item', 'Designer', 'Target Date'],
    href: '/design-tracker',
    query: designTrackerSql,
    docHref: (r) => `/design-tracker?search=${encodeURIComponent(r.x2 ?? r.code)}`,
    refCode: (r) => r.x1,
    dated: true,
    noQty: true,
  },
  {
    key: 'des_issues',
    dept: 'design',
    label: 'Design issues open',
    head: ['Issue', 'Project', 'Raised Date'],
    href: '/design-issues',
    query: designIssuesSql,
    docHref: projectHref,
    refCode: (r) => r.x2,
    refHref: (r) => (r.x1 ? docNavPage('design-project', r.x1) : null),
    dated: false,
    noQty: true,
  },
  {
    key: 'des_dcr',
    dept: 'design',
    label: 'DCR waiting review',
    head: ['DCR No.', 'Project', 'Request Date'],
    href: '/design-projects',
    query: designDcrsSql,
    docHref: projectHref,
    refCode: (r) => r.x2,
    refHref: (r) => (r.x1 ? docNavPage('design-project', r.x1) : null),
    dated: false,
    noQty: true,
  },
];
