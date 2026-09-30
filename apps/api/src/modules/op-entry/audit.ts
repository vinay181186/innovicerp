// Production accountability helpers (ADR-197, requirement 3.2) — pure, shared
// by op-entry, jc-ops and the op-log reversal so every production row names
// the op the same way.

import { opSrNo } from '@innovic/shared';

/** `opRef` on an activity_log row: "Op 20 · Turning" (docs/AUDIT-TRAIL.md). */
export function jcOpRef(opSeq: number, operation: string | null | undefined): string {
  const name = operation?.trim();
  return name ? `Op ${opSrNo(opSeq)} · ${name}` : `Op ${opSrNo(opSeq)}`;
}

/** "2026-09-28 14:05" / "2026-09-28" — a log entry's date + clock time. */
export function logWhen(date: string, time: string | null | undefined): string {
  return time ? `${date} ${time.slice(0, 5)}` : date;
}
