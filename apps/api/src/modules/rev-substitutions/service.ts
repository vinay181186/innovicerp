// ADR-292 — approved Rev substitutions. Engineering (Engineering Change
// Approve tick) allows stock of one Drawing Rev to be used where an SO line /
// JWSO line / Job Card asks for another, up to a qty. Dispatch and Item Issue
// use it through lib/rev-substitution.ts (the one writer of qty_used).
//
//   create   ecr_create approve — both Revs belong to the item; the scope (one
//            SO line / JWSO line / Job Card) is of that item and, when it has a
//            Rev, asks for the `to` Rev
//   list     ecr_create view — 25 rows, search + Sort & Filter
//   cancel   ecr_create approve — only while nothing was used (conditional
//            UPDATE … WHERE qty_used = 0, §20.2); soft delete

import {
  ActivityAction,
  type CreateRevSubstitutionInput,
  itemRevLabel,
  type ListRevSubstitutionsResponse,
  type RevSubstitution,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { emitActivityLog } from '../activity-log/service';
import type { CancelRevSubstitutionInput, ListRevSubstitutionsQuery } from './schema';
import { REV_SUBSTITUTION_SF_COLUMNS } from './sf-columns';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

/** "IN-SO-00012 Ln 1" / "IN-JW-00004 Ln 2" / the JC No. (aliases sl, sh, wl, wh, jc). */
export const SCOPE_LABEL = sql`COALESCE(sh.code || ' Ln ' || sl.line_no, wh.code || ' Ln ' || wl.line_no, jc.code)`;

const FROM = sql`
  FROM public.rev_substitutions rs
  JOIN public.items i ON i.id = rs.item_id
  JOIN public.item_revisions fr ON fr.id = rs.from_item_revision_id
  JOIN public.item_revisions tr ON tr.id = rs.to_item_revision_id
  LEFT JOIN public.users au ON au.id = rs.approved_by
  LEFT JOIN public.sales_order_lines sl ON sl.id = rs.sales_order_line_id
  LEFT JOIN public.sales_orders sh ON sh.id = sl.sales_order_id
  LEFT JOIN public.job_work_order_lines wl ON wl.id = rs.jw_line_id
  LEFT JOIN public.job_work_orders wh ON wh.id = wl.job_work_order_id
  LEFT JOIN public.job_cards jc ON jc.id = rs.job_card_id`;

const SELECT = sql`
  SELECT rs.id, rs.item_id, i.code AS item_code, i.name AS item_name,
         fr.rev AS from_rev, tr.rev AS to_rev, ${SCOPE_LABEL} AS scope_label,
         rs.from_item_revision_id, rs.to_item_revision_id,
         rs.sales_order_line_id, rs.jw_line_id, rs.job_card_id,
         rs.qty_allowed::float8 AS qty_allowed, rs.qty_used::float8 AS qty_used,
         rs.reason, rs.ecr_id, rs.approved_by, rs.approved_at,
         CASE WHEN au.id IS NULL THEN NULL
              ELSE COALESCE(NULLIF(btrim(au.full_name), ''), split_part(au.email, '@', 1)) END
           AS approved_by_name`;

function toRow(r: Record<string, unknown>): RevSubstitution {
  const at = r['approved_at'];
  return {
    id: String(r['id']),
    itemId: String(r['item_id']),
    itemCode: (r['item_code'] as string | null) ?? null,
    itemName: (r['item_name'] as string | null) ?? null,
    scopeLabel: (r['scope_label'] as string | null) ?? null,
    fromItemRevisionId: String(r['from_item_revision_id']),
    fromLabel: itemRevLabel(r['item_code'] as string, r['from_rev'] as string),
    toItemRevisionId: String(r['to_item_revision_id']),
    toLabel: itemRevLabel(r['item_code'] as string, r['to_rev'] as string),
    salesOrderLineId: (r['sales_order_line_id'] as string | null) ?? null,
    jobWorkOrderLineId: (r['jw_line_id'] as string | null) ?? null,
    jobCardId: (r['job_card_id'] as string | null) ?? null,
    qtyAllowed: Number(r['qty_allowed']),
    qtyUsed: Number(r['qty_used']),
    reason: String(r['reason'] ?? ''),
    ecrId: (r['ecr_id'] as string | null) ?? null,
    approvedBy: String(r['approved_by']),
    approvedByName: (r['approved_by_name'] as string | null) ?? null,
    approvedAt: at instanceof Date ? at.toISOString() : String(at),
  };
}

async function readOne(tx: DbTransaction, companyId: string, id: string): Promise<RevSubstitution> {
  const rows = (await tx.execute(sql`
    ${SELECT} ${FROM}
    WHERE rs.id = ${id}::uuid AND rs.company_id = ${companyId}::uuid AND rs.deleted_at IS NULL`)) as unknown as Array<
    Record<string, unknown>
  >;
  if (!rows[0]) throw new NotFoundError('Rev substitution not found');
  return toRow(rows[0]);
}

export async function listRevSubstitutions(
  q: ListRevSubstitutionsQuery,
  user: AuthContext,
): Promise<ListRevSubstitutionsResponse> {
  await requireFormAccess(user, 'ecr_create', 'view');
  const companyId = requireCompany(user);
  const sf = readSf(q.sf);
  const term = q.search?.trim() ? `%${likeEscape(q.search.trim())}%` : null;
  const where = sql`
    WHERE rs.company_id = ${companyId}::uuid AND rs.deleted_at IS NULL
      ${q.itemId ? sql`AND rs.item_id = ${q.itemId}::uuid` : sql``}
      ${q.salesOrderLineId ? sql`AND rs.sales_order_line_id = ${q.salesOrderLineId}::uuid` : sql``}
      ${q.jobCardId ? sql`AND rs.job_card_id = ${q.jobCardId}::uuid` : sql``}
      ${
        term
          ? sql`AND (i.code ILIKE ${term} ESCAPE '\\' OR fr.rev ILIKE ${term} ESCAPE '\\'
                 OR tr.rev ILIKE ${term} ESCAPE '\\' OR rs.reason ILIKE ${term} ESCAPE '\\'
                 OR ${SCOPE_LABEL} ILIKE ${term} ESCAPE '\\')`
          : sql``
      }
      ${sfWhere(REV_SUBSTITUTION_SF_COLUMNS, sf)}`;
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(sql`
      ${SELECT} ${FROM} ${where}
      ORDER BY ${sfOrderBy(REV_SUBSTITUTION_SF_COLUMNS, sf, sql`rs.approved_at DESC, rs.id`)}
      LIMIT ${q.limit} OFFSET ${q.offset}`)) as unknown as Array<Record<string, unknown>>;
    const total = (await tx.execute(
      sql`SELECT COUNT(*)::int AS n ${FROM} ${where}`,
    )) as unknown as Array<{ n: number }>;
    return { items: rows.map(toRow), total: Number(total[0]?.n ?? 0) };
  });
}

