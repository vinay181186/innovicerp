// Server-side helpers for the read-only document-traceability endpoints
// (GET /<module>/:id/related). Each module builds RelatedSection[] from its own
// FK queries and returns a DocumentTraceability; these helpers keep the shape,
// date handling, and timeline assembly identical across every module.
//
// No business rule lives here — it is pure read-side shaping.

import { itemCodeWithRev } from '@innovic/shared';
import type {
  RelatedDoc,
  RelatedItem,
  RelatedSection,
  RelatedTimelineEvent,
} from '@innovic/shared';

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

/** A row as a builder writes it. Its items come from the section's options. */
export type RelatedRow = Omit<RelatedDoc, 'items'>;

/** Every section states where its items come from, or why it has none. Required, so
 *  a new tab cannot compile without answering (owner 2026-11-05: no missing item
 *  detail). `items` is keyed by the row's id: see loadRelatedItems. */
export type RelatedSectionOptions = (
  | { items: ReadonlyMap<string, RelatedItem[]> }
  | { noItems: string }
) & {
  labelHeading?: string;
  codeHeading?: string;
};

/** Build one titled section. `routeKind` must match a key in the web
 *  RelatedDocsPanel ROUTE_LINKS registry to be clickable; null => reference-only. */
export function section(
  key: string,
  title: string,
  icon: string,
  routeKind: string | null,
  rows: RelatedRow[],
  options: RelatedSectionOptions,
): RelatedSection {
  const itemsOf = 'items' in options ? options.items : null;
  return {
    key,
    title,
    icon,
    routeKind,
    count: rows.length,
    itemMode: itemsOf ? 'documents' : 'none',
    codeHeading: options.codeHeading ?? null,
    labelHeading: options.labelHeading ?? null,
    items: rows.map((r) => ({ ...r, items: itemsOf?.get(r.id) ?? [] })),
  };
}

/** The Item tab: one row per distinct item + Rev, built from the document's lines
 *  so a free-text line is listed too, not dropped. */
export function itemSection(
  key: string,
  title: string,
  icon: string,
  lines: readonly RelatedItem[],
): RelatedSection {
  const seen = new Set<string>();
  const rows: RelatedDoc[] = [];
  for (const it of lines) {
    const id = it.lineId ?? it.itemId;
    if (!id) continue;
    const k = `${it.itemId ?? it.itemCode ?? id}|${it.itemRevision ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({
      id,
      code: itemCodeWithRev(it.itemCode, it.itemRevision),
      status: null,
      date: null,
      linkId: it.itemId,
      label: it.itemName,
      items: [it],
    });
  }
  return {
    key,
    title,
    icon,
    routeKind: 'item',
    count: rows.length,
    itemMode: 'items',
    codeHeading: null,
    labelHeading: null,
    items: rows,
  };
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
    /** The anchor document's own items, so its event names them too. */
    items?: readonly RelatedItem[];
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
      item: self.items?.[0] ?? null,
      moreItems: Math.max((self.items?.length ?? 0) - 1, 0),
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
        item: d.items[0] ?? null,
        moreItems: Math.max(d.items.length - 1, 0),
      });
    }
  }
  // ISO date strings sort correctly lexically; undated events sink to the end.
  events.sort((a, b) => (a.ts ?? '9999-99-99').localeCompare(b.ts ?? '9999-99-99'));
  return events;
}

/** The most rows a master record's Related Documents section lists (ADR-190).
 *  A customer or an item can own hundreds of documents; the section shows the
 *  newest this many and its `count` still says how many there are in all. */
export const MASTER_RELATED_ROW_CAP = 50;

/** Raw-SQL rows for one master section → a section. Each row carries
 *  `id, code, status, date, label` and `total` (count(*) OVER () — the full
 *  number before the cap), so the heading count is true even when capped. */
export function masterSection(
  key: string,
  title: string,
  icon: string,
  routeKind: string | null,
  raw: unknown,
  options: RelatedSectionOptions,
): RelatedSection {
  const rows = raw as Array<Record<string, unknown>>;
  const items: RelatedRow[] = rows.map((r) => ({
    id: String(r['id']),
    code: String(r['code'] ?? ''),
    status: r['status'] != null ? String(r['status']) : null,
    date: toIsoDate(r['date']),
    linkId: null,
    label: r['label'] != null ? String(r['label']) : null,
  }));
  const s = section(key, title, icon, routeKind, items, options);
  const total = rows[0] ? Number(rows[0]['total'] ?? rows.length) : 0;
  return { ...s, count: Math.max(total, items.length) };
}
