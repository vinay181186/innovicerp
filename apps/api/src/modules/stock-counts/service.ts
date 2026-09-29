// Stock Count service (ADR-193 phase 2) — opening stock and periodic counts.
//
//   create / replace lines  (draft)       stockcount_create entry
//   submit                  draft → submitted (each line's system qty was snapshotted when keyed)
//   approve                 submitted → posted (a DIFFERENT user, approve right):
//                           posts counted − snapshot per line through the single
//                           stock writer, so movements after the count stay real
//   cancel                  draft / submitted only (a posted count is corrected
//                           by a new count, never edited)
//
// Paper tests C1–C13: docs/specs/STORE_REDESIGN_ADR-193.md §10.

import {
  ActivityAction,
  type ActivityChange,
  type ApproveStockCountInput,
  type CancelStockCountInput,
  type CreateStockCountInput,
  type ReplaceStockCountLinesInput,
  type StockCount,
} from '@innovic/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { items, stockCountLines, stockCounts } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { diffFields, softDeleteStamp, type DiffField } from '../../lib/audit-trail';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { lockItemForStock, postStockMove, roundQty } from '../../lib/stock-ledger';
import { readStockPosition } from '../../lib/stock-reservation';
import { emitActivityLog } from '../activity-log/service';
import { checkLines, nextCode, writeLines } from './lines';
import { getStockCount } from './read';

export { getStockCount, listStockCounts, resolveStockCountItems } from './read';

const FORM = 'stockcount_create' as const;

// ADR-197 — Edit before → after. Labels: docs/NAMING.md.
const HEADER_FIELDS: readonly DiffField[] = [{ key: 'remarks', label: 'Remarks' }];
const LINE_FIELDS: readonly DiffField[] = [
  { key: 'countedQty', label: 'Counted Qty' },
  { key: 'reason', label: 'Reason' },
];

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

const d = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

/** Everyone who keyed lines on this count, including saves since replaced. */
async function countKeyers(tx: DbTransaction, countId: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ by: stockCountLines.createdBy })
    .from(stockCountLines)
    .where(eq(stockCountLines.stockCountId, countId));
  return rows.map((r) => r.by);
}

async function lockHeader(tx: DbTransaction, companyId: string, id: string) {
  const rows = await tx
    .select()
    .from(stockCounts)
    .where(
      and(
        eq(stockCounts.id, id),
        eq(stockCounts.companyId, companyId),
        isNull(stockCounts.deletedAt),
      ),
    )
    .for('update')
    .limit(1);
  const h = rows[0];
  if (!h) throw new NotFoundError('Stock Count not found.');
  return h;
}

async function liveLines(tx: DbTransaction, countId: string) {
  return tx
    .select()
    .from(stockCountLines)
    .where(and(eq(stockCountLines.stockCountId, countId), isNull(stockCountLines.deletedAt)))
    .orderBy(asc(stockCountLines.lineNo));
}

// ─── Writes ────────────────────────────────────────────────────────────────

export async function createStockCount(
  input: CreateStockCountInput,
  user: AuthContext,
): Promise<StockCount> {
  await requireFormAccess(user, FORM, 'entry');
  const companyId = requireCompany(user);
  if (input.countDate > new Date().toISOString().slice(0, 10)) {
    throw new ValidationError('Count Date cannot be in the future.');
  }
  const id = await withUserContext(user, async (tx) => {
    const byId = await checkLines(tx, companyId, input.lines);
    const code = await nextCode(tx, companyId);
    const ins = await tx
      .insert(stockCounts)
      .values({
        companyId,
        code,
        countDate: input.countDate,
        purpose: input.purpose,
        remarks: input.remarks ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: stockCounts.id });
    const newId = ins[0]!.id;
    await writeLines(tx, companyId, newId, input.lines, byId, user.id);
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Create,
        entity: 'StockCount',
        entityId: newId,
        refId: code,
        detail: `${code} · ${input.lines.length} item(s) · ${input.purpose}`,
      },
      companyId,
      user,
    );
    return newId;
  });
  return getStockCount(id, user);
}

