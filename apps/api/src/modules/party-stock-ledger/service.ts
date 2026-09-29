// Party Stock Ledger read service (ADR-194, migration 0157).
//
// Read-only register over party_stock_ledger — the SEPARATE, ZERO-VALUE store
// for customer-supplied ("party") material. Rows are written ONLY by
// lib/party-stock-ledger.postPartyStockMove (party GRN receive, party material
// issue, spare-material return, and the compensating reversals). This module
// just lists them, newest first, joined to the party material (code + name) and
// the user who posted the move (createdByName). Company-scoped by RLS, exactly
// like the Party GRN list.

import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  ListPartyStockLedgerQuery,
  ListPartyStockLedgerResponse,
  PartyStockLedgerListItem,
} from '@innovic/shared';
import { partyStockLedger } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function tsLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export async function listPartyStockLedger(
  input: ListPartyStockLedgerQuery,
  user: AuthContext,
): Promise<ListPartyStockLedgerResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const pmFrag = input.partyMaterialId
      ? sql`AND psl.party_material_id = ${input.partyMaterialId}::uuid`
      : sql``;
    const jwFrag = input.jwLineId ? sql`AND psl.jw_line_id = ${input.jwLineId}::uuid` : sql``;
    const movementFrag = input.movement ? sql`AND psl.movement = ${input.movement}` : sql``;

    const result = (await tx.execute(sql`
      SELECT
        psl.id, psl.company_id AS "companyId",
        psl.party_material_id AS "partyMaterialId",
        psl.jw_line_id AS "jwLineId",
        psl.movement, psl.direction,
        psl.qty, psl.balance_after AS "balanceAfter",
        psl.source_doc_type AS "sourceDocType",
        psl.source_doc_id AS "sourceDocId",
        psl.remarks,
        psl.created_at AS "createdAt", psl.created_by AS "createdBy",
        psl.updated_at AS "updatedAt", psl.updated_by AS "updatedBy",
        psl.deleted_at AS "deletedAt",
        pm.code AS "partyMaterialCode",
        pm.name AS "partyMaterialName",
        u.full_name AS "createdByName"
      FROM public.party_stock_ledger psl
      LEFT JOIN public.party_materials pm ON pm.id = psl.party_material_id
      LEFT JOIN public.users u ON u.id = psl.created_by
      WHERE psl.company_id = ${companyId}::uuid
        AND psl.deleted_at IS NULL
        ${pmFrag}
        ${jwFrag}
        ${movementFrag}
      ORDER BY psl.created_at DESC, psl.id DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as Array<Record<string, unknown>>;

    const conditions = [eq(partyStockLedger.companyId, companyId), isNull(partyStockLedger.deletedAt)];
    if (input.partyMaterialId)
      conditions.push(eq(partyStockLedger.partyMaterialId, input.partyMaterialId));
    if (input.jwLineId) conditions.push(eq(partyStockLedger.jwLineId, input.jwLineId));
    if (input.movement) conditions.push(eq(partyStockLedger.movement, input.movement));
    const totalRows = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(partyStockLedger)
      .where(and(...conditions));
    const total = Number(totalRows[0]?.value ?? 0);

    const items = result.map(toListItem);
    return { items, total, limit: input.limit, offset: input.offset };
  });
}

function toListItem(r: Record<string, unknown>): PartyStockLedgerListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    partyMaterialId: r['partyMaterialId'] as string,
    jwLineId: (r['jwLineId'] as string | null) ?? null,
    movement: r['movement'] as PartyStockLedgerListItem['movement'],
    direction: r['direction'] as PartyStockLedgerListItem['direction'],
    qty: Number(r['qty'] ?? 0),
    balanceAfter: Number(r['balanceAfter'] ?? 0),
    sourceDocType: String(r['sourceDocType'] ?? ''),
    sourceDocId: (r['sourceDocId'] as string | null) ?? null,
    remarks: (r['remarks'] as string | null) ?? null,
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: r['deletedAt'] != null ? tsLike(r['deletedAt']) : null,
    partyMaterialCode: (r['partyMaterialCode'] as string | null) ?? null,
    partyMaterialName: (r['partyMaterialName'] as string | null) ?? null,
    createdByName: (r['createdByName'] as string | null) ?? null,
  };
}
