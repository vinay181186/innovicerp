// Sort & Filter (ADR-200) — the Engineering Change (ECR) list's sortable /
// filterable fields (ADR-291). Each expression is the SAME one listEcrs
// SELECTs (aliases e, i, fr, tr, ri, cu — service.ts ECR_FROM).

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const ECR_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`e.code`, type: 'text' },
  status: { sql: sql`e.status`, type: 'list' },
  itemCode: { sql: sql`i.code`, type: 'text' },
  itemName: { sql: sql`i.name`, type: 'text' },
  fromLabel: { sql: sql`(i.code || '/' || fr.rev)`, type: 'text' },
  toLabel: { sql: sql`(i.code || '/' || tr.rev)`, type: 'text' },
  classification: { sql: sql`e.classification`, type: 'list' },
  customerApproval: { sql: sql`e.customer_approval`, type: 'list' },
  description: { sql: sql`e.description`, type: 'text' },
  approvalsDone: {
    sql: sql`(SELECT COUNT(*) FROM public.engineering_change_approvals a
               WHERE a.ecr_id = e.id AND a.deleted_at IS NULL AND a.decision = 'approved')`,
    type: 'num',
  },
  heldOps: {
    sql: sql`(SELECT COUNT(*) FROM public.jc_ops o
               WHERE o.hold_ecr_id = e.id AND o.deleted_at IS NULL)`,
    type: 'num',
  },
  createdByName: {
    sql: sql`COALESCE(NULLIF(btrim(cu.full_name), ''), split_part(cu.email, '@', 1))`,
    type: 'text',
  },
  createdAt: {
    sql: sql`(e.created_at AT TIME ZONE 'Asia/Kolkata')::date`,
    sortSql: sql`e.created_at`,
    type: 'date',
  },
  updatedAt: {
    sql: sql`(e.updated_at AT TIME ZONE 'Asia/Kolkata')::date`,
    sortSql: sql`e.updated_at`,
    type: 'date',
  },
};
