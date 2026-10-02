// Audit-trail helpers (ADR-197) — pure, no database imports, so any service
// (and a unit test) can use them. The writer itself is emitActivityLog in
// modules/activity-log/service.ts; docs/AUDIT-TRAIL.md shows how they fit.
//
//   diffFields(before, after, fields)  → the `changes` array for an Edit
//   softDeleteStamp(user)              → { deletedAt, deletedBy } for a delete
//   restoreStamp()                     → { deletedAt: null, deletedBy: null }

import type { ActivityChange, ActivityChangeValue } from '@innovic/shared';

/** One field a service wants compared on Edit. `label` is the screen label
 *  from docs/NAMING.md; `format` turns the raw value into what a person reads
 *  (a vendor id → its code, a date → DD-MMM-YYYY). */
export interface DiffField {
  key: string;
  label: string;
  format?: ((value: unknown) => ActivityChangeValue) | undefined;
}

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

function isNumericLike(v: unknown): boolean {
  return (
    (typeof v === 'number' && Number.isFinite(v)) ||
    (typeof v === 'string' && NUMERIC_RE.test(v.trim()))
  );
}

/** undefined / '' / null all mean "empty"; a Date becomes its ISO string. */
function normalize(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  // Drizzle numerics arrive as strings ("10.000"), inputs as numbers (10).
  if (isNumericLike(a) && isNumericLike(b)) return Number(a) === Number(b);
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function toChangeValue(v: unknown): ActivityChangeValue {
  if (v === null) return null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return JSON.stringify(v);
}

/**
 * The before → after list for an Edit: ONLY the fields whose value changed.
 *
 * A key that is absent from `after` (undefined — a partial PATCH that did not
 * send it) is not a change and is skipped. Empty string, null and undefined
 * count as the same "empty". Numbers compare numerically, so "10.000" → 10 is
 * not a change. Dates compare by instant.
 *
 * Returns [] when nothing changed — the caller then logs no EDIT at all.
 */
export function diffFields(
  before: object,
  after: object,
  fields: readonly DiffField[],
): ActivityChange[] {
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const out: ActivityChange[] = [];
  for (const f of fields) {
    if (!(f.key in a) || a[f.key] === undefined) continue;
    const prev = normalize(b[f.key]);
    const next = normalize(a[f.key]);
    if (sameValue(prev, next)) continue;
    // A numeric field reads as numbers on both sides ("10.000" → 10), so the
    // History tab prints "10 → 12", not "10.000 → 12".
    const numeric =
      (prev === null || isNumericLike(prev)) &&
      (next === null || isNumericLike(next)) &&
      (prev !== null || next !== null);
    out.push({
      field: f.key,
      label: f.label,
      before: f.format
        ? f.format(b[f.key] ?? null)
        : numeric && prev !== null
          ? Number(prev)
          : toChangeValue(prev),
      after: f.format
        ? f.format(a[f.key] ?? null)
        : numeric && next !== null
          ? Number(next)
          : toChangeValue(next),
    });
  }
  return out;
}

/**
 * True when two raw values are "the same change" by the EXACT rules diffFields
 * uses: undefined / '' / null all mean empty, a Date compares by instant, and
 * numerics compare numerically ("10.000" === 10). The edit-approval engine uses
 * this to decide, at approval time, whether a document's current value has
 * drifted from the `before` captured when the edit was requested.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  return sameValue(normalize(a), normalize(b));
}

/** The two columns a soft delete sets. Spread into the UPDATE:
 *  `.set({ ...softDeleteStamp(user), updatedBy: user.id })`. */
export function softDeleteStamp(user: { id: string }): { deletedAt: Date; deletedBy: string } {
  return { deletedAt: new Date(), deletedBy: user.id };
}

/** The two columns a restore clears (the RESTORE log row keeps who did it). */
export function restoreStamp(): { deletedAt: null; deletedBy: null } {
  return { deletedAt: null, deletedBy: null };
}