export async function replaceStockCountLines(
  id: string,
  input: ReplaceStockCountLinesInput,
  user: AuthContext,
): Promise<StockCount> {
  await requireFormAccess(user, FORM, 'entry');
  const companyId = requireCompany(user);
  await withUserContext(user, async (tx) => {
    const h = await lockHeader(tx, companyId, id);
    if (h.status !== 'draft') {
      throw new ConflictError(`${h.code} is ${h.status} — only a draft can be changed.`);
    }
    const byId = await checkLines(tx, companyId, input.lines);
    const old = await liveLines(tx, id);
    const keep = new Map(
      old.map((l) => [
        l.itemId,
        { countedQty: l.countedQty, systemQtyAtCount: l.systemQtyAtCount },
      ]),
    );
    const now = new Date();
    await tx
      .update(stockCountLines)
      .set({ ...softDeleteStamp(user), updatedAt: now, updatedBy: user.id })
      .where(and(eq(stockCountLines.stockCountId, id), isNull(stockCountLines.deletedAt)));
    await writeLines(tx, companyId, id, input.lines, byId, user.id, keep);
    await tx
      .update(stockCounts)
      .set({
        ...(input.remarks !== undefined ? { remarks: input.remarks || null } : {}),
        updatedAt: now,
        updatedBy: user.id,
      })
      .where(eq(stockCounts.id, id));
    // ADR-197 — one EDIT row for the header, one per changed / added /
    // removed line (lines are matched by item; lineRef = the saved line no.).
    const edits: Array<{ lineRef: string | null; changes: ActivityChange[] }> = [];
    const headerChanges = diffFields(
      h,
      input.remarks !== undefined ? { remarks: input.remarks || null } : {},
      HEADER_FIELDS,
    );
    if (headerChanges.length > 0) edits.push({ lineRef: null, changes: headerChanges });
    const oldByItem = new Map(old.map((l) => [l.itemId, l]));
    const newItems = new Set(input.lines.map((l) => l.itemId));
    input.lines.forEach((l, i) => {
      const prev = oldByItem.get(l.itemId);
      const next = { countedQty: roundQty(l.countedQty), reason: l.reason ?? null };
      const changes = prev
        ? diffFields(prev, next, LINE_FIELDS)
        : [
            {
              field: 'itemCode',
              label: 'Item Code',
              before: null,
              after: byId.get(l.itemId)!.code,
            },
            ...diffFields({}, next, LINE_FIELDS),
          ];
      if (changes.length > 0) edits.push({ lineRef: `Line ${i + 1}`, changes });
    });
    for (const l of old) {
      if (newItems.has(l.itemId)) continue;
      edits.push({
        lineRef: `Line ${l.lineNo}`,
        changes: [
          { field: 'itemCode', label: 'Item Code', before: l.itemCodeText, after: null },
          {
            field: 'countedQty',
            label: 'Counted Qty',
            before: roundQty(l.countedQty),
            after: null,
          },
        ],
      });
    }
    for (const e of edits) {
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Edit,
          entity: 'StockCount',
          entityId: h.id,
          refId: h.code,
          lineRef: e.lineRef,
          changes: e.changes,
          detail: `Edited ${h.code}${e.lineRef ? ` · ${e.lineRef}` : ''}`,
        },
        companyId,
        user,
      );
    }
  });
  return getStockCount(id, user);
}

export async function submitStockCount(id: string, user: AuthContext): Promise<StockCount> {
  await requireFormAccess(user, FORM, 'entry');
  const companyId = requireCompany(user);
  await withUserContext(user, async (tx) => {
    const h = await lockHeader(tx, companyId, id);
    if (h.status !== 'draft') throw new ConflictError(`${h.code} is already ${h.status}.`);
    const ls = await liveLines(tx, id);
    if (ls.length === 0) throw new ValidationError('Add at least one item before submitting.');
    // Snapshots are taken when each line is keyed (lines.ts); Submit only
    // fills a line that somehow has none, under the item lock.
    for (const l of [...ls].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
      if (l.systemQtyAtCount !== null) continue;
      await lockItemForStock(tx, companyId, l.itemId);
      const pos = await readStockPosition(tx, companyId, l.itemId);
      await tx
        .update(stockCountLines)
        .set({
          systemQtyAtCount: roundQty(pos.physicalQty),
          updatedAt: new Date(),
          updatedBy: user.id,
        })
        .where(eq(stockCountLines.id, l.id));
    }
    const now = new Date();
    await tx
      .update(stockCounts)
      .set({
        status: 'submitted',
        submittedAt: now,
        submittedBy: user.id,
        updatedAt: now,
        updatedBy: user.id,
      })
      .where(eq(stockCounts.id, id));
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Submit,
        entity: 'StockCount',
        entityId: h.id,
        refId: h.code,
        detail: `${h.code} · ${ls.length} item(s) — system qty snapshotted`,
      },
      companyId,
      user,
    );
  });
  return getStockCount(id, user);
}

