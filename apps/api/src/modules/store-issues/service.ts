// Item Issue service — ADR-193 phase 3b (spec §11).
//
// An Item Issue is a SLIP (store_issues header) with LINES (store_issue_lines),
// issued against a Job Card, an Assembly (Equipment) SO, or for General use.
//
//   create   issue_create entry — every line leaves Available stock through the
//            single stock writer ('out', source 'store_issue'); a JC / Assembly
//            SO line over its To Issue needs confirmation (guard.ts)
//   returns  issue_create entry — leftovers put back ('in', source
//            'store_return'), any qty up to what is still out on the line
//   reverse  issue_create edit — the whole slip put back, only while nothing
//            was returned from it (ADR-189: an opposite ledger entry, never an
//            edit of the 'out')
//
// Numbering: ISS-NNNNN by MAX+1 inside the tx, AFTER the items are locked.
// Reads (list / one slip) live in read.ts.

import {
  ISSUE_AGAINST_LABELS,
  STORE_ISSUE_REVERSE_REASON_MIN,
  type CreateStoreIssueInput,
  type IssueAgainst,
  type ReturnStoreIssueInput,
  type ReverseStoreIssueInput,
  type StoreIssueDetail,
} from '@innovic/shared';
import { eq, sql } from 'drizzle-orm';
import { storeIssueLines, storeIssueReturns, storeIssues } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { lockItemForStock, postStockMove, roundQty } from '../../lib/stock-ledger';
import { emitActivityLog } from '../activity-log/service';
import { enforceOverToIssue, resolveTargetAndCap } from './guard';
import { lockSlip, readSlipLines } from './slip';
import { readStoreIssueDetail, requireCompany } from './read';

export { getStoreIssue, listStoreIssues } from './read';

const CODE_PREFIX = 'ISS-';
const CODE_PAD = 5;

/** Today in IST (a Return at 01:00 IST belongs to today, not yesterday). */
function today(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

async function nextStoreIssueCode(tx: DbTransaction, companyId: string): Promise<string> {
  // MAX of the trailing digits for this company, inside the same tx as the
  // insert (the unique index on (company_id, code) is the backstop).
  const rows = (await tx.execute(sql`
    SELECT COALESCE(
      MAX(NULLIF(regexp_replace(code, '^${sql.raw(CODE_PREFIX)}', ''), '')::int),
      0
    ) + 1 AS next_num
    FROM public.store_issues
    WHERE company_id = ${companyId}::uuid
      AND code LIKE ${`${CODE_PREFIX}%`}
      AND code ~ ${`^${CODE_PREFIX}\\d+$`}
  `)) as unknown as Array<{ next_num: number }>;
  const next = Number(rows[0]?.next_num ?? 1);
  return `${CODE_PREFIX}${String(next).padStart(CODE_PAD, '0')}`;
}

export async function getNextStoreIssueCode(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({ code: await nextStoreIssueCode(tx, companyId) }));
}

/** Who received it: the Operator's name, else the typed name. */
async function resolveIssuedTo(
  tx: DbTransaction,
  companyId: string,
  input: CreateStoreIssueInput,
): Promise<{ operatorId: string | null; issuedTo: string }> {
  if (input.operatorId) {
    const rows = (await tx.execute(sql`
      SELECT id, name FROM public.operators
      WHERE id = ${input.operatorId}::uuid AND company_id = ${companyId}::uuid
        AND is_active = true AND deleted_at IS NULL
    `)) as unknown as Array<{ id: string; name: string }>;
    const op = rows[0];
    if (!op) throw new ValidationError('Pick an active Operator (the one chosen was not found).');
    return { operatorId: op.id, issuedTo: op.name };
  }
  const typed = input.issuedToText?.trim() ?? '';
  if (!typed) throw new ValidationError('Pick who received it (Operator) or type a name');
  return { operatorId: null, issuedTo: typed };
}

