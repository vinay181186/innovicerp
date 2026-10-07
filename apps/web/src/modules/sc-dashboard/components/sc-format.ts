// Supply Chain Dashboard — shared pure formatters for the page and its column
// builders. No JSX here.

import type { PoStatus } from '@innovic/shared';
import { PO_STATUS_BADGE_CLASSES } from '@/modules/purchase-orders/components/po-status-badge';
import { PO_STATUS_CHOICES, PO_STATUS_LABELS } from '@/modules/purchase-orders/lib/po-labels';

export function inr(n: number | null): string {
  if (n == null) return '';
  return Math.round(n).toLocaleString('en-IN');
}

// PO status → badge class + the words the user reads. ADR-222: BOTH come from
// the purchase-orders module's one map. This file used to carry its own
// hand-typed copy, which had drifted twice over — it still said "Partly
// Received" / "QC Pending" for the two retired codes, and it labelled a DRAFT
// purchase order "Open" because anything it did not recognise fell through to
// Open. An unknown status now reads as itself, not as Open.
export function statusBadge(s: string): { cls: string; label: string } {
  const known = (PO_STATUS_LABELS as Record<string, string | undefined>)[s] !== undefined;
  if (!known) return { cls: 'b-grey', label: s.replaceAll('_', ' ') };
  const status = s as PoStatus;
  return { cls: PO_STATUS_BADGE_CLASSES[status], label: PO_STATUS_LABELS[status] };
}

/** PO Status tick list for server Sort & Filter: stored value + the label shown.
 *  The same membership as before MINUS the two retired codes (ADR-222) — these
 *  dashboard queries never return a draft PO, so Draft is still not offered. */
export const PO_STATUS_OPTIONS = PO_STATUS_CHOICES.filter((value) => value !== 'draft').map(
  (value) => ({ value, label: PO_STATUS_LABELS[value] }),
);
