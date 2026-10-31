// New Customer Dispatch — the row logic behind the create form, moved out of
// routes/create.tsx unchanged (Phase C rev buckets made the route too long).
// Three pure steps: pre-fill the pending rows, check every row while typing,
// and build the payload on Save. The route keeps the state and the screen.

import type { CreateCustomerDispatchInput, DispatchableLine } from '@innovic/shared';
import type { LineCard } from './dispatch-line-table';
import { rowBucket, rowOptionKey } from './dispatch-rev-buckets';

type ResolveLine = (soLineId: string | null) => DispatchableLine | null;
type PayloadLine = CreateCustomerDispatchInput['lines'][number];

/** FLOW HELPER: one card per SO line that still has a pending qty and is not
 *  already on a card, pre-filled with the most the live check allows (pending,
 *  capped at what can go now). A line that can send nothing right now is added
 *  blank so the user still sees it. `nextId` hands out the card ids. */
export function pendingLineCards(
  lines: readonly DispatchableLine[],
  existing: readonly LineCard[],
  nextId: () => number,
): LineCard[] {
  const onCards = new Set(existing.map((c) => c.soLineId));
  return lines
    .filter((l) => l.pendingQty > 0 && !onCards.has(l.salesOrderLineId))
    .flatMap((l): LineCard[] => {
      const cap = Math.min(l.availableQty, l.pendingQty);
      if (l.revBuckets.length === 0) {
        return [{ id: nextId(), soLineId: l.salesOrderLineId, qty: cap > 0 ? String(cap) : '' }];
      }
      // Phase C — one row per Drawing Rev bucket, filled in order until the
      // line's cap is used up; the user moves pieces between Revs by hand.
      let left = cap;
      return l.revBuckets.map((b) => {
        const take = Math.max(0, Math.min(left, b.readyQty));
        left -= take;
        return {
          id: nextId(),
          soLineId: l.salesOrderLineId,
          itemRevisionId: b.itemRevisionId ?? null,
          qty: take > 0 ? String(take) : '',
        };
      });
    });
}

/** Live per-line validation (no silent clamp): a qty over what the customer is
 *  still owed is a hard block — the row shows a message and Save stays off.
 *
 *  ADR-180: the cap is PENDING (order − dispatched), not the old "ready +
 *  reserved" figure; the API checks there are enough pieces to draw on. */
export function checkDispatchRows(
  cards: readonly LineCard[],
  resolveLine: ResolveLine,
): { lineErrors: Map<number, string>; anyPositiveQty: boolean } {
  const lineErrors = new Map<number, string>();
  let anyPositiveQty = false;
  // Phase C — rows of one SO line (one per Drawing Rev) share the line's cap.
  const lineTotals = new Map<string, number>();
  for (const c of cards) {
    const line = resolveLine(c.soLineId);
    if (!line) continue;
    const raw = c.qty.trim() === '' ? 0 : Number(c.qty);
    if (Number.isNaN(raw) || raw < 0) {
      lineErrors.set(c.id, 'Enter a valid quantity.');
      continue;
    }
    const bucket = rowBucket(line, c.itemRevisionId);
    if (bucket && raw > bucket.readyQty) {
      lineErrors.set(
        c.id,
        `Dispatch Qty cannot be more than Ready for ${bucket.label} (${bucket.readyQty}).`,
      );
      continue;
    }
    const lineSum = (lineTotals.get(line.salesOrderLineId) ?? 0) + raw;
    lineTotals.set(line.salesOrderLineId, lineSum);
    // Cap at the SAME number the server enforces (`availableQty`, itself
    // already capped at pending), so the refusal shows while typing.
    const cap = Math.min(line.availableQty, line.pendingQty);
    if (lineSum > cap) {
      lineErrors.set(
        c.id,
        cap === line.pendingQty
          ? `Dispatch Qty cannot be more than Pending (${cap}).`
          : `Dispatch Qty cannot be more than Dispatchable (${cap}).`,
      );
      continue;
    }
    if (raw > 0) anyPositiveQty = true;
  }
  return { lineErrors, anyPositiveQty };
}

/** Resolve each card → SO line and VALIDATE (no silent clamp), then build the
 *  payload: one row per SO line + Drawing Rev bucket (Phase C). Returns the
 *  first error instead when a row is wrong. */
export function buildDispatchPayloadLines(
  cards: readonly LineCard[],
  resolveLine: ResolveLine,
): { lines: PayloadLine[] } | { error: string } {
  const byRow = new Map<string, PayloadLine>();
  const sentPerLine = new Map<string, number>();
  for (const c of cards) {
    const line = resolveLine(c.soLineId);
    if (!line) return { error: 'Pick an item on every line (or remove the empty line).' };
    const raw = c.qty.trim() === '' ? 0 : Number(c.qty);
    if (Number.isNaN(raw) || raw < 0) {
      return { error: `${line.itemName}: enter a valid Dispatch Qty.` };
    }
    const lineCap = Math.min(line.availableQty, line.pendingQty);
    const lineSum = (sentPerLine.get(line.salesOrderLineId) ?? 0) + raw;
    sentPerLine.set(line.salesOrderLineId, lineSum);
    if (lineSum > lineCap) {
      return {
        error: `${line.itemName}: Dispatch Qty (${lineSum}) cannot be more than Dispatchable (${lineCap}).`,
      };
    }
    const bucket = rowBucket(line, c.itemRevisionId);
    if (bucket && raw > bucket.readyQty) {
      return {
        error: `${bucket.label}: Dispatch Qty (${raw}) cannot be more than Ready (${bucket.readyQty}).`,
      };
    }
    if (raw <= 0) continue;
    const key = rowOptionKey(line.salesOrderLineId, bucket ? c.itemRevisionId : undefined);
    const prev = byRow.get(key);
    if (prev) prev.qty += raw;
    else
      byRow.set(key, {
        salesOrderLineId: line.salesOrderLineId,
        ...(bucket ? { itemRevisionId: bucket.itemRevisionId ?? null } : {}),
        qty: raw,
      });
  }
  return { lines: [...byRow.values()] };
}
