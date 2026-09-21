// "Related To" picker for the standalone Assign Task form (ADR-176).
// GET /tasks/related-options?type=&search= → up to 25 {id, code, hint}
// rows of the chosen document kind, company-scoped, soft-deletes excluded,
// code ILIKE %search%, newest code first.
//
// The chosen option is stored on the task as linked_ref_{type,id,display}
// — the same free-text link the contextual Assign buttons already write —
// so this file only has to READ; nothing here mutates.

import type { RelatedOptionsQuery, TaskRelatedOption } from '@innovic/shared';
import { and, desc, eq, ilike, isNull, sql } from 'drizzle-orm';
import {
  clients,
  designProjects,
  items,
  jobCards,
  ncRegister,
  purchaseOrders,
  salesOrders,
  vendors,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireCompany } from './history';

const LIMIT = 25;

const pattern = (search: string | undefined): string => `%${(search ?? '').trim()}%`;

async function salesOrderOptions(
  tx: DbTransaction,
  companyId: string,
  search: string | undefined,
): Promise<TaskRelatedOption[]> {
  const rows = await tx
    .select({
      id: salesOrders.id,
      code: salesOrders.code,
      customer: salesOrders.customerName,
      client: clients.name,
    })
    .from(salesOrders)
    .leftJoin(clients, eq(clients.id, salesOrders.clientId))
    .where(
      and(
        eq(salesOrders.companyId, companyId),
        isNull(salesOrders.deletedAt),
        ilike(salesOrders.code, pattern(search)),
      ),
    )
    .orderBy(desc(salesOrders.code))
    .limit(LIMIT);
  return rows.map((r) => ({ id: r.id, code: r.code, hint: r.customer ?? r.client ?? null }));
}

async function jobCardOptions(
  tx: DbTransaction,
  companyId: string,
  search: string | undefined,
): Promise<TaskRelatedOption[]> {
  const rows = await tx
    .select({ id: jobCards.id, code: jobCards.code, itemCode: items.code, itemName: items.name })
    .from(jobCards)
    .leftJoin(items, eq(items.id, jobCards.itemId))
    .where(
      and(
        eq(jobCards.companyId, companyId),
        isNull(jobCards.deletedAt),
        ilike(jobCards.code, pattern(search)),
      ),
    )
    .orderBy(desc(jobCards.code))
    .limit(LIMIT);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    hint: r.itemCode ? `${r.itemCode}${r.itemName ? ` — ${r.itemName}` : ''}` : null,
  }));
}

async function purchaseOrderOptions(
  tx: DbTransaction,
  companyId: string,
  search: string | undefined,
): Promise<TaskRelatedOption[]> {
  const rows = await tx
    .select({
      id: purchaseOrders.id,
      code: purchaseOrders.code,
      vendorName: vendors.name,
      vendorCode: purchaseOrders.vendorCodeText,
    })
    .from(purchaseOrders)
    .leftJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .where(
      and(
        eq(purchaseOrders.companyId, companyId),
        isNull(purchaseOrders.deletedAt),
        ilike(purchaseOrders.code, pattern(search)),
      ),
    )
    .orderBy(desc(purchaseOrders.code))
    .limit(LIMIT);
  return rows.map((r) => ({ id: r.id, code: r.code, hint: r.vendorName ?? r.vendorCode ?? null }));
}

async function ncOptions(
  tx: DbTransaction,
  companyId: string,
  search: string | undefined,
): Promise<TaskRelatedOption[]> {
  const rows = await tx
    .select({
      id: ncRegister.id,
      code: ncRegister.code,
      jcCode: jobCards.code,
      itemCode: ncRegister.itemCodeText,
    })
    .from(ncRegister)
    .leftJoin(jobCards, eq(jobCards.id, ncRegister.jobCardId))
    .where(
      and(
        eq(ncRegister.companyId, companyId),
        isNull(ncRegister.deletedAt),
        ilike(ncRegister.code, pattern(search)),
      ),
    )
    .orderBy(desc(ncRegister.code))
    .limit(LIMIT);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    hint: [r.jcCode, r.itemCode].filter(Boolean).join(' · ') || null,
  }));
}

async function designProjectOptions(
  tx: DbTransaction,
  companyId: string,
  search: string | undefined,
): Promise<TaskRelatedOption[]> {
  const rows = await tx
    .select({ id: designProjects.id, code: designProjects.code, name: designProjects.projectName })
    .from(designProjects)
    .where(
      and(
        eq(designProjects.companyId, companyId),
        isNull(designProjects.deletedAt),
        ilike(designProjects.code, pattern(search)),
      ),
    )
    .orderBy(desc(designProjects.code))
    .limit(LIMIT);
  return rows.map((r) => ({ id: r.id, code: r.code, hint: r.name || null }));
}

// QC calls = jc_ops with QC still pending. This is the SAME criterion the
// QC History register uses for its "pending" rows (qc-history/service.ts:
// v_jc_op_status WHERE (qc_required OR op_type = 'qc') AND qc_pending > 0),
// trimmed to the four columns the picker needs. Kept as raw SQL because
// v_jc_op_status is a view, not a Drizzle table. id = the jc_op id, code =
// "JC-code · Op N", hint = operation name.
async function qcCallOptions(
  tx: DbTransaction,
  companyId: string,
  search: string | undefined,
): Promise<TaskRelatedOption[]> {
  const raw = await tx.execute(sql`
    SELECT vos.jc_op_id AS "id", jc.code AS "jcCode", vos.op_seq AS "opSeq", jo.operation
    FROM public.v_jc_op_status vos
    JOIN public.jc_ops jo ON jo.id = vos.jc_op_id AND jo.deleted_at IS NULL
    JOIN public.job_cards jc ON jc.id = vos.job_card_id AND jc.deleted_at IS NULL
    WHERE vos.company_id = ${companyId}::uuid
      AND (vos.qc_required OR vos.op_type = 'qc')
      AND vos.qc_pending > 0
      AND jc.code ILIKE ${pattern(search)}
    ORDER BY jc.code DESC, vos.op_seq DESC
    LIMIT ${LIMIT}
  `);
  const rows = raw as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r['id']),
    code: `${String(r['jcCode'])} · Op ${Number(r['opSeq'])}`,
    hint: (r['operation'] as string | null) ?? null,
  }));
}

export async function listRelatedOptions(
  query: RelatedOptionsQuery,
  user: AuthContext,
): Promise<TaskRelatedOption[]> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    switch (query.type) {
      case 'sales_order':
        return salesOrderOptions(tx, companyId, query.search);
      case 'job_card':
        return jobCardOptions(tx, companyId, query.search);
      case 'purchase_order':
        return purchaseOrderOptions(tx, companyId, query.search);
      case 'nc':
        return ncOptions(tx, companyId, query.search);
      case 'design_project':
        return designProjectOptions(tx, companyId, query.search);
      case 'qc_call':
        return qcCallOptions(tx, companyId, query.search);
    }
  });
}
