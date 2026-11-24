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
import { createdKey } from '../../../lib/list-order';
import type { RawRow } from '../personal/list-query';
import { bomPendingSql } from '../personal/rows-planning';
import { nextStep } from './next-step';
import type { CheckCtx, CheckDef } from './types';

export function designProjectsSql(c: CheckCtx): SQL {
  return sql`
    SELECT dp.id::text AS row_key, dp.id, dp.code, 'design_project'::text AS kind,
           dp.start_date::text AS doc_date, dp.target_date::text AS due_date,
           ${createdKey('dp.created_at')} AS sort_key,
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
           ${createdKey('dt.created_at')} AS sort_key,
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
           ${createdKey('di.created_at')} AS sort_key,
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
           ${createdKey('dcr.created_at')} AS sort_key,
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

// ── ADR-317 — Drawing Register checks. The Drawing Rev statuses are the SAME
// ones Home › Approvals reads (approvals/waiting-drawings.ts). A Rev row opens
// the drawing page (/drawings/<item_revision_id>), whose buttons follow the
// reader's rights; an order row opens its SO / JWSO.

/** IST date of a timestamp expression, as text. */
const istDate = (col: string): SQL => sql.raw(`((${col}) AT TIME ZONE 'Asia/Kolkata')::date::text`);

/** Order (header or line) statuses that are not open work for Design: done,
 *  cancelled, or still a draft that cannot be planned yet. */
const NOT_OPEN = sql`('closed', 'dispatched', 'cancelled', 'draft')`;

/** Every live SO / JWSO line on Rev `ir` (alias o: code, created_at, is_open,
 *  due_date). */
const linesOnRev = sql`
    SELECT h.code, h.created_at, l.due_date,
           (h.status::text NOT IN ${NOT_OPEN} AND l.status::text NOT IN ${NOT_OPEN}) AS is_open
      FROM public.sales_order_lines l
      JOIN public.sales_orders h ON h.id = l.sales_order_id
     WHERE l.item_revision_id = ir.id AND l.deleted_at IS NULL AND h.deleted_at IS NULL
    UNION ALL
    SELECT h.code, h.created_at, l.due_date,
           (h.status::text NOT IN ${NOT_OPEN} AND l.status::text NOT IN ${NOT_OPEN})
      FROM public.job_work_order_lines l
      JOIN public.job_work_orders h ON h.id = l.job_work_order_id
     WHERE l.item_revision_id = ir.id AND l.deleted_at IS NULL AND h.deleted_at IS NULL`;

/** The order to show beside a Rev: an open one first, then the newest. */
const firstOrderSql = sql`(
  SELECT o.code FROM (${linesOnRev}) o
   ORDER BY o.is_open DESC, o.created_at DESC, o.code LIMIT 1)`;

/** One Drawing Rev per row in `status`, dated by `dateCol` (age). */
function revRowsSql(c: CheckCtx, status: string, dateCol: string, byCol: string): SQL {
  return sql`
    SELECT ir.id::text AS row_key, ir.id, (i.code || '/' || ir.rev)::text AS code,
           'item_revision'::text AS kind,
           ${istDate(dateCol)} AS doc_date, NULL::text AS due_date,
           ${createdKey('ir.created_at')} AS sort_key,
           NULL::text AS party, i.code::text AS item_code, i.name::text AS item_name,
           NULL::numeric AS qty, NULL::text AS uom, NULL::numeric AS amount,
           (${sql.raw(byCol)})::text AS created_by, 0::int AS is_late,
           ${firstOrderSql}::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.item_revisions ir
    JOIN public.items i ON i.id = ir.item_id
    WHERE ir.company_id = ${c.cid}::uuid AND ir.deleted_at IS NULL
      AND ir.release_status = ${status}`;
}

export const revReviewSql = (c: CheckCtx): SQL =>
  revRowsSql(
    c,
    'under_review',
    'COALESCE(ir.submitted_at, ir.updated_at)',
    'COALESCE(ir.submitted_by, ir.created_by)',
  );

export const revReleaseSql = (c: CheckCtx): SQL =>
  revRowsSql(
    c,
    'approved',
    'COALESCE(ir.approved_at, ir.updated_at)',
    'COALESCE(ir.approved_by, ir.created_by)',
  );

/** Pending corrections — the same rows Approvals lists (no Rev deleted_at
 *  filter there either). */
export function revCorrectionSql(c: CheckCtx): SQL {
  return sql`
    SELECT dc.id::text AS row_key, ir.id, (i.code || '/' || ir.rev)::text AS code,
           'drawing_correction'::text AS kind,
           ${istDate('dc.created_at')} AS doc_date, NULL::text AS due_date,
           ${createdKey('dc.created_at')} AS sort_key,
           NULL::text AS party, i.code::text AS item_code, i.name::text AS item_name,
           NULL::numeric AS qty, NULL::text AS uom, NULL::numeric AS amount,
           dc.requested_by::text AS created_by, 0::int AS is_late,
           dc.reason::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.drawing_corrections dc
    JOIN public.item_revisions ir ON ir.id = dc.item_revision_id
    JOIN public.items i ON i.id = ir.item_id
    WHERE dc.company_id = ${c.cid}::uuid AND dc.deleted_at IS NULL AND dc.status = 'pending'`;
}

/** "Order lines blocked by drawing": one row per OPEN SO / JWSO line whose Rev
 *  blocks a new Plan / PRO / Job Card and waits on Design (Not released, Under
 *  Review, Approved, Rejected — obsolete left out: that one needs a new Rev).
 *  The order number opens the order (x2 = order id, x3 = 'so' | 'jw'); the
 *  Drawing Rev opens the drawing page (id). Kept out of the Design badge: the
 *  same Revs are already counted by the two Rev checks. */
export function revBlockingSql(c: CheckCtx): SQL {
  const st = sql`('draft', 'under_review', 'approved', 'rejected')`;
  return sql`
    SELECT x.* FROM (
      SELECT l.id::text AS row_key, ir.id, h.code::text AS code, 'so_line'::text AS kind,
             ${istDate('h.created_at')} AS doc_date, l.due_date::text AS due_date,
             ${createdKey('h.created_at')} AS sort_key,
             NULL::text AS party, i.code::text AS item_code, i.name::text AS item_name,
             l.order_qty AS qty, l.uom::text AS uom, NULL::numeric AS amount,
             h.created_by::text AS created_by,
             (CASE WHEN l.due_date < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
             (i.code || '/' || ir.rev)::text AS x1, h.id::text AS x2, 'so'::text AS x3
        FROM public.sales_order_lines l
        JOIN public.sales_orders h ON h.id = l.sales_order_id
        JOIN public.item_revisions ir ON ir.id = l.item_revision_id AND ir.deleted_at IS NULL
        JOIN public.items i ON i.id = ir.item_id
       WHERE h.company_id = ${c.cid}::uuid AND l.deleted_at IS NULL AND h.deleted_at IS NULL
         AND h.status::text NOT IN ${NOT_OPEN} AND l.status::text NOT IN ${NOT_OPEN}
         AND ir.release_status IN ${st}
      UNION ALL
      SELECT l.id::text, ir.id, h.code::text, 'jw_line'::text,
             ${istDate('h.created_at')}, l.due_date::text,
             ${createdKey('h.created_at')},
             NULL::text, i.code::text, i.name::text,
             l.order_qty, l.uom::text, NULL::numeric,
             h.created_by::text,
             (CASE WHEN l.due_date < ${c.today}::date THEN 1 ELSE 0 END)::int,
             (i.code || '/' || ir.rev)::text, h.id::text, 'jw'::text
        FROM public.job_work_order_lines l
        JOIN public.job_work_orders h ON h.id = l.job_work_order_id
        JOIN public.item_revisions ir ON ir.id = l.item_revision_id AND ir.deleted_at IS NULL
        JOIN public.items i ON i.id = ir.item_id
       WHERE h.company_id = ${c.cid}::uuid AND l.deleted_at IS NULL AND h.deleted_at IS NULL
         AND h.status::text NOT IN ${NOT_OPEN} AND l.status::text NOT IN ${NOT_OPEN}
         AND ir.release_status IN ${st}
    ) x`;
}

/** "Old drawings to verify": one row per Unverified Rev that has at least one
 *  OPEN SO / JWSO line, dated by that work's earliest Due Date. */
export function revUnverifiedSql(c: CheckCtx): SQL {
  return sql`
    SELECT ir.id::text AS row_key, ir.id, (i.code || '/' || ir.rev)::text AS code,
           'item_revision'::text AS kind,
           ${istDate('ir.created_at')} AS doc_date, w.due::text AS due_date,
           ${createdKey('ir.created_at')} AS sort_key,
           NULL::text AS party, i.code::text AS item_code, i.name::text AS item_name,
           NULL::numeric AS qty, NULL::text AS uom, NULL::numeric AS amount,
           ir.created_by::text AS created_by,
           (CASE WHEN w.due < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
           ${firstOrderSql}::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.item_revisions ir
    JOIN public.items i ON i.id = ir.item_id
    JOIN LATERAL (
      SELECT MIN(o.due_date) AS due, bool_or(o.is_open) AS any_open
        FROM (${linesOnRev}) o WHERE o.is_open) w ON w.any_open
    WHERE ir.company_id = ${c.cid}::uuid AND ir.deleted_at IS NULL
      AND ir.release_status = 'unverified'`;
}

/** The drawing page of a Drawing Rev row (id = item_revision id). */
const drawingHref = (r: RawRow): string => `/drawings/${r.id}`;

/** The SO / JWSO page of an order-line row (x2 = order id, x3 = kind). */
const orderHref = (r: RawRow): string =>
  r.x2 ? docNavPage(r.x3 === 'jw' ? 'job-work-order' : 'sales-order', r.x2) : drawingHref(r);

export const DESIGN_CHECKS: readonly CheckDef[] = [
  {
    key: 'des_bom_pending',
    dept: 'design',
    label: 'Equipment SO waiting BOM',
    head: ['SO No.', 'Customer', 'Due Date'],
    href: '/bom-masters',
    query: (c) => bomPendingSql(c.cid, c.today, {}),
    docHref: (r) => docNavPage('sales-order', r.id),
    // ADR-312: New BOM for that SO.
    actionHref: nextStep('bom_create', 'entry', (r) => `/bom-masters/new?soId=${r.id}`),
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
  // ADR-317 — Drawing Register.
  {
    key: 'des_rev_review',
    dept: 'design',
    label: 'Drawing Revs waiting approval',
    head: ['Drawing Rev', 'SO No.', 'Sent for Review On'],
    href: '/drawing-register',
    query: revReviewSql,
    docHref: drawingHref,
    refCode: (r) => r.x1,
    dated: false,
    noQty: true,
  },
  {
    key: 'des_rev_release',
    dept: 'design',
    label: 'Drawing Revs waiting release',
    head: ['Drawing Rev', 'SO No.', 'Drawing Approved On'],
    href: '/drawing-register',
    query: revReleaseSql,
    docHref: drawingHref,
    refCode: (r) => r.x1,
    dated: false,
    noQty: true,
  },
  {
    key: 'des_rev_correction',
    dept: 'design',
    label: 'Drawing corrections waiting',
    head: ['Drawing Rev', 'Correction Reason', 'Correction Asked On'],
    href: '/drawing-register',
    query: revCorrectionSql,
    docHref: drawingHref,
    refCode: (r) => r.x1,
    dated: false,
    noQty: true,
  },
  {
    key: 'des_rev_blocking',
    dept: 'design',
    label: 'Order lines blocked by drawing',
    head: ['SO No.', 'Drawing Rev', 'Due Date'],
    href: '/drawing-register',
    query: revBlockingSql,
    docHref: orderHref,
    refCode: (r) => r.x1,
    refHref: drawingHref,
    dated: true,
  },
  {
    key: 'des_rev_unverified',
    dept: 'design',
    label: 'Old drawings to verify',
    head: ['Drawing Rev', 'SO No.', 'Due Date'],
    href: '/drawing-register',
    query: revUnverifiedSql,
    docHref: drawingHref,
    refCode: (r) => r.x1,
    dated: true,
    noQty: true,
  },
];
