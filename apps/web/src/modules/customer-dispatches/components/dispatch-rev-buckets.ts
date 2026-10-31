// Phase C (owner model 2026-10-31): an SO line can hold ready pieces of two
// Drawing Revs — JC-1 closed at ABC/1, JC-2 at ABC/2. The dispatchable line
// then carries one `revBuckets` entry per Item + Rev, and the dispatch picks
// ONE Rev per row: the same SO line may appear twice, once per Rev, each row
// sending its own `itemRevisionId`. A line with no buckets (Buy item, or a
// server that sends none) keeps the old one-row-per-line behaviour.

import type { DispatchableLine } from '@innovic/shared';

export type RevBucket = DispatchableLine['revBuckets'][number];

/** The picker option id of one row: the SO line alone, or SO line + Rev
 *  bucket ("<lineId>|<itemRevisionId or ''>" — '' = the no-Rev bucket). */
export function rowOptionKey(soLineId: string, itemRevisionId: string | null | undefined): string {
  return itemRevisionId === undefined ? soLineId : `${soLineId}|${itemRevisionId ?? ''}`;
}

/** Back from an option id to the SO line + Rev bucket it names. */
export function parseRowOptionKey(key: string): {
  soLineId: string;
  itemRevisionId: string | null | undefined;
} {
  const i = key.indexOf('|');
  if (i < 0) return { soLineId: key, itemRevisionId: undefined };
  const rev = key.slice(i + 1);
  return { soLineId: key.slice(0, i), itemRevisionId: rev || null };
}

/** The Rev bucket a row draws from, or null for a line without buckets. */
export function rowBucket(
  line: DispatchableLine | null,
  itemRevisionId: string | null | undefined,
): RevBucket | null {
  if (!line || itemRevisionId === undefined || line.revBuckets.length === 0) return null;
  return line.revBuckets.find((b) => (b.itemRevisionId ?? null) === itemRevisionId) ?? null;
}

/** What one row may send: the line's own cap (Dispatchable, capped at
 *  Pending), and within a Rev bucket no more than that Rev has ready. */
export function rowCap(line: DispatchableLine, bucket: RevBucket | null): number {
  const lineCap = Math.min(line.availableQty, line.pendingQty);
  return bucket ? Math.max(0, Math.min(lineCap, bucket.readyQty)) : lineCap;
}