export async function approveStockCount(
  id: string,
  input: ApproveStockCountInput,
  user: AuthContext,
): Promise<StockCount> {
  await requireFormAccess(user, FORM, 'approve');
  const companyId = requireCompany(user);
  await withUserContext(user, async (tx) => {
    const h = await lockHeader(tx, companyId, id); // C8: second approver waits, then sees 'posted'
    if (h.status !== 'submitted') {
      throw new ConflictError(
        h.status === 'posted'
          ? `${h.code} is already posted.`
          : `${h.code} is ${h.status} — submit it first.`,
      );
    }
    // C7 (review): nobody who created, keyed lines on (incl. earlier saves) or
    // submitted the count may approve it.
    const keyers = await countKeyers(tx, id);
    if ([h.createdBy, h.submittedBy, ...keyers].includes(user.id)) {
      throw new AuthorizationError(
        `You counted or submitted Stock Count ${h.code}, so you cannot approve it yourself. Someone else with approve rights has to sign it off.`,
      );
    }
    const ls = await liveLines(tx, id);

    // Plan every line under its item lock before writing anything.
    type Plan = { line: (typeof ls)[number]; diff: number; code: string };
    const plans: Plan[] = [];
    const short: Array<{ itemCode: string; newInStock: number; booked: number }> = [];
    for (const l of [...ls].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
      const live = await tx
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.id, l.itemId), isNull(items.deletedAt)))
        .limit(1);
      if (!live[0]) {
        throw new ConflictError(
          `${l.itemCodeText} was deleted after the count was submitted — remove the line.`,
        );
      }
      await lockItemForStock(tx, companyId, l.itemId);
      const pos = await readStockPosition(tx, companyId, l.itemId);
      const diff = roundQty(l.countedQty - (l.systemQtyAtCount ?? 0)); // C2 / P1
      const newInStock = roundQty(pos.physicalQty + diff);
      if (newInStock < 0) {
        // C13: counted less than has since been issued — the count is stale.
        throw new ConflictError(
          `${l.itemCodeText}: posting would leave ${newInStock} in stock — more has been issued since the count than was counted. Cancel and recount this item.`,
        );
      }
      if (diff < 0 && newInStock < pos.reservedQty) {
        short.push({ itemCode: l.itemCodeText, newInStock, booked: roundQty(pos.reservedQty) });
      }
      plans.push({ line: l, diff, code: l.itemCodeText });
    }
    if (short.length > 0 && !input.confirmReason) {
      // C9 / P14: explicit confirmation, never silent.
      throw new ConflictError(
        `After this count ${short.length} item(s) will hold less than is booked for customer SOs. Confirm with a reason to post.`,
        { needsConfirmation: true, short },
      );
    }

    for (const p of plans) {
      if (p.diff === 0) continue; // C6
      const moved = await postStockMove(tx, {
        companyId,
        itemId: p.line.itemId,
        txnType: p.diff > 0 ? 'in' : 'out',
        qty: Math.abs(p.diff),
        sourceType: 'stock_count',
        sourceRef: `${h.code} · ${p.code}`,
        remarks: `Stock count ${h.purpose === 'opening' ? '(opening)' : ''} · counted ${p.line.countedQty}, system ${p.line.systemQtyAtCount ?? 0}${p.line.reason ? ` · ${p.line.reason}` : ''}`,
        txnDate: d(h.countDate),
        userId: user.id,
        itemCodeText: p.code,
        guard: 'none',
      });
      await tx
        .update(stockCountLines)
        .set({ storeTransactionId: moved.id, updatedAt: new Date(), updatedBy: user.id })
        .where(eq(stockCountLines.id, p.line.id));
    }
    const now = new Date();
    await tx
      .update(stockCounts)
      .set({
        status: 'posted',
        approvedAt: now,
        approvedBy: user.id,
        approvalReason: input.confirmReason ?? null,
        updatedAt: now,
        updatedBy: user.id,
      })
      .where(eq(stockCounts.id, id));
    const changed = plans.filter((p) => p.diff !== 0).length;
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Post,
        entity: 'StockCount',
        entityId: h.id,
        refId: h.code,
        // Net qty the count moved (sum of counted − system over changed lines).
        qty: roundQty(plans.reduce((s, p) => s + p.diff, 0)),
        reason: input.confirmReason ?? null,
        detail: `${h.code} posted · ${changed} of ${plans.length} item(s) changed${input.confirmReason ? ' · below booked confirmed' : ''}`,
      },
      companyId,
      user,
    );
  });
  return getStockCount(id, user);
}

export async function cancelStockCount(
  id: string,
  input: CancelStockCountInput,
  user: AuthContext,
): Promise<StockCount> {
  await requireFormAccess(user, FORM, 'edit');
  const companyId = requireCompany(user);
  await withUserContext(user, async (tx) => {
    const h = await lockHeader(tx, companyId, id);
    if (h.status === 'posted') {
      throw new ConflictError(`${h.code} is posted — correct it with a new count.`);
    }
    if (h.status === 'cancelled') throw new ConflictError(`${h.code} is already cancelled.`);
    const now = new Date();
    await tx
      .update(stockCounts)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: user.id,
        cancelReason: input.reason,
        updatedAt: now,
        updatedBy: user.id,
      })
      .where(eq(stockCounts.id, id));
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Cancel,
        entity: 'StockCount',
        entityId: h.id,
        refId: h.code,
        reason: input.reason,
        detail: `${h.code} cancelled (${h.status})`,
      },
      companyId,
      user,
    );
  });
  return getStockCount(id, user);
}
