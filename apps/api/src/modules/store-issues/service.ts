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
// ADR-193 3c — against an assembly SO a line may also use the SO's own
// reservation, and Return / Reverse are capped by its Still Out (assembly.ts).
//
// Numbering: ISS-NNNNN by MAX+1 inside the tx, AFTER the items are locked.
// Reads (list / one slip) live in read.ts.

import {
  ActivityAction,
  ITEM_TYPE_RULES,
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
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { lockItemForStock, postStockMove, roundQty } from '../../lib/stock-ledger';
import { emitActivityLog } from '../activity-log/service';
import {
  assertReturnWithinStillOut,
  assertReverseWithinStillOut,
  checkAssemblyAllowance,
  giveBackLineReservations,
  useOwnReservation,
} from './assembly';
import { enforceOverToIssue, resolveTargetAndCap } from './guard';
import { lockSlip, nextStoreIssueCode, readSlipLines, resolveIssuedTo, today } from './slip';
import { readStoreIssueDetail, requireCompany } from './read';

export { getStoreIssue, listStoreIssues } from './read';

const isReturnableType = (t: string): boolean =>
  (ITEM_TYPE_RULES as Record<string, { returnable: boolean } | undefined>)[t]?.returnable === true;

export async function getNextStoreIssueCode(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({ code: await nextStoreIssueCode(tx, companyId) }));
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
      SELECT id, code, item_type::text AS item_type FROM public.items
      WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
        AND id = ANY(${sql.param(itemIds)}::uuid[])
    `)) as unknown as Array<{ id: string; code: string; item_type: string }>;
    if (live.length !== new Set(itemIds).size) {
      throw new NotFoundError(
        'An Item on this issue was not found. Please select the Item Code again.',
      );
    }
    // P39 (ADR-193 phase 4): a tool goes out on the Tool Issue register, where
    // it is expected back — never on an Item Issue slip.
    const tool = live.find((r) => isReturnableType(r.item_type));
    if (tool) {
      throw new ValidationError(
        `${tool.code} is a Tool / Instrument — issue it from the Tool Issue register`,
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
    const { userId: issuedToUserId, issuedTo } = await resolveIssuedTo(tx, companyId, input);
    // ADR-193 3c — an assembly-SO line may also take this SO's own reservation
    // (M12: over that, 409 names who holds the rest). Checked before posting.
    const soId = input.issueAgainst === 'assembly_so' ? target.salesOrderId : null;
    const own = soId
      ? await checkAssemblyAllowance(tx, companyId, soId, input.lines, itemCodes)
      : null;

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
        issuedToUserId,
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
    const lineLogs: { lineNo: number; qty: number; text: string }[] = [];
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
        allowance: own?.get(l.itemId) ?? 0,
        qtyLabel: 'Issue Qty',
      });
      const lineRows = await tx
        .insert(storeIssueLines)
        .values({
          companyId,
          issueId,
          lineNo: idx + 1,
          itemId: l.itemId,
          itemCodeText: itemCode,
          qty: roundQty(l.qty),
          storeTransactionId: mv.id,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning({ id: storeIssueLines.id });
      if (soId && own?.get(l.itemId)) {
        await useOwnReservation(
          tx,
          { companyId, soId, itemId: l.itemId, qty: roundQty(l.qty), userId },
          lineRows[0]!.id,
        );
      }
      const text = `${itemCode} × ${roundQty(l.qty)} (stock ${mv.stockBefore} → ${mv.stockAfter})`;
      lineLogs.push({ lineNo: idx + 1, qty: roundQty(l.qty), text });
    }

    // ADR-197 — one ISSUE row per slip line (lineRef + qty moved).
    for (const ll of lineLogs) {
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Issue,
          entity: 'StoreIssue',
          entityId: issueId,
          refId: code,
          lineRef: `Line ${ll.lineNo}`,
          qty: ll.qty,
          operatorName: issuedTo,
          detail:
            `${code} · ${target.label} · to ${issuedTo} — ${purpose}: ${ll.text}` +
            (confirmed ? `. More than To Issue, confirmed: ${confirmed}` : ''),
        },
        companyId,
        user,
      );
    }

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

    // P34 — fitted parts cannot come back (SO-level Still Out cap).
    if (iss.issueAgainst === 'assembly_so' && iss.salesOrderId) {
      await assertReturnWithinStillOut(
        tx,
        companyId,
        iss.salesOrderId,
        [...want].map(([lineId, qty]) => {
          const line = byId.get(lineId)!;
          return { itemId: line.itemId, itemCode: line.itemCodeText, qty };
        }),
      );
    }

    const date = today();
    const done: { lineNo: number; qty: number; text: string }[] = [];
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
      done.push({
        lineNo: line.lineNo,
        qty,
        text: `${line.itemCodeText} × ${qty} (stock ${mv.stockBefore} → ${mv.stockAfter})`,
      });
    }

    // ADR-197 — one RETURN row per returned line (lineRef + qty put back).
    for (const d of done.sort((a, b) => a.lineNo - b.lineNo)) {
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Return,
          entity: 'StoreIssue',
          entityId: iss.id,
          refId: iss.code,
          lineRef: `Line ${d.lineNo}`,
          qty: d.qty,
          reason,
          detail: `${iss.code} returned ${d.text}`,
        },
        companyId,
        user,
      );
    }
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
    const assemblySoId =
      iss.issueAgainst === 'assembly_so' && iss.salesOrderId ? iss.salesOrderId : null;
    if (assemblySoId) {
      await assertReverseWithinStillOut(tx, companyId, assemblySoId, iss.code, lines);
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
    // ADR-193 3c — what the slip used of the SO's reservation is held again.
    if (assemblySoId) {
      await giveBackLineReservations(tx, { companyId, soId: assemblySoId, userId: user.id }, lines);
    }

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
        action: ActivityAction.Reverse,
        entity: 'StoreIssue',
        entityId: iss.id,
        refId: iss.code,
        qty: roundQty(lines.reduce((sum, l) => sum + Number(l.qty), 0)),
        reason,
        detail: `${iss.code} (${ISSUE_AGAINST_LABELS[iss.issueAgainst as IssueAgainst] ?? iss.issueAgainst}) put back ${done.join(', ')}`,
      },
      companyId,
      user,
    );
    return readStoreIssueDetail(tx, companyId, iss.id);
  });
}
