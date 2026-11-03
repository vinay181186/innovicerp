// Production accountability helpers (ADR-197, requirement 3.2) — pure, shared
// by op-entry, jc-ops and the op-log reversal so every production row names
// the op the same way.

import { opSrNo } from '@innovic/shared';
import { fmtClock, fmtDate } from '../../lib/format-date';

/** `opRef` on an activity_log row: "Op 20 · Turning" (docs/AUDIT-TRAIL.md). */
export function jcOpRef(opSeq: number, operation: string | null | undefined): string {
  const name = operation?.trim();
  return name ? `Op ${opSrNo(opSeq)} · ${name}` : `Op ${opSrNo(opSeq)}`;
}

/** "28-09-2026 02:05 PM" / "28-09-2026" — a log entry's date + clock time, in
 *  the one display format (lib/format-date, owner decision 2026-11-03). */
export function logWhen(date: string, time: string | null | undefined): string {
  const clock = fmtClock(time);
  return clock ? `${fmtDate(date)} ${clock}` : fmtDate(date);
}
