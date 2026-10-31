// Item + Drawing Rev register (owner model 2026-10-31).
//
// "ABC/1" — Item ABC at the customer's Drawing Rev 1 — is ONE record holding
// one drawing. Whichever document names it first creates it: an SO line, a
// JWSO line, a Route Card or a BOM child line. Every later document that types
// the same item + Rev links to the same record and gets its drawing filled in.
//
//   • One Route Card per Item + Rev (DB unique on route_cards.item_revision_id).
//   • A wrong file for the same Rev is fixed only by "Replace drawing" with a
//     compulsory reason; the old file stays in the history.
//   • Rev applies to MAKE items only (items.procurement_type = 'make'). Buy
//     items and raw material carry no Rev (item_revision_id stays null).
//   • A Rev change on an SO/JWSO line moves only OPEN Job Cards (and their
//     plan / PRO); closed Job Cards, the stock they made, dispatches and
//     invoices keep the Rev they were made with. All JCs closed → blocked.
//
// Naming: the field is "Drawing Rev" (`drawingRev`). It is NOT the Route Card
// edit counter ("Route Card Rev R0/R1", route_cards.current_revision), and NOT
// the legacy items.revision. The link column is `itemRevisionId` everywhere.

import { z } from 'zod';
import { REVISION_PATTERN } from '../lib/revision';
import { expectedUpdatedAtSchema } from '../lib/edit-conflict';

/** The Drawing Rev typed by a user: trimmed, upper-cased, same pattern as the
 *  SO line Rev (lib/revision.ts). */
export const drawingRevInputSchema = z
  .string()
  .trim()
  .min(1, 'Drawing Rev is required')
  .max(32)
  .transform((s) => s.toUpperCase())
  .refine((s) => REVISION_PATTERN.test(s), 'Drawing Rev: letters, digits, . - / only');

/** "ABC/1" — the one way an Item + Rev is written on every screen and print. */
export function itemRevLabel(itemCode: string | null | undefined, rev: string | null | undefined): string {
  const code = (itemCode ?? '').trim() || '—';
  const r = (rev ?? '').trim();
  return r ? `${code}/${r}` : code;
}

/** Where a register record (or a drawing change) came from. */
export const ITEM_REVISION_SOURCES = ['so_line', 'jw_line', 'route_card', 'bom_line', 'ml_bom_line', 'legacy'] as const;
export type ItemRevisionSource = (typeof ITEM_REVISION_SOURCES)[number];

/** Drawing history actions. `born` = first file; `adopted` = a record that had
 *  no file got one; `copied` = "Use as is" carried another Rev's file;
 *  `replaced` = wrong file fixed with a reason; `cleared` = file removed. */
export const ITEM_REVISION_DRAWING_ACTIONS = ['born', 'adopted', 'copied', 'replaced', 'cleared'] as const;
export type ItemRevisionDrawingAction = (typeof ITEM_REVISION_DRAWING_ACTIONS)[number];

// ─── Read shapes ───────────────────────────────────────────────────────────

export const itemRevisionSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  itemId: z.string().uuid(),
  itemCode: z.string().nullable().default(null),
  itemName: z.string().nullable().default(null),
  drawingRev: z.string(),
  /** itemRevLabel(itemCode, drawingRev) — "ABC/1". */
  label: z.string(),
  drawingFilePath: z.string().nullable(),
  drawingNo: z.string().nullable(),
  sourceType: z.enum(ITEM_REVISION_SOURCES),
  sourceRef: z.string().nullable(),
  /** The one Route Card for this Item + Rev, if created. */
  routeCardId: z.string().uuid().nullable().default(null),
  routeCardCode: z.string().nullable().default(null),
  createdAt: z.string(),
  createdBy: z.string().uuid().nullable(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid().nullable(),
});
export type ItemRevision = z.infer<typeof itemRevisionSchema>;

export const itemRevisionDrawingEventSchema = z.object({
  id: z.string().uuid(),
  itemRevisionId: z.string().uuid(),
  action: z.enum(ITEM_REVISION_DRAWING_ACTIONS),
  drawingFilePath: z.string().nullable(),
  drawingNo: z.string().nullable(),
  /** Compulsory for `replaced`. */
  reason: z.string().nullable(),
  sourceType: z.enum(ITEM_REVISION_SOURCES).nullable(),
  sourceRef: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid().nullable(),
  createdByName: z.string().nullable().default(null),
});
export type ItemRevisionDrawingEvent = z.infer<typeof itemRevisionDrawingEventSchema>;

