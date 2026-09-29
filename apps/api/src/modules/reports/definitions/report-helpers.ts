// Small row-mapping + filter helpers shared by the ERPNext-style canned
// reports (so-line-analysis, receivable-ageing, …). Nothing here touches the
// database; each report still writes its own SQL.

/** A filter value that is a real 'YYYY-MM-DD' date, else null — so a mangled
 *  URL value is ignored instead of failing the `::date` cast with a 500. */
export function isoDateFilter(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

/** `%term%` for an ILIKE bound parameter, or null when the filter is blank.
 *  LIKE wildcards typed by the user are escaped so they match literally. */
export function likeFilter(v: string | undefined): string | null {
  const s = v?.trim() ?? '';
  if (!s) return null;
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Enum filter value if it is in the whitelist, else null. */
export function enumFilter<T extends string>(
  v: string | undefined,
  allowed: readonly T[],
): T | null {
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** Date cell → 'YYYY-MM-DD' (or null). Accepts a Date or a date string. */
export function dateCell(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s ? s.slice(0, 10) : null;
}

/** Number cell → number (null/blank → 0). */
export function numCell(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Text cell → string or null. */
export function textCell(v: unknown): string | null {
  return v == null ? null : String(v);
}

export type SqlRow = Record<string, unknown>;
