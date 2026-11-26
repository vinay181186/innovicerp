// ADR-291 — reads of one Engineering Change (ECR): the header row (also locked
// FOR UPDATE by the writers), its impacts and approvals, mapped to the shared
// contract (packages/shared/src/schemas/engineering-change.ts).

import {
  type Ecr,
  type EcrApproval,
  type EcrApproverRole,
  type EcrClassification,
  type EcrCustomerApproval,
  type EcrDisposition,
  type EcrImpact,
  type EcrStatus,
  itemRevLabel,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { NotFoundError } from '../../lib/errors';
import { revStatusSql } from '../../lib/item-revision';

/** The header joins (aliases e, i, fr, tr, ri, cu) — list, detail and the
 *  Sort & Filter map (sf-columns.ts) all read these. */
export const ECR_FROM = sql`
  FROM public.engineering_changes e
  JOIN public.items i ON i.id = e.item_id
  JOIN public.item_revisions fr ON fr.id = e.from_item_revision_id
  LEFT JOIN public.item_revisions tr ON tr.id = e.to_item_revision_id
  LEFT JOIN public.items ri ON ri.id = e.replacement_item_id
  LEFT JOIN public.users cu ON cu.id = e.created_by`;

export const ECR_COLS = sql`
  e.id, e.code, e.status, e.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
  e.from_item_revision_id AS "fromItemRevisionId", fr.rev AS "fromRev",
  e.to_item_revision_id AS "toItemRevisionId", tr.rev AS "toRev",
  ${revStatusSql('tr.release_status')} AS "toReleaseStatus",
  e.replacement_item_id AS "replacementItemId", ri.code AS "replacementItemCode",
  e.classification, e.description, e.customer_approval AS "customerApproval",
  e.customer_approval_ref AS "customerApprovalRef",
  e.created_at AS "createdAt", e.created_by AS "createdBy",
  CASE WHEN cu.id IS NULL THEN NULL
       ELSE COALESCE(NULLIF(btrim(cu.full_name), ''), split_part(cu.email, '@', 1)) END AS "createdByName",
  e.updated_at AS "updatedAt", e.updated_by AS "updatedBy",
  e.submitted_by AS "submittedBy", e.submitted_at AS "submittedAt",
  e.approved_at AS "approvedAt", e.rejected_by AS "rejectedBy", e.rejected_at AS "rejectedAt",
  e.implemented_by AS "implementedBy", e.implemented_at AS "implementedAt",
  e.closed_by AS "closedBy", e.closed_at AS "closedAt",
  e.cancelled_by AS "cancelledBy", e.cancelled_at AS "cancelledAt"`;

export interface EcrRow {
  id: string;
  code: string;
  status: EcrStatus;
  itemId: string;
  itemCode: string | null;
  itemName: string | null;
  fromItemRevisionId: string;
  fromRev: string;
  toItemRevisionId: string | null;
  toRev: string | null;
  toReleaseStatus: string | null;
  replacementItemId: string | null;
  replacementItemCode: string | null;
  classification: EcrClassification;
  description: string;
  customerApproval: EcrCustomerApproval;
  customerApprovalRef: string | null;
  createdAt: Date;
  createdBy: string | null;
  createdByName: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  submittedBy: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  implementedBy: string | null;
  implementedAt: Date | null;
  closedBy: string | null;
  closedAt: Date | null;
  cancelledBy: string | null;
  cancelledAt: Date | null;
}

const ts = (v: unknown): Date | null =>
  v == null ? null : v instanceof Date ? v : new Date(String(v));
export const iso = (v: unknown): string => (ts(v) ?? new Date(0)).toISOString();

export function toEcrRow(r: Record<string, unknown>): EcrRow {
  const row = r as unknown as EcrRow;
  return {
    ...row,
    createdAt: ts(r['createdAt'])!,
    updatedAt: ts(r['updatedAt'])!,
    submittedAt: ts(r['submittedAt']),
    approvedAt: ts(r['approvedAt']),
    rejectedAt: ts(r['rejectedAt']),
    implementedAt: ts(r['implementedAt']),
    closedAt: ts(r['closedAt']),
    cancelledAt: ts(r['cancelledAt']),
  };
}

/** One ECR header; `lock` = FOR UPDATE OF e (every writer locks it first). */
export async function readEcrRow(
  tx: DbTransaction,
  companyId: string,
  id: string,
  lock = false,
): Promise<EcrRow> {
  const rows = (await tx.execute(sql`
    SELECT ${ECR_COLS} ${ECR_FROM}
     WHERE e.id = ${id}::uuid AND e.company_id = ${companyId}::uuid AND e.deleted_at IS NULL
     LIMIT 1 ${lock ? sql`FOR UPDATE OF e` : sql``}`)) as unknown as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) throw new NotFoundError('Engineering Change not found. Refresh the page.');
  return toEcrRow(r);
}

export const fromLabelOf = (e: EcrRow): string => itemRevLabel(e.itemCode, e.fromRev);
export const toLabelOf = (e: EcrRow): string | null =>
  e.toRev ? itemRevLabel(e.itemCode, e.toRev) : null;

