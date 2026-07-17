// Server-side helpers for the read-only document-traceability endpoints
// (GET /<module>/:id/related). Each module builds RelatedSection[] from its own
// FK queries and returns a DocumentTraceability; these helpers keep the shape,
// date handling, and timeline assembly identical across every module.
//
// No business rule lives here — it is pure read-side shaping.

import type { RelatedDoc, RelatedSection, RelatedTimelineEvent } from '@innovic/shared';

/** Coerce any DB date/timestamp value to a bare ISO date string ('YYYY-MM-DD'),
 *  or null. Drizzle `date` columns already come back as strings (default mode),
 *  but `timestamp` columns come back as Date — this normalises both so timeline
 *  sorting (lexical string compare) is always safe. `Date#toISOString().slice(0,10)`
 *  is UTC-stable for date-only values (see postgres.js date-OID note). */
export function toIsoDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  // Already an ISO-ish string; take the leading date portion.
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/** Build one titled section. `routeKind` must match a key in the web
 *  RelatedDocsPanel ROUTE_LINKS registry to be clickable; null => reference-only. */
export function section(
  key: string,
  title: string,
  icon: string,
  routeKind: string | null,
  rows: RelatedDoc[],
): RelatedSection {
  return { key, title, icon, routeKind, count: rows.length, items: rows };
}

/** Assemble a chronological timeline from the anchor document plus every dated
 *  row across the given sections. Nothing is synthesized — each event is a real
 *  FK-linked document with its own date. Sorted ascending; undated rows drop out.
 *  `self` is the anchor doc's own creation event (optional). */
export function buildTimeline(
  self: {
    ts: string | null;
    label: string;
    code: string | null;
    routeKind: string | null;
    linkId: string | null;
  } | null,
  sections: RelatedSection[],
): RelatedTimelineEvent[] {
  const events: RelatedTimelineEvent[] = [];
  if (self) {
    events.push({
      ts: self.ts,
      label: self.label,
      code: self.code,
      routeKind: self.routeKind,
      linkId: self.linkId,
    });
  }
  for (const s of sections) {
    for (const d of s.items) {
      if (!d.date) continue;
      events.push({
        ts: d.date,
        label: s.title,
        code: d.code,
        routeKind: s.routeKind,
        linkId: d.linkId ?? d.id,
      });
    }
  }
  // ISO date strings sort correctly lexically; undated events sink to the end.
  events.sort((a, b) => (a.ts ?? '9999-99-99').localeCompare(b.ts ?? '9999-99-99'));
  return events;
}