/** The scope document: its item, its Rev (what it asks for) and a label. */
async function readScope(
  tx: DbTransaction,
  companyId: string,
  input: CreateRevSubstitutionInput,
): Promise<{ itemId: string | null; revId: string | null; label: string }> {
  let rows: Array<{ item_id: string | null; rev_id: string | null; label: string }>;
  if (input.salesOrderLineId) {
    rows = (await tx.execute(sql`
      SELECT l.item_id, l.item_revision_id AS rev_id, h.code || ' Ln ' || l.line_no AS label
        FROM public.sales_order_lines l JOIN public.sales_orders h ON h.id = l.sales_order_id
       WHERE l.id = ${input.salesOrderLineId}::uuid AND l.company_id = ${companyId}::uuid
         AND l.deleted_at IS NULL AND h.deleted_at IS NULL`)) as unknown as typeof rows;
  } else if (input.jobWorkOrderLineId) {
    rows = (await tx.execute(sql`
      SELECT l.item_id, l.item_revision_id AS rev_id, h.code || ' Ln ' || l.line_no AS label
        FROM public.job_work_order_lines l JOIN public.job_work_orders h ON h.id = l.job_work_order_id
       WHERE l.id = ${input.jobWorkOrderLineId}::uuid AND l.company_id = ${companyId}::uuid
         AND l.deleted_at IS NULL AND h.deleted_at IS NULL`)) as unknown as typeof rows;
  } else {
    rows = (await tx.execute(sql`
      SELECT item_id, item_revision_id AS rev_id, code AS label
        FROM public.job_cards
       WHERE id = ${input.jobCardId}::uuid AND company_id = ${companyId}::uuid
         AND deleted_at IS NULL`)) as unknown as typeof rows;
  }
  const r = rows[0];
  if (!r) throw new NotFoundError('The order line / Job Card was not found. Pick it again.');
  return { itemId: r.item_id, revId: r.rev_id, label: r.label };
}

