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
import {
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  partyMaterialIssues,
  partyMaterials,
} from '../../db/schema';
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
      .select({
        id: jobWorkOrders.id,
        code: jobWorkOrders.code,
        clientId: jobWorkOrders.clientId,
      })
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

    // 2) Optional JC (for traceability) — and cross-check its owning JWSO.
    // A Job Card sourced from a JW line already belongs to a specific JWSO
    // (job_cards.source_jw_line_id -> job_work_order_lines.job_work_order_id).
    // Resolve that owner in the same load and reject issuing the JC against a
    // DIFFERENT JWSO. JCs with no JW source (e.g. SO-sourced) are left alone.
    // ADR-103: the job card is mandatory — it is the only link from an issue to
    // a JWSO LINE, and the first-op material gate is computed per line.
    const jcRows = await tx
      .select({
        id: jobCards.id,
        code: jobCards.code,
        orderQty: jobCards.orderQty,
        sourceJwLineId: jobCards.sourceJwLineId,
        jcJobWorkOrderId: jobWorkOrderLines.jobWorkOrderId,
        lineNo: jobWorkOrderLines.lineNo,
        lineItemId: jobWorkOrderLines.itemId,
        linePartName: jobWorkOrderLines.partName,
      })
      .from(jobCards)
      .leftJoin(jobWorkOrderLines, eq(jobWorkOrderLines.id, jobCards.sourceJwLineId))
      .where(
        and(
          eq(jobCards.id, input.jobCardId),
          eq(jobCards.companyId, companyId),
          isNull(jobCards.deletedAt),
        ),
      )
      .limit(1);
    const jc = jcRows[0];
    if (!jc) throw new NotFoundError(`Job Card ${input.jobCardId} not found`);
    const jcCodeText: string = jc.code;
    if (jc.sourceJwLineId && jc.jcJobWorkOrderId && jc.jcJobWorkOrderId !== jw.id) {
      throw new ValidationError(
        `Job Card ${jc.code} belongs to a different Job Work Order — it cannot be issued against ${jw.code}.`,
      );
    }
    if (!jc.sourceJwLineId) {
      throw new ValidationError(
        `Job Card ${jc.code} is not linked to a Job Work Order line, so client material cannot be issued to it.`,
      );
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
        clientId: partyMaterials.clientId,
        itemId: partyMaterials.itemId,
        itemCodeText: partyMaterials.itemCodeText,
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

    // ADR-103: same two identity checks the Party GRN got in ADR-102. Without
    // them the gate can be unlocked with the wrong customer's material, or with
    // the right customer's material for a different part.
    if (pm.clientId != null && jw.clientId != null && pm.clientId !== jw.clientId) {
      throw new ValidationError(
        `${pm.code} belongs to a different client than ${jw.code}. ` +
          `Party material can only be issued against its own client's order.`,
      );
    }
    if (pm.itemId != null && jc.lineItemId != null && pm.itemId !== jc.lineItemId) {
      throw new ValidationError(
        `${pm.code} is "${pm.name}"${pm.itemCodeText ? ` (item ${pm.itemCodeText})` : ''}, but ` +
          `${jc.code} makes "${jc.linePartName}". Issue the material for this part.`,
      );
    }

    if (input.qty > pm.stockQty) {
      throw new ValidationError(
        `Cannot issue ${input.qty} — only ${pm.stockQty} of party material ${pm.code} in stock. Receive more via a Party GRN first.`,
      );
    }

    // ADR-103: PER-LINE limit. The overall stock check above is not enough on a
    // multi-line JWSO — material received for line 1 could be issued wholesale
    // to line 2's job card, starving the part it was sent for. Compare what was
    // received FOR THIS LINE against what has already been issued to job cards
    // on THIS LINE. Single-line JWSOs match every receipt (the line-no text on
    // older GRNs may be blank).
    const lineNo = jc.lineNo == null ? null : String(jc.lineNo);
    const lineCountRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM public.job_work_order_lines
      WHERE job_work_order_id = ${jw.id}::uuid AND deleted_at IS NULL
    `)) as unknown as Array<{ n: number }>;
    const multiLine = Number(lineCountRows[0]?.n ?? 1) > 1;
    const lineFilter = multiLine && lineNo ? sql`AND pgl.jw_line_no_text = ${lineNo}` : sql``;
    const balRows = (await tx.execute(sql`
      SELECT
        COALESCE((
          SELECT SUM(pgl.received_qty)
          FROM public.party_grn pg
          JOIN public.party_grn_lines pgl
            ON pgl.party_grn_id = pg.id AND pgl.deleted_at IS NULL
          WHERE pg.job_work_order_id = ${jw.id}::uuid
            AND pg.deleted_at IS NULL
            ${lineFilter}
        ), 0)::int AS "receivedForLine",
        COALESCE((
          SELECT SUM(mi.qty)
          FROM public.party_material_issues mi
          JOIN public.job_cards j2 ON j2.id = mi.job_card_id
          WHERE mi.deleted_at IS NULL
            AND j2.source_jw_line_id = ${jc.sourceJwLineId}::uuid
        ), 0)::int AS "issuedForLine"
    `)) as unknown as Array<{ receivedForLine: number; issuedForLine: number }>;
    const receivedForLine = Number(balRows[0]?.receivedForLine ?? 0);
    const issuedForLine = Number(balRows[0]?.issuedForLine ?? 0);
    const remainingForLine = Math.max(0, receivedForLine - issuedForLine);
    if (input.qty > remainingForLine) {
      throw new ValidationError(
        `Cannot issue ${input.qty} for "${jc.linePartName}" (${jw.code} line ${lineNo ?? '?'}). ` +
          `${receivedForLine} received for this part, ${issuedForLine} already issued, ` +
          `so only ${remainingForLine} can be issued. Record a Party GRN for the balance first.`,
      );
    }

    // ADR-103: never issue more than the job card is actually making. 1 piece of
    // client material = 1 finished piece, so a 50-piece job card needs 50 — more
    // than that is a typo, and it would hand the operator a licence to log more
    // than was planned.
    const jcIssuedRows = (await tx.execute(sql`
      SELECT COALESCE(SUM(qty), 0)::int AS "issued"
      FROM public.party_material_issues
      WHERE job_card_id = ${jc.id}::uuid AND deleted_at IS NULL
    `)) as unknown as Array<{ issued: number }>;
    const alreadyToJc = Number(jcIssuedRows[0]?.issued ?? 0);
    const jcRemaining = Math.max(0, Number(jc.orderQty) - alreadyToJc);
    if (input.qty > jcRemaining) {
      throw new ValidationError(
        jcRemaining === 0
          ? `${jc.code} already has all ${jc.orderQty} pieces of material issued. Nothing more is needed for this job card.`
          : `${jc.code} is making ${jc.orderQty} pieces and ${alreadyToJc} are already issued, ` +
            `so only ${jcRemaining} more can be issued. You entered ${input.qty}.`,
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
        jobCardId: jc.id,
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

// ADR-103 — cancel (reverse) a Party Material Issue.
//
// Needed because the issued qty now controls whether an operator may work: a
// mistyped issue would otherwise unlock production for the wrong quantity, with
// no way back. It is also what unblocks the Party GRN cancel, which refuses
// while material is still issued.
//
// GUARD (the mirror of the GRN's): material that has already been MACHINED
// cannot be un-issued. Cancelling an issue of 20 after 20 pieces were made
// would drive the job card's remaining material negative and freeze it. The
// pieces are gone — a scrap/adjustment entry is the honest correction, not a
// cancel.
export async function cancelPartyMaterialIssue(
  id: string,
  reason: string,
  user: AuthContext,
): Promise<{ ok: true; code: string; reversedQty: number }> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ValidationError('A reason is required to cancel a material issue');

  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        id: partyMaterialIssues.id,
        code: partyMaterialIssues.code,
        qty: partyMaterialIssues.qty,
        remarks: partyMaterialIssues.remarks,
        jobCardId: partyMaterialIssues.jobCardId,
        jcCodeText: partyMaterialIssues.jcCodeText,
        partyMaterialId: partyMaterialIssues.partyMaterialId,
        partyMaterialCodeText: partyMaterialIssues.partyMaterialCodeText,
      })
      .from(partyMaterialIssues)
      .where(
        and(
          eq(partyMaterialIssues.id, id),
          eq(partyMaterialIssues.companyId, companyId),
          isNull(partyMaterialIssues.deletedAt),
        ),
      )
      .limit(1);
    const iss = rows[0];
    if (!iss) throw new NotFoundError(`Party material issue ${id} not found`);

    if (iss.jobCardId) {
      // How much of this job card's material has already been turned into
      // parts (qty logged on its FIRST op — the op the material feeds).
      const consumedRows = (await tx.execute(sql`
        WITH first_op AS (
          SELECT id FROM public.jc_ops
          WHERE job_card_id = ${iss.jobCardId}::uuid AND deleted_at IS NULL
          ORDER BY op_seq LIMIT 1
        )
        SELECT
          COALESCE((SELECT SUM(l.qty) FROM public.op_log l
                    WHERE l.jc_op_id = (SELECT id FROM first_op)), 0)::int AS "consumed",
          COALESCE((SELECT SUM(mi.qty) FROM public.party_material_issues mi
                    WHERE mi.job_card_id = ${iss.jobCardId}::uuid
                      AND mi.deleted_at IS NULL), 0)::int AS "issued"
      `)) as unknown as Array<{ consumed: number; issued: number }>;
      const consumed = Number(consumedRows[0]?.consumed ?? 0);
      const issued = Number(consumedRows[0]?.issued ?? 0);
      if (issued - iss.qty < consumed) {
        throw new ValidationError(
          `Cannot cancel ${iss.code}: ${consumed} piece(s) have already been machined on ` +
            `${iss.jcCodeText ?? 'this job card'} against the ${issued} issued. ` +
            `Cancelling would leave it short by ${consumed - (issued - iss.qty)}. ` +
            `That material is already used — record a scrap/adjustment instead.`,
        );
      }
    }

    const now = new Date();
    await tx.execute(
      sql`SELECT 1 FROM public.party_materials WHERE id = ${iss.partyMaterialId}::uuid FOR UPDATE`,
    );
    await tx
      .update(partyMaterials)
      .set({
        stockQty: sql`${partyMaterials.stockQty} + ${iss.qty}`,
        issuedQty: sql`GREATEST(${partyMaterials.issuedQty} - ${iss.qty}, 0)`,
        updatedAt: now,
        updatedBy: user.id,
      })
      .where(eq(partyMaterials.id, iss.partyMaterialId));

    await tx
      .update(partyMaterialIssues)
      .set({
        deletedAt: now,
        remarks: iss.remarks ? `${iss.remarks}\n[Cancelled] ${trimmed}` : `[Cancelled] ${trimmed}`,
        updatedAt: now,
        updatedBy: user.id,
      })
      .where(eq(partyMaterialIssues.id, id));

    await emitActivityLog(
      tx,
      {
        action: 'CANCEL',
        entity: 'PartyMaterialIssue',
        detail:
          `${iss.code} cancelled: ${trimmed} — returned ${iss.qty} of ` +
          `${iss.partyMaterialCodeText ?? 'material'} to party stock`,
        refId: iss.code,
      },
      companyId,
      user,
    );

    return { ok: true as const, code: iss.code, reversedQty: iss.qty };
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
