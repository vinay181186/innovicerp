// Party Material Issue service (ADR-079).
//
// Issues client-supplied ("party") material to a Job Card for in-house
// machining. Debits the SEPARATE party stock (party_materials.stock_qty↓,
// issued_qty↑) — never writes own-stock store_transactions. Guard: cannot issue
// more than the received party stock on hand.

import { and, desc, eq, isNull, like, sql } from 'drizzle-orm';
import type {
  CreatePartyMaterialIssueInput,
  ListPartyMaterialIssuesResponse,
  PartyMaterialIssue,
} from '@innovic/shared';
import { jobCards, jobWorkOrders, partyMaterialIssues, partyMaterials } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dateLike(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

async function nextIssueCode(tx: DbTransaction, companyId: string): Promise<string> {
  const prefix = 'IN-PMI-';
  const rows = await tx
    .select({ code: partyMaterialIssues.code })
    .from(partyMaterialIssues)
    .where(and(eq(partyMaterialIssues.companyId, companyId), like(partyMaterialIssues.code, `${prefix}%`)));
  let max = 0;
  for (const r of rows) {
    const m = r.code.slice(prefix.length).match(/^(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return `${prefix}${String(max + 1).padStart(5, '0')}`;
}

function rowToIssue(row: typeof partyMaterialIssues.$inferSelect): PartyMaterialIssue {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    issueDate: dateLike(row.issueDate),
    jobWorkOrderId: row.jobWorkOrderId,
    jwCodeText: row.jwCodeText,
    jobCardId: row.jobCardId,
    jcCodeText: row.jcCodeText,
    partyMaterialId: row.partyMaterialId,
    partyMaterialCodeText: row.partyMaterialCodeText,
    partyMaterialName: row.partyMaterialName,
    qty: row.qty,
    remarks: row.remarks,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

export async function createPartyMaterialIssue(
  input: CreatePartyMaterialIssueInput,
  user: AuthContext,
): Promise<PartyMaterialIssue> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  const userId = user.id;

  return withUserContext(user, async (tx) => {
    // 1) JWO
    const jwRows = await tx
      .select({ id: jobWorkOrders.id, code: jobWorkOrders.code })
      .from(jobWorkOrders)
      .where(
        and(
          eq(jobWorkOrders.id, input.jobWorkOrderId),
          eq(jobWorkOrders.companyId, companyId),
          isNull(jobWorkOrders.deletedAt),
        ),
      )
      .limit(1);
    const jw = jwRows[0];
    if (!jw) throw new NotFoundError(`Job Work Order ${input.jobWorkOrderId} not found`);

    // 2) Optional JC (for traceability)
    let jcCodeText: string | null = null;
    if (input.jobCardId) {
      const jcRows = await tx
        .select({ code: jobCards.code })
        .from(jobCards)
        .where(
          and(
            eq(jobCards.id, input.jobCardId),
            eq(jobCards.companyId, companyId),
            isNull(jobCards.deletedAt),
          ),
        )
        .limit(1);
      if (!jcRows[0]) throw new NotFoundError(`Job Card ${input.jobCardId} not found`);
      jcCodeText = jcRows[0].code;
    }

    // 3) Party material — lock + availability GUARD (cannot issue > received on hand)
    await tx.execute(
      sql`SELECT 1 FROM public.party_materials WHERE id = ${input.partyMaterialId}::uuid FOR UPDATE`,
    );
    const pmRows = await tx
      .select({
        id: partyMaterials.id,
        code: partyMaterials.code,
        name: partyMaterials.name,
        stockQty: partyMaterials.stockQty,
        issuedQty: partyMaterials.issuedQty,
      })
      .from(partyMaterials)
      .where(
        and(
          eq(partyMaterials.id, input.partyMaterialId),
          eq(partyMaterials.companyId, companyId),
          isNull(partyMaterials.deletedAt),
        ),
      )
      .limit(1);
    const pm = pmRows[0];
    if (!pm) throw new NotFoundError(`Party material ${input.partyMaterialId} not found`);
    if (input.qty > pm.stockQty) {
      throw new ValidationError(
        `Cannot issue ${input.qty} — only ${pm.stockQty} of party material ${pm.code} in stock. Receive more via a Party GRN first.`,
      );
    }

    // 4) Insert issue
    const code = input.code ?? (await nextIssueCode(tx, companyId));
    const inserted = await tx
      .insert(partyMaterialIssues)
      .values({
        companyId,
        code,
        issueDate: input.issueDate,
        jobWorkOrderId: jw.id,
        jwCodeText: jw.code,
        jobCardId: input.jobCardId ?? null,
        jcCodeText,
        partyMaterialId: pm.id,
        partyMaterialCodeText: pm.code,
        partyMaterialName: pm.name,
        qty: input.qty,
        remarks: input.remarks ?? null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new ValidationError('Failed to insert party material issue');

    // 5) Draw down party stock
    await tx
      .update(partyMaterials)
      .set({
        stockQty: pm.stockQty - input.qty,
        issuedQty: pm.issuedQty + input.qty,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(partyMaterials.id, pm.id));

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'PartyMaterialIssue',
        detail: `${code} — issued ${input.qty} of ${pm.code} to ${jcCodeText ?? jw.code}`,
        refId: row.id,
      },
      companyId,
      user,
    );

    return rowToIssue(row);
  });
}

export async function listPartyMaterialIssues(
  user: AuthContext,
): Promise<ListPartyMaterialIssuesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        issue: partyMaterialIssues,
        materialStockQty: partyMaterials.stockQty,
      })
      .from(partyMaterialIssues)
      .leftJoin(partyMaterials, eq(partyMaterials.id, partyMaterialIssues.partyMaterialId))
      .where(and(eq(partyMaterialIssues.companyId, companyId), isNull(partyMaterialIssues.deletedAt)))
      .orderBy(desc(partyMaterialIssues.issueDate), desc(partyMaterialIssues.code))
      .limit(500);
    return {
      items: rows.map((r) => ({
        ...rowToIssue(r.issue),
        materialStockQty: r.materialStockQty ?? null,
      })),
      total: rows.length,
    };
  });
}
