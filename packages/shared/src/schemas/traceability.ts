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

/** One item a related document concerns, in the ONE standard form (owner
 *  2026-11-05): POL, Item Code + its Drawing Rev, Item Name. The screen writes the
 *  code through itemCodeWithRev. `itemId` is null when the line is free text or the
 *  item was deleted, so the code renders as plain text and never a dead link.
 *  `lineId` is the document line (or the document itself when it has no lines). */
export const relatedItemSchema = z.object({
  lineId: z.string().uuid().nullable().default(null),
  itemId: z.string().uuid().nullable().default(null),
  itemCode: z.string().nullable().default(null),
  itemRevision: z.string().nullable().default(null),
  itemName: z.string().nullable().default(null),
  clientPoLineNo: z.string().nullable().default(null),
});
export type RelatedItem = z.infer<typeof relatedItemSchema>;

/** One related-document row. `code` is the human identifier; `status`/`date` are
 *  minimal display fields (nullable — not every source has them). `linkId`
 *  overrides the detail-route param when the route is scoped by a different id
 *  than this row's own (e.g. assembly units link to /assemblies/$soId). `label`
 *  is the one extra fact this tab names under its `labelHeading` (vendor name,
 *  Internal SO No., Op…), never the item. `items` is the item(s) this row concerns,
 *  scoped to the lines that link it to the anchor. */
export const relatedDocSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: z.string().nullable().default(null),
  date: z.string().nullable().default(null), // ISO date
  linkId: z.string().nullable().default(null),
  label: z.string().nullable().default(null),
  items: z.array(relatedItemSchema).default([]),
});
export type RelatedDoc = z.infer<typeof relatedDocSchema>;

/** How a tab reads. 'documents' = Document No. + the standard item columns.
 *  'items' = the rows ARE items (Item Code, Item Name). 'none' = no item columns:
 *  a party, or a document list on a page that is already that item. */
export const RELATED_ITEM_MODES = ['documents', 'items', 'none'] as const;
export type RelatedItemMode = (typeof RELATED_ITEM_MODES)[number];

/** A titled group of related docs of one type (e.g. "Purchase Orders (3)").
 *  `routeKind` selects the typed Link in the web registry; null or an unknown
 *  kind => reference-only rendering (no dead link). */
export const relatedSectionSchema = z.object({
  key: z.string(),
  title: z.string(),
  icon: z.string().default(''),
  routeKind: z.string().nullable().default(null),
  count: z.number().int().nonnegative(),
  itemMode: z.enum(RELATED_ITEM_MODES).default('none'),
  /** Heading of the first column; null = "Document No.". */
  codeHeading: z.string().nullable().default(null),
  /** Heading of the `label` column; null = this tab has no such column. */
  labelHeading: z.string().nullable().default(null),
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
  /** The event's first item, and how many more the document carries. */
  item: relatedItemSchema.nullable().default(null),
  moreItems: z.number().int().nonnegative().default(0),
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