export async function createRevSubstitution(
  input: CreateRevSubstitutionInput,
  user: AuthContext,
): Promise<RevSubstitution> {
  await requireFormAccess(user, 'ecr_create', 'approve');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const revs = (await tx.execute(sql`
      SELECT ir.id, ir.rev, i.code
        FROM public.item_revisions ir JOIN public.items i ON i.id = ir.item_id
       WHERE ir.company_id = ${companyId}::uuid AND ir.deleted_at IS NULL
         AND ir.item_id = ${input.itemId}::uuid
         AND ir.id IN (${input.fromItemRevisionId}::uuid, ${input.toItemRevisionId}::uuid)`)) as unknown as Array<{
      id: string;
      rev: string;
      code: string;
    }>;
    const from = revs.find((r) => r.id === input.fromItemRevisionId);
    const to = revs.find((r) => r.id === input.toItemRevisionId);
    if (!from || !to) {
      throw new ValidationError(
        'That Drawing Rev does not belong to this item. Pick the Item + Rev again.',
      );
    }
    const fromLabel = itemRevLabel(from.code, from.rev);
    const toLabel = itemRevLabel(to.code, to.rev);
    const scope = await readScope(tx, companyId, input);
    if (scope.itemId !== input.itemId) {
      throw new ValidationError(
        `${scope.label} is not for ${from.code}. Pick the right line / Job Card.`,
      );
    }
    if (scope.revId && scope.revId !== input.toItemRevisionId) {
      throw new ValidationError(
        `${scope.label} asks for a different Drawing Rev than ${toLabel} — the substitution must be TO the Rev it asks for.`,
      );
    }
    if (input.ecrId) {
      const e = (await tx.execute(sql`
        SELECT 1 FROM public.engineering_changes
         WHERE id = ${input.ecrId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL`)) as unknown as unknown[];
      if (e.length === 0) throw new NotFoundError('Engineering Change not found');
    }
    const ins = (await tx.execute(sql`
      INSERT INTO public.rev_substitutions
        (company_id, item_id, from_item_revision_id, to_item_revision_id,
         sales_order_line_id, jw_line_id, job_card_id, qty_allowed, reason, ecr_id,
         approved_by, created_by, updated_by)
      VALUES (${companyId}::uuid, ${input.itemId}::uuid, ${input.fromItemRevisionId}::uuid,
              ${input.toItemRevisionId}::uuid, ${input.salesOrderLineId}::uuid,
              ${input.jobWorkOrderLineId}::uuid, ${input.jobCardId}::uuid, ${input.qtyAllowed},
              ${input.reason}, ${input.ecrId}::uuid, ${user.id}::uuid, ${user.id}::uuid, ${user.id}::uuid)
      RETURNING id`)) as unknown as Array<{ id: string }>;
    const id = ins[0]!.id;
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Approve,
        entity: 'RevSubstitution',
        entityId: id,
        refId: scope.label,
        qty: input.qtyAllowed,
        reason: input.reason,
        detail: `Rev substitution approved: ${fromLabel} in place of ${toLabel} on ${scope.label} — up to ${input.qtyAllowed}`,
      },
      companyId,
      user,
    );
    return readOne(tx, companyId, id);
  });
}

export async function cancelRevSubstitution(
  id: string,
  input: CancelRevSubstitutionInput,
  user: AuthContext,
): Promise<{ id: string; cancelled: true }> {
  await requireFormAccess(user, 'ecr_create', 'approve');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const cur = await readOne(tx, companyId, id);
    const upd = (await tx.execute(sql`
      UPDATE public.rev_substitutions
         SET deleted_at = now(), deleted_by = ${user.id}::uuid,
             updated_at = now(), updated_by = ${user.id}::uuid
       WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
         AND deleted_at IS NULL AND qty_used = 0
      RETURNING id`)) as unknown as unknown[];
    if (upd.length === 0) {
      const now = (await tx.execute(sql`
        SELECT qty_used::float8 AS used FROM public.rev_substitutions
         WHERE id = ${id}::uuid AND deleted_at IS NULL`)) as unknown as Array<{ used: number }>;
      throw new ConflictError(
        now[0]
          ? `${cur.fromLabel} in place of ${cur.toLabel}: ${Number(now[0].used)} already used — it cannot be cancelled.`
          : 'This Rev substitution was already cancelled.',
      );
    }
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Cancel,
        entity: 'RevSubstitution',
        entityId: id,
        refId: `${cur.fromLabel} → ${cur.toLabel}`,
        reason: input.reason ?? null,
        detail: `Rev substitution cancelled: ${cur.fromLabel} in place of ${cur.toLabel}`,
      },
      companyId,
      user,
    );
    return { id, cancelled: true as const };
  });
}
