// Shared JC op label maps.
//
// Moved verbatim out of jc-status-content.tsx (which was past the 400-line
// rule) so the Operations Detail CARD (jc-op-card.tsx), the status VIEW and the
// status EDIT branch all read the same wording/colour from one place instead of
// keeping local copies. No behaviour change — the maps are byte-identical to
// the ones they replace.

import type { OutsourceStatus } from '@innovic/shared';

// Mirrors legacy badge() (L1959-1970) for the op status strings it maps.
// Two legacy entries are inert: badge('In Progress') → `b-yellow` and
// badge('Running') → `b-running`, neither of which legacy's <style> defines —
// so they render unstyled in legacy too. We keep our `b-amber` for both rather
// than port a no-op class (same call the SO Status port made for `b-blue`).
export const OP_STATUS: Record<string, { label: string; cls: string }> = {
  waiting: { label: 'Waiting', cls: 'b-red' },
  available: { label: 'Available', cls: 'b-blue' },
  in_progress: { label: 'In Progress', cls: 'b-amber' },
  running: { label: 'Running', cls: 'b-amber' },
  qc_pending: { label: 'QC Pending', cls: 'b-amber' },
  complete: { label: 'Complete', cls: 'b-green' },
  pr_raised: { label: 'PR Raised', cls: 'b-amber' },
  po_created: { label: 'PO Created', cls: 'b-blue' },
  at_vendor: { label: 'Processing', cls: 'b-amber' },
  received: { label: 'Incoming QC', cls: 'b-cyan' },
  ready_for_pr: { label: 'Ready for PR', cls: 'b-amber' },
  outsource: { label: 'Outsource', cls: 'b-amber' },
};

// Legacy stores outsourceStatus as Title Case strings ('Pending', 'PR Raised',
// 'PO Created', …) and renders them raw (L11043, L11075). Ours is the pg enum
// `outsource_status`, so rendering it raw shows `pr_raised` where legacy shows
// `PR Raised`. This maps our enum back to legacy's exact wording.
//
// Kept separate from OP_STATUS above: that map is keyed for a different field
// (jc_ops computed status, read only at the Status column) and has no entry for
// `pending` or `sent` — two of the five outsource values — so reusing it would
// leave those rendering raw. `Record<OutsourceStatus, string>` makes the
// compiler enforce all five.
export const OUTSOURCE_STATUS_LABEL: Record<OutsourceStatus, string> = {
  pending: 'Pending',
  pr_raised: 'PR Raised',
  po_created: 'PO Created',
  sent: 'Sent',
  received: 'Received',
};

/** Left accent bar colour for an op card, derived from the SAME `cls` the
 *  status badge already uses — so the bar can never disagree with the badge. */
export function opAccentColor(cls: string): string {
  if (cls === 'b-green') return 'var(--green)';
  if (cls === 'b-amber') return 'var(--amber)';
  if (cls === 'b-blue') return 'var(--blue)';
  if (cls === 'b-cyan') return 'var(--cyan)';
  if (cls === 'b-red') return 'var(--red)';
  return 'var(--border2)';
}
