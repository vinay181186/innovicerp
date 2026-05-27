// 'general' added for QC/TPI/Op-Entry parity with legacy (Day/Night/General).
// Migration 0044 adds it to the Postgres `shift` enum.
export const SHIFTS = ['day', 'night', 'general'] as const;

export type Shift = (typeof SHIFTS)[number];

export const SHIFT_LABELS: Record<Shift, string> = {
  day: 'Day',
  night: 'Night',
  general: 'General',
};
