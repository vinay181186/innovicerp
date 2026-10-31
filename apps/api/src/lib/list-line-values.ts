// ADR-261 — the small value readers every one-row-per-line list (`…/lines`)
// uses to turn a raw `tx.execute()` row into its Zod row. One copy here
// instead of one per module.
//
// A raw execute() hands timestamptz / date back either as a Date or as
// Postgres text ("2026-10-21 11:53:54.58+00", "2026-10-21"); these make both
// shapes read the same on the wire.

/** Text or null — null/undefined stay null, anything else becomes its string. */
export const str = (v: unknown): string | null => (v == null ? null : String(v));

/** A timestamp as ISO-8601 (Postgres text is parsed; unparseable text is sent as-is). */
export const iso = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v ?? ''));
  return Number.isNaN(d.getTime()) ? String(v ?? '') : d.toISOString();
};

/** A calendar day as yyyy-mm-dd (a `date` column, or the first 10 chars of its text). */
export const day = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);