/** One document linked to an Item + Rev, for the detail/preview page. */
export const itemRevisionLinkedDocSchema = z.object({
  docType: z.enum(['so_line', 'jw_line', 'route_card', 'plan', 'production_order', 'job_card']),
  docId: z.string().uuid(),
  code: z.string(),
  lineNo: z.number().int().nullable().default(null),
  status: z.string().nullable().default(null),
});
export type ItemRevisionLinkedDoc = z.infer<typeof itemRevisionLinkedDocSchema>;

export const itemRevisionDetailSchema = itemRevisionSchema.extend({
  history: z.array(itemRevisionDrawingEventSchema).default([]),
  linkedDocs: z.array(itemRevisionLinkedDocSchema).default([]),
});
export type ItemRevisionDetail = z.infer<typeof itemRevisionDetailSchema>;

// ─── Queries ───────────────────────────────────────────────────────────────

/** GET /item-revisions?itemId=… — every Rev of one item (ABC/1, ABC/2, ABC/A). */
export const listItemRevisionsQuerySchema = z.object({
  itemId: z.string().uuid().optional(),
  search: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListItemRevisionsQuery = z.infer<typeof listItemRevisionsQuerySchema>;

export interface ListItemRevisionsResponse {
  items: ItemRevision[];
  total: number;
  limit: number;
  offset: number;
}

/** GET /item-revisions/lookup?itemId=…&rev=… — the auto-fill call made by the
 *  SO line, JWSO line, Route Card and BOM line forms when Item + Rev are both
 *  filled. Answers `{ revision: null }` when ABC/<rev> does not exist yet. */
export const lookupItemRevisionQuerySchema = z.object({
  itemId: z.string().uuid(),
  rev: drawingRevInputSchema,
});
export type LookupItemRevisionQuery = z.infer<typeof lookupItemRevisionQuerySchema>;

export interface LookupItemRevisionResponse {
  revision: ItemRevision | null;
  /** Whether the item needs a Rev at all (procurement_type = 'make'). */
  revRequired: boolean;
}

// ─── Writes ────────────────────────────────────────────────────────────────

/** POST /item-revisions/:id/replace-drawing — the ONLY way to change the file of
 *  an existing Item + Rev that already has one. Old file kept in history;
 *  closed Job Cards keep showing the file they were made with. Needs Route Card
 *  Master Edit. */
export const replaceItemRevisionDrawingInputSchema = z.object({
  drawingFilePath: z.string().min(1).max(512),
  drawingNo: z.string().trim().max(64).nullable().optional(),
  reason: z.string().trim().min(5, 'Reason is required (at least 5 characters)').max(500),
  /** §20.4 — the record's updatedAt as loaded. */
  expectedUpdatedAt: expectedUpdatedAtSchema,
});
export type ReplaceItemRevisionDrawingInput = z.infer<typeof replaceItemRevisionDrawingInputSchema>;

// ─── Rev change history (D1) ───────────────────────────────────────────────

/** One Rev change on an SO / JWSO line: from ABC/1 to ABC/2, which open
 *  documents moved, which closed Job Cards stayed. */
export const itemRevisionChangeSchema = z.object({
  id: z.string().uuid(),
  soLineId: z.string().uuid().nullable(),
  jwLineId: z.string().uuid().nullable(),
  docCode: z.string().nullable(),
  lineNo: z.number().int().nullable(),
  fromItemRevisionId: z.string().uuid().nullable(),
  fromLabel: z.string().nullable(),
  toItemRevisionId: z.string().uuid(),
  toLabel: z.string(),
  /** Codes of documents moved to the new Rev ("PLN-0012", "IN-PRO-00031", "IN-JC-00088"). */
  movedDocs: z.array(z.string()).default([]),
  /** Codes of closed Job Cards that kept the old Rev. */
  keptDocs: z.array(z.string()).default([]),
  createdAt: z.string(),
  createdBy: z.string().uuid().nullable(),
  createdByName: z.string().nullable().default(null),
});
export type ItemRevisionChange = z.infer<typeof itemRevisionChangeSchema>;

export const listItemRevisionChangesQuerySchema = z
  .object({
    soLineId: z.string().uuid().optional(),
    jwLineId: z.string().uuid().optional(),
    salesOrderId: z.string().uuid().optional(),
    jobWorkOrderId: z.string().uuid().optional(),
  })
  .refine((v) => Boolean(v.soLineId || v.jwLineId || v.salesOrderId || v.jobWorkOrderId), 'Give a line or order id');
export type ListItemRevisionChangesQuery = z.infer<typeof listItemRevisionChangesQuerySchema>;

// ─── Phase D: hand-fix lists ───────────────────────────────────────────────

/** Old Route Card with no Drawing Rev (make item) — must be set by hand before
 *  a new Production Order may use it. */
export const fixListRouteCardSchema = z.object({
  routeCardId: z.string().uuid(),
  routeCardCode: z.string(),
  itemId: z.string().uuid(),
  itemCode: z.string(),
  itemName: z.string().nullable(),
  approvalStatus: z.string(),
  /** Distinct Revs on live SO/JWSO lines of this item, e.g. ["1","0"]. */
  lineRevs: z.array(z.string()).default([]),
});
export type FixListRouteCard = z.infer<typeof fixListRouteCardSchema>;

/** A live SO/JWSO line of an item whose live lines carry more than one Rev,
 *  or a suspicious Rev "0". Cancelled documents excluded. */
export const fixListLineSchema = z.object({
  itemId: z.string().uuid(),
  itemCode: z.string(),
  itemName: z.string().nullable(),
  source: z.enum(['SO', 'JWSO']),
  docId: z.string().uuid(),
  docCode: z.string(),
  lineId: z.string().uuid(),
  lineNo: z.number().int(),
  status: z.string(),
  drawingRev: z.string(),
  hasDrawing: z.boolean(),
  routeCardCode: z.string().nullable(),
  createdAt: z.string(),
  reason: z.enum(['conflict', 'rev_zero']),
});
export type FixListLine = z.infer<typeof fixListLineSchema>;

/** Old stock of a MAKE item with no Drawing Rev (blank bucket). */
export const fixListStockSchema = z.object({
  itemId: z.string().uuid(),
  itemCode: z.string(),
  itemName: z.string().nullable(),
  onHandQty: z.number(),
  /** Revs already known for this item, to choose from. */
  knownRevs: z.array(z.object({ itemRevisionId: z.string().uuid(), drawingRev: z.string() })).default([]),
});
export type FixListStock = z.infer<typeof fixListStockSchema>;

export interface ItemRevisionFixListResponse {
  routeCards: FixListRouteCard[];
  lines: FixListLine[];
  stock: FixListStock[];
}

/** POST /item-revisions/stock-set-rev — moves blank-Rev stock of a make item to
 *  an Item + Rev (an out + in pair in the stock ledger, source 'rev_change'). */
export const setStockRevInputSchema = z.object({
  itemId: z.string().uuid(),
  itemRevisionId: z.string().uuid(),
  qty: z.number().positive(),
  remarks: z.string().trim().max(500).optional(),
});
export type SetStockRevInput = z.infer<typeof setStockRevInputSchema>;

// ─── Phase C: stock per Item + Rev ─────────────────────────────────────────

/** GET /store-inventory/:itemId/revs — one row per Rev bucket of one item
 *  (blank bucket = old / no-Rev stock), with what is booked per SO line. */
export const itemRevStockRowSchema = z.object({
  itemRevisionId: z.string().uuid().nullable(),
  label: z.string(),
  drawingRev: z.string().nullable(),
  onHandQty: z.number(),
  reservedQty: z.number(),
  freeQty: z.number(),
  bookings: z
    .array(
      z.object({
        soLineId: z.string().uuid(),
        docCode: z.string(),
        lineNo: z.number().int().nullable(),
        qty: z.number(),
      }),
    )
    .default([]),
});
export type ItemRevStockRow = z.infer<typeof itemRevStockRowSchema>;
