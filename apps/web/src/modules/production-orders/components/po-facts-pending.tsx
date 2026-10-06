// The pending-edit chip helpers the Production Order Edit page uses (ADR-202
// Phase 3). Same logic as the two private helpers in routes/detail.tsx, which
// stays untouched this round — when the detail page is next opened up it can
// import these and drop its own copies.

import type { DocumentEditChange } from '@innovic/shared';
import {
  PendingChangeChip,
  headerPendingChange,
} from '@/modules/document-edits/components/pending-change-chip';

/** A staged header edit waiting for approval, for one field: the orange
 *  "→ after" chip, and a hover text naming the proposed value in full. The
 *  chip is never cut short; a cell too narrow for it wraps. */
export function pendingFor(
  changes: readonly DocumentEditChange[],
  field: string,
): { chip: React.ReactNode; title: string } | null {
  const c = headerPendingChange(changes, field);
  if (!c) return null;
  const after = c.after === null || c.after === '' ? '—' : String(c.after);
  return {
    chip: <PendingChangeChip after={c.after} />,
    title: `Waiting for approval: → ${after}`,
  };
}