/** The header in contract shape (no impacts / approvals). */
export function headerOf(e: EcrRow): Omit<Ecr, 'impacts' | 'approvals'> {
  return {
    id: e.id,
    code: e.code,
    status: e.status,
    itemId: e.itemId,
    itemCode: e.itemCode,
    itemName: e.itemName,
    fromItemRevisionId: e.fromItemRevisionId,
    fromLabel: fromLabelOf(e),
    toItemRevisionId: e.toItemRevisionId,
    toLabel: toLabelOf(e),
    toReleaseStatus: e.toReleaseStatus,
    replacementItemId: e.replacementItemId,
    replacementItemCode: e.replacementItemCode,
    classification: e.classification,
    description: e.description,
    customerApproval: e.customerApproval,
    customerApprovalRef: e.customerApprovalRef,
    createdAt: e.createdAt.toISOString(),
    createdBy: e.createdBy,
    createdByName: e.createdByName,
    submittedBy: e.submittedBy,
    updatedAt: e.updatedAt.toISOString(),
  };
}

export async function readImpacts(tx: DbTransaction, ecrId: string): Promise<EcrImpact[]> {
  const rows = (await tx.execute(sql`
    SELECT m.id, m.doc_type AS "docType",
           COALESCE(m.so_line_id, m.jw_line_id, m.job_card_id) AS "docId",
           m.label, m.qty_done AS "qtyDone", m.qty_wip AS "qtyWip",
           m.qty_not_started AS "qtyNotStarted", m.qty_stock AS "qtyStock",
           m.disposition, m.move_qty AS "moveQty", m.note,
           CASE WHEN m.job_card_id IS NULL THEN 0 ELSE (
             SELECT COUNT(*) FROM public.jc_ops o
              WHERE o.job_card_id = m.job_card_id AND o.hold_ecr_id = m.ecr_id
                AND o.deleted_at IS NULL) END::int AS "heldOps",
           NULLIF(concat_ws(' / ', npo.code, njc.code), '') AS "newDocLabel",
           m.new_job_card_id AS "newJobCardId"
      FROM public.engineering_change_impacts m
      LEFT JOIN public.production_orders npo ON npo.id = m.new_production_order_id
      LEFT JOIN public.job_cards njc ON njc.id = m.new_job_card_id
     WHERE m.ecr_id = ${ecrId}::uuid AND m.deleted_at IS NULL
     ORDER BY CASE m.doc_type WHEN 'so_line' THEN 1 WHEN 'jw_line' THEN 2
                              WHEN 'job_card' THEN 3 ELSE 4 END, m.label`)) as unknown as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => ({
    id: r['id'] as string,
    docType: r['docType'] as EcrImpact['docType'],
    docId: (r['docId'] as string | null) ?? null,
    label: r['label'] as string,
    qtyDone: Number(r['qtyDone'] ?? 0),
    qtyWip: Number(r['qtyWip'] ?? 0),
    qtyNotStarted: Number(r['qtyNotStarted'] ?? 0),
    qtyStock: Number(r['qtyStock'] ?? 0),
    disposition: (r['disposition'] as EcrDisposition | null) ?? null,
    moveQty: Number(r['moveQty'] ?? 0),
    heldOps: Number(r['heldOps'] ?? 0),
    note: (r['note'] as string | null) ?? null,
    newDocLabel: (r['newDocLabel'] as string | null) ?? null,
    newJobCardId: (r['newJobCardId'] as string | null) ?? null,
  }));
}

export async function readApprovals(tx: DbTransaction, ecrId: string): Promise<EcrApproval[]> {
  const rows = (await tx.execute(sql`
    SELECT a.role, a.decision, a.decided_by AS "decidedBy", a.decided_at AS "decidedAt", a.note,
           COALESCE(NULLIF(btrim(u.full_name), ''), split_part(u.email, '@', 1)) AS "decidedByName"
      FROM public.engineering_change_approvals a
      LEFT JOIN public.users u ON u.id = a.decided_by
     WHERE a.ecr_id = ${ecrId}::uuid AND a.deleted_at IS NULL
     ORDER BY a.decided_at`)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    role: r['role'] as EcrApproverRole,
    decision: r['decision'] as 'approved' | 'rejected',
    decidedBy: r['decidedBy'] as string,
    decidedByName: (r['decidedByName'] as string | null) ?? null,
    decidedAt: iso(r['decidedAt']),
    note: (r['note'] as string | null) ?? null,
  }));
}

export async function readEcrDetail(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<Ecr> {
  const e = await readEcrRow(tx, companyId, id);
  return {
    ...headerOf(e),
    impacts: await readImpacts(tx, id),
    approvals: await readApprovals(tx, id),
  };
}

/** `WHERE status = <expected>` + same updated_at (ms) as loaded — §20.2/20.4. */
export function sameVersion(e: EcrRow): SQL {
  return sql`date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${e.updatedAt.toISOString()}::timestamptz)`;
}
