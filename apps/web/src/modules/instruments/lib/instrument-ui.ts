// Instrument register (ADR-193 phase 4a) — shared display helpers.
import type { InstrumentStatus } from '@innovic/shared';
import { daysBetweenLocal, todayIst } from '@/lib/date';

export const INSTRUMENT_STATUS_BADGE: Record<InstrumentStatus, string> = {
  in_store: 'b-green',
  issued: 'b-blue',
  at_calibration: 'b-amber',
  lost: 'b-red',
  scrapped: 'b-grey',
};

/** Days before Calibration Due that turn the date amber. */
export const DUE_SOON_DAYS = 7;

export type DueTone = 'overdue' | 'soon' | 'ok' | 'none';

/** Overdue comes from the server (IST); "soon" = due within the next 7 days. */
export function dueTone(dueOn: string | null, isOverdue: boolean): DueTone {
  if (!dueOn) return 'none';
  if (isOverdue) return 'overdue';
  const d = daysBetweenLocal(todayIst(), dueOn);
  return d !== null && d <= DUE_SOON_DAYS ? 'soon' : 'ok';
}

export const DUE_COLOUR: Record<DueTone, string | undefined> = {
  overdue: 'var(--red2)',
  soon: 'var(--amber2)',
  ok: undefined,
  none: undefined,
};

export function errText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