export async function createStoreIssue(
  input: CreateStoreIssueInput,
  user: AuthContext,
): Promise<StoreIssueDetail> {
  await requireFormAccess(user, 'issue_create', 'entry');
  const companyId = requireCompany(user);
  const userId = user.id;

  return withUserContext(user, async (tx) => {
    // 1) Every item must be live in this company.
    const itemIds = input.lines.map((l) => l.itemId);
    const live = (await tx.execute(sql`
      SELECT id FROM public.items
      WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
        AND id = ANY(${sql.param(itemIds)}::uuid[])
    `)) as unknown as Array<{ id: string }>;
    if (live.length !== new Set(itemIds).size) {
      throw new NotFoundError(
        'An Item on this issue was not found. Please select the Item Code again.',
      );
    }

    // 2) Lock every item in id order (no deadlock between two slips), BEFORE
    //    the To Issue read (review F1: the item locks do NOT cover the code —
    //    two slips of different items would read the same MAX; see below).
    const itemCodes = new Map<string, string>();
    for (const id of [...itemIds].sort()) {
      const it = await lockItemForStock(tx, companyId, id);
      itemCodes.set(id, it.code);
    }

    // 3) Target + To Issue cap (409 needsConfirmation / approve-tier override).
    const { target, over } = await resolveTargetAndCap(tx, companyId, input, itemCodes);
    const confirmed = await enforceOverToIssue(user, over, input.confirmReason);
    const { operatorId, issuedTo } = await resolveIssuedTo(tx, companyId, input);

    // One ISS- number at a time per company (same pattern as stock counts).
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'store_issue_code:' + companyId}))`,
    );
    const code = await nextStoreIssueCode(tx, companyId);
    const purpose = input.purpose.trim();
    const remarks = input.remarks?.trim() || null;

    const inserted = await tx
      .insert(storeIssues)
      .values({
        companyId,
        code,
        issueDate: input.issueDate,
        issueAgainst: input.issueAgainst,
        jobCardId: target.jobCardId,
        productionOrderId: target.productionOrderId,
        salesOrderId: target.salesOrderId,
        issuedToOperatorId: operatorId,
        issuedTo,
        department: target.department,
        purpose,
        remarks,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning({ id: storeIssues.id });
    const issueId = inserted[0]?.id;
    if (!issueId) throw new ValidationError('Could not save the Item Issue. Try again.');

    // 4) One ledger 'out' + one line per item, in the order keyed.
    const moved: string[] = [];
    for (const [idx, l] of input.lines.entries()) {
      const itemCode = itemCodes.get(l.itemId) ?? '';
      const mv = await postStockMove(tx, {
        companyId,
        itemId: l.itemId,
        txnType: 'out',
        qty: l.qty,
        sourceType: 'store_issue',
        sourceRef: `${code} · ${itemCode}`,
        remarks: `Item Issue · ${target.label} · to ${issuedTo} · ${purpose}`,
        txnDate: input.issueDate,
        userId,
        itemCodeText: itemCode,
        guard: 'available',
        qtyLabel: 'Issue Qty',
      });
      await tx.insert(storeIssueLines).values({
        companyId,
        issueId,
        lineNo: idx + 1,
        itemId: l.itemId,
        itemCodeText: itemCode,
        qty: roundQty(l.qty),
        storeTransactionId: mv.id,
        createdBy: userId,
        updatedBy: userId,
      });
      moved.push(`${itemCode} × ${roundQty(l.qty)} (stock ${mv.stockBefore} → ${mv.stockAfter})`);
    }

    await emitActivityLog(
      tx,
      {
        action: 'ISSUE',
        entity: 'Store Issue',
        detail:
          `${code} · ${target.label} · to ${issuedTo} — ${purpose}: ${moved.join(', ')}` +
          (confirmed ? `. More than To Issue, confirmed: ${confirmed}` : ''),
        refId: code,
      },
      companyId,
      user,
    );

    return readStoreIssueDetail(tx, companyId, issueId);
  });
}

export async function returnStoreIssue(
  id: string,
  input: ReturnStoreIssueInput,
  user: AuthContext,
): Promise<StoreIssueDetail> {
  await requireFormAccess(user, 'issue_create', 'entry');
  const companyId = requireCompany(user);
  const reason = input.reason.trim();
  return withUserContext(user, async (tx) => {
    const iss = await lockSlip(tx, companyId, id);
    if (iss.reversedAt) {
      throw new ConflictError(`${iss.code} is reversed — nothing is left to return.`);
    }
    const { lines, returned } = await readSlipLines(tx, iss.id);
    const byId = new Map(lines.map((l) => [l.id, l]));

    // Same line keyed twice → one return of the sum.
    const want = new Map<string, number>();
    for (const r of input.lines) {
      if (!byId.has(r.issueLineId)) {
        throw new ValidationError(
          `A returned line is not on ${iss.code}. Reload the slip and try again.`,
        );
      }
      want.set(r.issueLineId, roundQty((want.get(r.issueLineId) ?? 0) + r.qty));
    }
    for (const [lineId, qty] of want) {
      const line = byId.get(lineId)!;
      const out = roundQty(line.qty - (returned.get(lineId) ?? 0));
      if (qty > out) {
        throw new ConflictError(
          `${line.itemCodeText}: Return Qty (${qty}) cannot be more than what is still out on ${iss.code} (${out}).`,
          { itemCode: line.itemCodeText, qty, outstanding: out },
        );
      }
    }

    const date = today();
    const done: string[] = [];
    const order = [...want.keys()].sort((a, b) =>
      byId.get(a)!.itemId.localeCompare(byId.get(b)!.itemId),
    );
    for (const lineId of order) {
      const line = byId.get(lineId)!;
      const qty = want.get(lineId)!;
      const mv = await postStockMove(tx, {
        companyId,
        itemId: line.itemId,
        txnType: 'in',
        qty,
        sourceType: 'store_return',
        sourceRef: `${iss.code} return · ${line.itemCodeText}`,
        remarks: `Item Issue return · ${reason}`,
        txnDate: date,
        userId: user.id,
        itemCodeText: line.itemCodeText,
        guard: 'none',
        qtyLabel: 'Return Qty',
      });
      await tx.insert(storeIssueReturns).values({
        companyId,
        issueLineId: line.id,
        returnDate: date,
        qty,
        reason,
        storeTransactionId: mv.id,
        createdBy: user.id,
        updatedBy: user.id,
      });
      done.push(`${line.itemCodeText} × ${qty} (stock ${mv.stockBefore} → ${mv.stockAfter})`);
    }

    await emitActivityLog(
      tx,
      {
        action: 'RETURN',
        entity: 'Store Issue',
        detail: `${iss.code} returned ${done.join(', ')}. Reason: ${reason}`,
        refId: iss.code,
      },
      companyId,
      user,
    );
    return readStoreIssueDetail(tx, companyId, iss.id);
  });
}

/**
 * ADR-189 — undo a whole slip by OPPOSITE ledger entries ('in' of each line),
 * never by editing the 'out'. Stays on the register, stamped who / when / why.
 * Only while nothing was returned from it — after a Return, use Return.
 */
export async function reverseStoreIssue(
  id: string,
  input: ReverseStoreIssueInput,
  user: AuthContext,
): Promise<StoreIssueDetail> {
  await requireFormAccess(user, 'issue_create', 'edit');
  const companyId = requireCompany(user);
  const reason = input.reason.trim();
  if (reason.length < STORE_ISSUE_REVERSE_REASON_MIN) {
    throw new ValidationError(
      `Give a reason for the reversal (at least ${STORE_ISSUE_REVERSE_REASON_MIN} characters).`,
    );
  }
  return withUserContext(user, async (tx) => {
    const iss = await lockSlip(tx, companyId, id);
    if (iss.reversedAt) throw new ConflictError(`${iss.code} is already reversed.`);
    const { lines, returned } = await readSlipLines(tx, iss.id);
    if ([...returned.values()].some((q) => q > 0)) {
      throw new ConflictError(
        `${iss.code}: part of it was already returned, so the slip cannot be reversed — use Return for what is still out.`,
      );
    }
    if (lines.length === 0) {
      throw new ConflictError(`${iss.code} has no items on it, so there is no stock to put back.`);
    }

    const date = today();
    const done: string[] = [];
    const byLine = new Map<string, string>();
    for (const line of [...lines].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
      const mv = await postStockMove(tx, {
        companyId,
        itemId: line.itemId,
        txnType: 'in',
        qty: line.qty,
        sourceType: 'store_return',
        sourceRef: `${iss.code} reversal · ${line.itemCodeText}`,
        remarks: `Item Issue reversed · ${reason}`,
        txnDate: date,
        userId: user.id,
        itemCodeText: line.itemCodeText,
        guard: 'none',
      });
      byLine.set(line.id, mv.id);
      done.push(`${line.itemCodeText} × ${line.qty} (stock ${mv.stockBefore} → ${mv.stockAfter})`);
    }
    const firstTxnId = byLine.get(lines[0]!.id) ?? null;

    const now = new Date();
    await tx
      .update(storeIssues)
      .set({
        reversedAt: now,
        reversedBy: user.id,
        reversalReason: reason,
        reversalStoreTransactionId: firstTxnId,
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(eq(storeIssues.id, iss.id));

    await emitActivityLog(
      tx,
      {
        action: 'REVERSE',
        entity: 'Store Issue',
        detail: `${iss.code} (${ISSUE_AGAINST_LABELS[iss.issueAgainst as IssueAgainst] ?? iss.issueAgainst}) put back ${done.join(', ')}. Reason: ${reason}`,
        refId: iss.code,
      },
      companyId,
      user,
    );
    return readStoreIssueDetail(tx, companyId, iss.id);
  });
}
