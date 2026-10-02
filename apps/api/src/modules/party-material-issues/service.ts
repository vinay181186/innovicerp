// Party Material Issue service (ADR-079, ADR-103, ADR-203).
//
// Issues client-supplied ("party") material to a Job Card for in-house
// machining. Debits the SEPARATE party stock (party_materials.stock_qty↓,
// issued_qty↑) — never writes own-stock store_transactions.
//
// ADR-203: the material is the Job Card's JWSO line's customer RM
// (job_work_order_lines.party_material_id), never a free choice, and every
// issue records that line (jw_line_id). Two caps, both checked under the JWSO
// line's row lock:
//   per line — the line's register balance (accepted − net issued − good
//              returned to the customer, see ./register.ts)
//   per JC   — net issued to the Job Card ≤ its order qty (1 piece = 1 part)
// Unused pieces go back to the register with Return to store (partial reversal);
// a whole wrong issue is cancelled.

import { type SQL, and, count, desc, eq, ilike, isNull, like, or, sql } from 'drizzle-orm';
import type {
  CreatePartyMaterialIssueInput,
  ListPartyMaterialIssuesQuery,
  ListPartyMaterialIssuesResponse,
  PartyMaterialIssue,
  ReturnPartyMaterialIssueToStoreInput,
} from '@innovic/shared';
import {
  items,
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  partyMaterialIssues,
  partyMaterials,
  salesOrderLines,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { lockDocSeries } from '../../lib/doc-series-lock';
import { assertJwLineOpenForWork, lockJwLine } from '../../lib/jw-line-state';
import { postPartyStockMove } from '../../lib/party-stock-ledger';
import { emitActivityLog } from '../activity-log/service';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { PARTY_ISSUE_SF_COLUMNS } from './sf-columns';
import { ActivityAction } from '@innovic/shared';
import { softDeleteStamp } from '../../lib/audit-trail';
import { jcMaterial, jwLineRegister } from './register';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dateLike(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

async function nextIssueCode(tx: DbTransaction, companyId: string): Promise<string> {
  // S2: queue behind any other save numbering this series (lib/doc-series-lock).
  await lockDocSeries(tx, companyId, 'party_material_issues');
  const prefix = 'IN-PMI-';
  const rows = await tx
    .select({ code: partyMaterialIssues.code })
    .from(partyMaterialIssues)
    .where(
      and(
        eq(partyMaterialIssues.companyId, companyId),
        like(partyMaterialIssues.code, `${prefix}%`),
      ),
    );
  let max = 0;
  for (const r of rows) {
    const m = r.code.slice(prefix.length).match(/^(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return `${prefix}${String(max + 1).padStart(5, '0')}`;
}

/** The job card's PRODUCED item, carried separately because
 *  `party_material_issues` stores nothing about it — it is joined per query.
 *  Not to be confused with the party material, which IS on the row: that is the
 *  CLIENT'S SUPPLIED MATERIAL, this is the part we machine out of it. */
interface JcProducedItem {
  jcItemCode: string | null;
  jcItemRevision: string | null;
  jcItemName: string | null;
}

/** What a caller that has not joined the job card's item passes. `job_card_id`
 *  is nullable here anyway, so "unknown" and "no job card" render identically —
 *  nothing. */
const NO_JC_ITEM: JcProducedItem = {
  jcItemCode: null,
  jcItemRevision: null,
  jcItemName: null,
};

function rowToIssue(
  row: typeof partyMaterialIssues.$inferSelect,
  jcItem: JcProducedItem = NO_JC_ITEM,
): PartyMaterialIssue {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    issueDate: dateLike(row.issueDate),
    jobWorkOrderId: row.jobWorkOrderId,
    jwCodeText: row.jwCodeText,
    jobCardId: row.jobCardId,
    jcCodeText: row.jcCodeText,
    // OUR produced part (what the card makes) — kept next to the job card
    // fields it belongs to, and deliberately above the partyMaterial* fields,
    // which are the CLIENT'S material this issue debits.
    jcItemCode: jcItem.jcItemCode,
    jcItemRevision: jcItem.jcItemRevision,
    jcItemName: jcItem.jcItemName,
    partyMaterialId: row.partyMaterialId,
    partyMaterialCodeText: row.partyMaterialCodeText,
    partyMaterialName: row.partyMaterialName,
    qty: row.qty,
    // ADR-203: the JWSO line drawn on + pieces put back into the register.
    jwLineId: row.jwLineId,
    returnedToStoreQty: row.returnedToStoreQty,
    remarks: row.remarks,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

/** Lower party_materials.issued_qty by `qty`. Conditional — a counter that
 *  would go negative means the books disagree, so it throws instead of
 *  clamping (ADR-203). */
async function lowerIssuedQty(
  tx: DbTransaction,
  partyMaterialId: string,
  qty: number,
  userId: string,
  code: string,
): Promise<void> {
  const updated = await tx
    .update(partyMaterials)
    .set({
      issuedQty: sql`${partyMaterials.issuedQty} - ${qty}`,
      updatedAt: new Date(),
      updatedBy: userId,
    })
    .where(and(eq(partyMaterials.id, partyMaterialId), sql`${partyMaterials.issuedQty} >= ${qty}`))
    .returning({ id: partyMaterials.id });
  if (updated.length === 0) {
    throw new ConflictError(
      `${code}: the material's Issued total is less than ${qty}, so it cannot be lowered. ` +
        `The customer-material figures disagree — ask an administrator to check this material.`,
    );
  }
}

export async function createPartyMaterialIssue(
  input: CreatePartyMaterialIssueInput,
  user: AuthContext,
): Promise<PartyMaterialIssue> {
  // Issuing client material is a create, so L2 Data Entry qualifies.
  await requireFormAccess(user, 'party_create', 'entry');
  const companyId = requireCompany(user);
  const userId = user.id;

  return withUserContext(user, async (tx) => {
    // 1) JWSO
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
    if (!jw) throw new NotFoundError('Selected JWSO was not found. Please select the JWSO again.');

    // 2) Job Card — must be raised from a line of THIS JWSO, and not a recovery
    // card (a rework / replacement card works pieces that already drew their
    // material on the original card).
    const jcRows = await tx
      .select({
        id: jobCards.id,
        code: jobCards.code,
        orderQty: jobCards.orderQty,
        sourceJwLineId: jobCards.sourceJwLineId,
        recoveryKind: jobCards.recoveryKind,
      })
      .from(jobCards)
      .where(
        and(
          eq(jobCards.id, input.jobCardId),
          eq(jobCards.companyId, companyId),
          isNull(jobCards.deletedAt),
        ),
      )
      .limit(1);
    const jc = jcRows[0];
    if (!jc) throw new NotFoundError('Selected JC was not found. Please pick the JC No. again.');
    if (!jc.sourceJwLineId) {
      throw new ValidationError(
        `JC ${jc.code} is not linked to a JWSO line, so customer material cannot be issued.`,
      );
    }
    if (jc.recoveryKind) {
      throw new ValidationError(
        `JC ${jc.code} is a recovery Job Card — customer material is issued to the original ` +
          `Job Card of the line, not to it.`,
      );
    }

    // 3) Lock the JWSO line FIRST — every figure capped below is summed under
    // this lock (CLAUDE.md §20.3). Then: same JWSO, open for work, has its RM.
    const line = await lockJwLine(tx, companyId, jc.sourceJwLineId);
    if (line.jobWorkOrderId !== jw.id) {
      throw new ValidationError(
        `JC ${jc.code} belongs to ${line.jwCode}, not ${jw.code} — it cannot be issued against ${jw.code}.`,
      );
    }
    assertJwLineOpenForWork(line, 'issue customer material');
    const where = `${line.jwCode} Ln ${line.lineNo}`;
    if (!line.partyMaterialId) {
      throw new ValidationError(`${where} has no customer RM — open and save the JWSO first.`);
    }

    // 4) The material IS the line's customer RM.
    const pmRows = await tx
      .select({
        id: partyMaterials.id,
        code: partyMaterials.code,
        name: partyMaterials.name,
        clientId: partyMaterials.clientId,
      })
      .from(partyMaterials)
      .where(
        and(
          eq(partyMaterials.id, line.partyMaterialId),
          eq(partyMaterials.companyId, companyId),
          isNull(partyMaterials.deletedAt),
        ),
      )
      .limit(1);
    const pm = pmRows[0];
    if (!pm) {
      throw new NotFoundError(
        `The customer RM of ${where} was not found. Open and save the JWSO again.`,
      );
    }
    if (input.partyMaterialId && input.partyMaterialId !== pm.id) {
      throw new ValidationError(
        `${where} uses customer material ${pm.code} — only that material can be issued to ${jc.code}.`,
      );
    }
    if (pm.clientId != null && jw.clientId != null && pm.clientId !== jw.clientId) {
      throw new ValidationError(
        `${pm.code} belongs to another Customer than ${jw.code}. ` +
          `Customer material can only be issued against its own Customer's order.`,
      );
    }

    // 5) Per-line cap: what is still in the register for THIS line.
    const reg = await jwLineRegister(tx, companyId, line.id);
    if (input.qty > reg.balance) {
      const avail = Math.max(0, reg.balance);
      throw new ValidationError(
        `Qty (${input.qty}) cannot be more than the customer material left for ${where} (${avail}) — ` +
          `Accepted ${reg.accepted}, Issued (net of returns to store) ${reg.netIssued}` +
          (reg.goodReturned > 0 ? `, Returned to customer ${reg.goodReturned}` : '') +
          `. Book a Party GRN and its QC for the rest first.`,
      );
    }

    // 6) Per-JC cap: 1 piece of customer material = 1 finished piece, so the
    // net issued to a Job Card never exceeds what it makes.
    const jcm = await jcMaterial(tx, companyId, jc.id);
    const jcOrderQty = Number(jc.orderQty);
    const jcRemaining = jcOrderQty - jcm.netIssued;
    if (input.qty > jcRemaining) {
      throw new ValidationError(
        jcRemaining <= 0
          ? `${jc.code} already has all ${jcOrderQty} pieces of material issued. Nothing more is needed for this JC.`
          : `${jc.code} is making ${jcOrderQty} pieces and ${jcm.netIssued} are already issued, ` +
              `so only ${jcRemaining} more can be issued. Qty entered: ${input.qty}.`,
      );
    }

    // 7) Insert the issue.
    // S2: a typed number is checked under the same series lock (lib/doc-series-lock).
    await lockDocSeries(tx, companyId, 'party_material_issues');
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
        jcCodeText: jc.code,
        jwLineId: line.id,
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
    if (!row) throw new ValidationError('Could not save Party Material Issue. Try again.');

    // 8) Draw down the register. The ledger writer owns stock_qty and refuses
    // an 'out' beyond the material's balance; this service keeps issued_qty.
    await postPartyStockMove(tx, {
      companyId,
      partyMaterialId: pm.id,
      jwLineId: line.id,
      movement: 'issue',
      direction: 'out',
      qty: input.qty,
      sourceDocType: 'party_material_issue',
      sourceDocId: row.id,
      remarks: `${code} · issued to ${jc.code}`,
      userId,
      qtyLabel: 'Issue Qty',
    });
    await tx
      .update(partyMaterials)
      .set({
        issuedQty: sql`${partyMaterials.issuedQty} + ${input.qty}`,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(partyMaterials.id, pm.id));

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Issue,
        entity: 'PartyMaterialIssue',
        entityId: row.id,
        refId: code,
        lineRef: `${line.jwCode} Ln ${line.lineNo}`,
        qty: input.qty,
        detail: `${code} — issued ${input.qty} of ${pm.code} to ${jc.code} (${jw.code} Ln ${line.lineNo})`,
      },
      companyId,
      user,
    );

    return rowToIssue(row);
  });
}

/** Lock order for a change to an existing issue: the JWSO line first (the
 *  parent of every cap), then the issue row itself, re-checked live after the
 *  lock so two cancels / returns cannot both pass. */
async function lockIssue(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<typeof partyMaterialIssues.$inferSelect> {
  const pre = (await tx.execute(sql`
    SELECT mi.jw_line_id AS "jwLineId", jc.source_jw_line_id AS "jcLineId"
      FROM public.party_material_issues mi
      LEFT JOIN public.job_cards jc ON jc.id = mi.job_card_id
     WHERE mi.id = ${id}::uuid AND mi.company_id = ${companyId}::uuid AND mi.deleted_at IS NULL
  `)) as unknown as Array<{ jwLineId: string | null; jcLineId: string | null }>;
  const p = pre[0];
  if (!p) throw new NotFoundError('Party Material Issue not found. Refresh the page.');
  const lineId = p.jwLineId ?? p.jcLineId;
  if (lineId) await lockJwLine(tx, companyId, lineId);

  await tx.execute(sql`
    SELECT 1 FROM public.party_material_issues WHERE id = ${id}::uuid FOR UPDATE
  `);
  const rows = await tx
    .select()
    .from(partyMaterialIssues)
    .where(and(eq(partyMaterialIssues.id, id), eq(partyMaterialIssues.companyId, companyId)))
    .limit(1);
  const iss = rows[0];
  if (!iss) throw new NotFoundError('Party Material Issue not found. Refresh the page.');
  if (iss.deletedAt) {
    throw new ConflictError(
      `${iss.code} has just been cancelled by someone else. Refresh the page.`,
    );
  }
  // Legacy rows written before 0193's backfill reached them: fall back to the
  // Job Card's line so the reversal still lands on the right line.
  return { ...iss, jwLineId: iss.jwLineId ?? lineId ?? null };
}

// ADR-103 / ADR-203 — cancel (reverse) a whole Party Material Issue.
//
// GUARD: material that has already been worked cannot be un-issued. "Used" is
// the first operation's good + rejected pieces (ADR-183); the Job Card's net
// issued after the cancel must still cover it. An issue that already had pieces
// returned to store is refused — return the rest to store instead, so the
// history stays one story.
export async function cancelPartyMaterialIssue(
  id: string,
  reason: string,
  user: AuthContext,
): Promise<{ ok: true; code: string; reversedQty: number }> {
  // Cancelling puts the issued quantity back on party stock — a department-admin
  // action. edit AND approve is the pair only L5/L6 hold.
  await requireFormAccess(user, 'party_create', 'edit');
  await requireFormAccess(user, 'party_create', 'approve');
  const companyId = requireCompany(user);
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ValidationError('Reason is required to cancel a Party Material Issue.');

  return withUserContext(user, async (tx) => {
    const iss = await lockIssue(tx, companyId, id);

    if (iss.returnedToStoreQty > 0) {
      throw new ConflictError(
        `Cannot cancel ${iss.code}: ${iss.returnedToStoreQty} piece(s) of it were already returned to store. ` +
          `Use Return to store for the rest instead.`,
      );
    }

    if (iss.jobCardId) {
      const jcm = await jcMaterial(tx, companyId, iss.jobCardId);
      const netAfter = jcm.netIssued - (iss.qty - iss.returnedToStoreQty);
      if (netAfter < jcm.used) {
        throw new ValidationError(
          `Cannot cancel ${iss.code}: ${jcm.used} piece(s) have already been worked on ` +
            `${iss.jcCodeText ?? 'this JC'} (good + rejected on the first operation) against ` +
            `${jcm.netIssued} issued. Cancelling would leave it short by ${jcm.used - netAfter}. ` +
            `Return the unused pieces to store instead.`,
        );
      }
    }

    const now = new Date();
    // The ledger writer puts the qty back into the register (a 'reversal'/'in'
    // row on the same JWSO line) and raises stock_qty; issued_qty comes down.
    await postPartyStockMove(tx, {
      companyId,
      partyMaterialId: iss.partyMaterialId,
      jwLineId: iss.jwLineId,
      movement: 'reversal',
      direction: 'in',
      qty: iss.qty,
      sourceDocType: 'party_material_issue',
      sourceDocId: id,
      remarks: `${iss.code} cancelled: ${trimmed}`,
      userId: user.id,
      qtyLabel: 'Reversal Qty',
    });
    await lowerIssuedQty(
      tx,
      iss.partyMaterialId,
      iss.qty,
      user.id,
      iss.partyMaterialCodeText ?? iss.code,
    );

    const cancelled = await tx
      .update(partyMaterialIssues)
      .set({
        ...softDeleteStamp(user),
        remarks: iss.remarks ? `${iss.remarks}\n[Cancelled] ${trimmed}` : `[Cancelled] ${trimmed}`,
        updatedAt: now,
        updatedBy: user.id,
      })
      .where(and(eq(partyMaterialIssues.id, id), isNull(partyMaterialIssues.deletedAt)))
      .returning({ id: partyMaterialIssues.id });
    if (cancelled.length === 0) {
      throw new ConflictError(
        `${iss.code} has just been cancelled by someone else. Refresh the page.`,
      );
    }

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Cancel,
        entity: 'PartyMaterialIssue',
        entityId: iss.id,
        refId: iss.code,
        qty: iss.qty,
        reason: trimmed,
        detail:
          `${iss.code} cancelled — returned ${iss.qty} of ` +
          `${iss.partyMaterialCodeText ?? 'material'} to party stock`,
      },
      companyId,
      user,
    );

    return { ok: true as const, code: iss.code, reversedQty: iss.qty };
  });
}

// ADR-203 — Return to store: put UNUSED pieces of an issue back from the Job
// Card into the customer-material register (a partial reversal; the issue
// stays). Capped twice:
//   · this issue — qty ≤ issue qty − already returned to store
//   · the Job Card — qty ≤ net issued to the JC − used on its first operation,
//     so pieces the JC has already worked can never come back.
export async function returnPartyMaterialIssueToStore(
  id: string,
  input: ReturnPartyMaterialIssueToStoreInput,
  user: AuthContext,
): Promise<PartyMaterialIssue> {
  await requireFormAccess(user, 'party_create', 'entry');
  const companyId = requireCompany(user);
  const reason = input.reason.trim();
  if (!reason) throw new ValidationError('Reason is required to return material to store.');

  return withUserContext(user, async (tx) => {
    const iss = await lockIssue(tx, companyId, id);

    const left = iss.qty - iss.returnedToStoreQty;
    if (input.qty > left) {
      throw new ValidationError(
        left <= 0
          ? `All ${iss.qty} piece(s) of ${iss.code} are already returned to store.`
          : `Return Qty (${input.qty}) cannot be more than what is left on ${iss.code} (${left}) — ` +
              `Issued ${iss.qty}, already returned to store ${iss.returnedToStoreQty}.`,
      );
    }
    if (iss.jobCardId) {
      const jcm = await jcMaterial(tx, companyId, iss.jobCardId);
      const onJc = jcm.netIssued - jcm.used;
      if (input.qty > onJc) {
        throw new ValidationError(
          `Return Qty (${input.qty}) cannot be more than the unused material still on ` +
            `${iss.jcCodeText ?? 'the JC'} (${Math.max(0, onJc)}) — issued ${jcm.netIssued} (net of returns), ` +
            `already worked ${jcm.used} (good + rejected on the first operation).`,
        );
      }
    }

    await postPartyStockMove(tx, {
      companyId,
      partyMaterialId: iss.partyMaterialId,
      jwLineId: iss.jwLineId,
      movement: 'reversal',
      direction: 'in',
      qty: input.qty,
      sourceDocType: 'party_material_issue_return',
      sourceDocId: iss.id,
      remarks: `${iss.code} · returned to store from ${iss.jcCodeText ?? 'JC'}: ${reason}`,
      userId: user.id,
      qtyLabel: 'Return Qty',
    });

    // Conditional: the CHECK (returned ≤ qty) also guards it, but a 0-row
    // answer here names the problem in plain words.
    const updated = await tx
      .update(partyMaterialIssues)
      .set({
        returnedToStoreQty: sql`${partyMaterialIssues.returnedToStoreQty} + ${input.qty}`,
        updatedAt: new Date(),
        updatedBy: user.id,
      })
      .where(
        and(
          eq(partyMaterialIssues.id, iss.id),
          isNull(partyMaterialIssues.deletedAt),
          sql`${partyMaterialIssues.returnedToStoreQty} + ${input.qty} <= ${partyMaterialIssues.qty}`,
        ),
      )
      .returning();
    const row = updated[0];
    if (!row) {
      throw new ConflictError(
        `${iss.code} was changed by someone else just now. Refresh the page.`,
      );
    }
    await lowerIssuedQty(
      tx,
      iss.partyMaterialId,
      input.qty,
      user.id,
      iss.partyMaterialCodeText ?? iss.code,
    );

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Return,
        entity: 'PartyMaterialIssue',
        entityId: iss.id,
        refId: iss.code,
        qty: input.qty,
        reason,
        changes: [
          {
            field: 'returnedToStoreQty',
            label: 'Returned to store',
            before: iss.returnedToStoreQty,
            after: row.returnedToStoreQty,
          },
        ],
        detail:
          `${iss.code} — ${input.qty} of ${iss.partyMaterialCodeText ?? 'material'} returned to store ` +
          `from ${iss.jcCodeText ?? 'JC'}`,
      },
      companyId,
      user,
    );

    return rowToIssue(row);
  });
}

/** Escape the ILIKE metacharacters in a user's search term. Without this a user
 *  typing "%" in the Party Material Issue search box gets a wildcard pattern
 *  instead of a literal search — i.e. the search box becomes a "show everything"
 *  button. Postgres's DEFAULT LIKE/ILIKE escape character is backslash, so no
 *  explicit ESCAPE clause is needed here (and drizzle's `ilike()` builder, which
 *  this list is written with, cannot emit one) — verified against the live
 *  database.
 *  Deliberately a local copy of the clients / sales-orders helper rather than an
 *  export across modules: it is three lines, and each list must be free to
 *  change its own search behaviour without dragging the others with it. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listPartyMaterialIssues(
  input: ListPartyMaterialIssuesQuery,
  user: AuthContext,
): Promise<ListPartyMaterialIssuesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [
      eq(partyMaterialIssues.companyId, companyId),
      isNull(partyMaterialIssues.deletedAt),
    ];
    if (input.search) {
      // Search covers every column the Party Material Issue register
      // (apps/web/src/modules/party-material-issues/components/
      // party-material-issue-view.tsx) shows: Issue No., Date, JWSO, Job Card,
      // the Item Made cell (the job card's produced part — code and name), the
      // Material cell (the CLIENT'S supplied material — code and name, both
      // halves) and Remarks. Note that Item Made and Material are two DIFFERENT
      // items and both are searched; a term matching either brings the row back.
      // The produced item's DRAWING REVISION is deliberately not searched — it
      // is a single character like 'A', so it would match almost every row.
      // Deliberately NOT searched:
      //  - Qty, and the live party stock qty — numbers, so "5" would hit nearly
      //    every issue.
      //  - money: this register prints none, and party material is the
      //    client's, so it carries no rate here; a searchable amount would let
      //    a user without price rights confirm a value by typing it.
      const term = `%${escapeLikeTerm(input.search)}%`;
      const s = or(
        ilike(partyMaterialIssues.code, term),
        // `issue_date` is a DATE column; cast so ILIKE has text to match, and
        // so the pattern matches exactly the YYYY-MM-DD the screen prints.
        sql`${partyMaterialIssues.issueDate}::text ILIKE ${term}`,
        ilike(partyMaterialIssues.jwCodeText, term),
        ilike(partyMaterialIssues.jcCodeText, term),
        // The job card's PRODUCED item — the new "Item Made" column. Reached
        // through the job-card LEFT JOIN, which BOTH queries below carry so
        // this one predicate stays valid for the page and for the count.
        ilike(items.code, term),
        ilike(items.name, term),
        ilike(partyMaterialIssues.partyMaterialCodeText, term),
        ilike(partyMaterialIssues.partyMaterialName, term),
        ilike(partyMaterialIssues.remarks, term),
      );
      if (s) conditions.push(s);
    }
    // Sort & Filter (ADR-200) — list AND count.
    const sf = readSf(input.sf);
    conditions.push(sql`TRUE ${sfWhere(PARTY_ISSUE_SF_COLUMNS, sf)}`);
    const where = and(...conditions);

    // ONE predicate, used by both the page query and the count — a total that
    // ignored the search would break the pager the moment anyone typed.
    const [rows, totals] = await Promise.all([
      tx
        .select({
          issue: partyMaterialIssues,
          materialStockQty: partyMaterials.stockQty,
          // WHAT THE JOB CARD MAKES. The register printed a job-card number and
          // no produced part, and a JC number says WHICH JOB, not WHICH PART.
          // These are NOT the party material columns already on the row: those
          // are the CLIENT'S SUPPLIED MATERIAL this issue debits, these are the
          // component machined out of it.
          jcItemCode: items.code,
          jcItemName: items.name,
          // The CUSTOMER'S drawing revision for that part, read live off the SO
          // line the card was raised against — or, for a JWSO-sourced card, off
          // the job-work line (ADR-177: a card has one source or the other,
          // never both, so the SO value wins wherever it exists). Never
          // items.revision, which is about the item master and would misname
          // the drawing.
          jcItemRevision: sql<
            string | null
          >`COALESCE(${salesOrderLines.revision}::text, ${jobWorkOrderLines.revision}::text)`,
        })
        .from(partyMaterialIssues)
        .leftJoin(partyMaterials, eq(partyMaterials.id, partyMaterialIssues.partyMaterialId))
        // LEFT JOIN the whole way down: `party_material_issues.job_card_id` is
        // nullable, the card's SO line may be absent on a JW-sourced card, and
        // an issue must never drop out of its own register because the produced
        // item could not be resolved.
        .leftJoin(jobCards, eq(jobCards.id, partyMaterialIssues.jobCardId))
        .leftJoin(items, eq(items.id, jobCards.itemId))
        .leftJoin(salesOrderLines, eq(salesOrderLines.id, jobCards.sourceSoLineId))
        .leftJoin(
          jobWorkOrderLines,
          and(
            eq(jobWorkOrderLines.id, jobCards.sourceJwLineId),
            isNull(jobWorkOrderLines.deletedAt),
          ),
        )
        .where(where)
        // id last: a unique tie-breaker so paging never skips or repeats a row.
        .orderBy(
          sfOrderBy(
            PARTY_ISSUE_SF_COLUMNS,
            sf,
            sql`${desc(partyMaterialIssues.issueDate)}, ${desc(partyMaterialIssues.code)}, ${desc(partyMaterialIssues.id)}`,
          ),
        )
        .limit(input.limit)
        .offset(input.offset),
      // The count carries the same job-card/item LEFT JOINs as the page query
      // because the search predicate can now reference `items`. Both joins are
      // on a primary key, so at most one row matches and the total cannot be
      // inflated by joining.
      tx
        .select({ value: count() })
        .from(partyMaterialIssues)
        .leftJoin(jobCards, eq(jobCards.id, partyMaterialIssues.jobCardId))
        .leftJoin(items, eq(items.id, jobCards.itemId))
        // The SO / JW line joins too: the Item Code ▾ filter reads the drawing
        // revision off them. Each is on a primary key — no row inflation.
        .leftJoin(salesOrderLines, eq(salesOrderLines.id, jobCards.sourceSoLineId))
        .leftJoin(
          jobWorkOrderLines,
          and(
            eq(jobWorkOrderLines.id, jobCards.sourceJwLineId),
            isNull(jobWorkOrderLines.deletedAt),
          ),
        )
        .where(where),
    ]);

    return {
      items: rows.map((r) => ({
        ...rowToIssue(r.issue, {
          jcItemCode: r.jcItemCode ?? null,
          jcItemRevision: r.jcItemRevision ?? null,
          jcItemName: r.jcItemName ?? null,
        }),
        materialStockQty: r.materialStockQty ?? null,
      })),
      total: totals[0]?.value ?? 0,
    };
  });
}
