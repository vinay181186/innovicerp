// Document traceability (new-ERP navigation enhancement; not a legacy feature).
//
// One generic shape for EVERY document's "Related Documents" panel, populated by
// each module's read-only GET /<module>/:id/related endpoint. The panel shows
// four parts — Upstream (parents), Downstream (children), Related (lateral), and
// a Document Timeline — all derived from real foreign keys. No business rule is
// changed; this is pure read-side navigation.
//
// Rule #10 (never invent relationships): every section/edge a backend emits must
// come from an actual FK column or a verified workflow link. Rule #8 (no dead
// links): a row is clickable only when its `routeKind` maps to a real typed route
// in the web RelatedDocsPanel registry; otherwise it renders as reference text.

import { z } from 'zod';

/** One related-document row. `code` is the human identifier; `status`/`date` are
 *  minimal display fields (nullable — not every source has them). `linkId`
 *  overrides the detail-route param when the route is scoped by a different id
 *  than this row's own (e.g. assembly units link to /assemblies/$soId). `label`
 *  is an optional trailing descriptor (client/item/vendor name). */
export const relatedDocSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: z.string().nullable().default(null),
  date: z.string().nullable().default(null), // ISO date
  linkId: z.string().nullable().default(null),
  label: z.string().nullable().default(null),
});
export type RelatedDoc = z.infer<typeof relatedDocSchema>;

/** A titled group of related docs of one type (e.g. "Purchase Orders (3)").
 *  `routeKind` selects the typed Link in the web registry; null or an unknown
 *  kind => reference-only rendering (no dead link). */
export const relatedSectionSchema = z.object({
  key: z.string(),
  title: z.string(),
  icon: z.string().default(''),
  routeKind: z.string().nullable().default(null),
  count: z.number().int().nonnegative(),
  items: z.array(relatedDocSchema),
});
export type RelatedSection = z.infer<typeof relatedSectionSchema>;

/** One chronological event on a document's timeline. Assembled server-side from
 *  the document's own dates plus the dates of its FK-linked docs — never
 *  synthesized. `ts` is an ISO date/datetime; `routeKind`+`linkId` make the
 *  event clickable when a route exists. */
export const relatedTimelineEventSchema = z.object({
  ts: z.string().nullable().default(null),
  label: z.string(),
  code: z.string().nullable().default(null),
  routeKind: z.string().nullable().default(null),
  linkId: z.string().nullable().default(null),
});
export type RelatedTimelineEvent = z.infer<typeof relatedTimelineEventSchema>;

/** Full traceability payload for one document. Every array is always present
 *  (empty => that part hides in the UI). `self` identifies the anchor document
 *  for the panel header. */
export const documentTraceabilitySchema = z.object({
  self: z
    .object({ module: z.string(), code: z.string() })
    .nullable()
    .default(null),
  upstream: z.array(relatedSectionSchema).default([]),
  downstream: z.array(relatedSectionSchema).default([]),
  related: z.array(relatedSectionSchema).default([]),
  timeline: z.array(relatedTimelineEventSchema).default([]),
});
export type DocumentTraceability = z.infer<typeof documentTraceabilitySchema>;
