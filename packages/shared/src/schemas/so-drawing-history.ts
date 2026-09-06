// Per-SO-line drawing revision history.
//
// The Rev number on a sales-order line belongs to the DRAWING FILE, not to the
// line and not to the item. A line is born at Rev 0 and climbs by one every
// time its drawing file actually changes — a new file uploaded over an old one,
// or the drawing cleared away. Re-saving the SO without touching the drawing
// changes nothing, so the history is a record of drawings, not of saves.
//
// The child rows are append-only and never updated: each one is the drawing as
// it stood at that revision, with the file it pointed at. Nothing is ever
// overwritten, so an old drawing stays reachable forever (the files themselves
// were never deleted either — uploadFile stamps a timestamp on every name and
// never upserts).
//
// Shape follows the house revision-log pattern (route_card_revisions,
// bom_master_revisions): parent holds the current number, child table holds
// one row per revision.

import { z } from 'zod';

/** What happened to the drawing at this revision. */
export const soDrawingActionSchema = z.enum(['added', 'replaced', 'removed']);
export type SoDrawingAction = z.infer<typeof soDrawingActionSchema>;

/** One revision of one line's drawing. `drawingFilePath` is null only on a
 *  'removed' row — that revision records the drawing going away, so there is
 *  no file to open. */
export const soDrawingRevisionSchema = z.object({
  id: z.string().uuid(),
  revisionNo: z.number().int().nonnegative(),
  action: soDrawingActionSchema,
  drawingFilePath: z.string().nullable(),
  /** Drawing number as typed on the line when this revision was recorded. */
  drawingNo: z.string().nullable(),
  createdAt: z.string(),
  /** Display name of whoever uploaded/cleared it; null if the user is gone. */
  createdByName: z.string().nullable(),
});
export type SoDrawingRevision = z.infer<typeof soDrawingRevisionSchema>;

/** One SO line's drawing history. `itemCode` is the code AS IT IS NOW; the
 *  UI groups its second-level tabs by it, disambiguating with `lineNo` when
 *  the same item appears on more than one line of the SO. */
export const soDrawingHistoryLineSchema = z.object({
  soLineId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  itemCode: z.string().nullable(),
  partName: z.string(),
  drawingNo: z.string().nullable(),
  /** The line's current Rev — equal to revisions[0].revisionNo when any
   *  revision exists. */
  currentRevision: z.number().int().nonnegative(),
  /** Newest revision FIRST. Empty when the line never had a drawing. */
  revisions: z.array(soDrawingRevisionSchema),
});
export type SoDrawingHistoryLine = z.infer<typeof soDrawingHistoryLineSchema>;

/** GET /sales-orders/:id/drawing-history — only lines that have at least one
 *  revision are returned, so an SO whose lines carry no drawings comes back
 *  with an empty array and the UI hides the tab. */
export const soDrawingHistorySchema = z.object({
  salesOrderId: z.string().uuid(),
  soCode: z.string(),
  lines: z.array(soDrawingHistoryLineSchema),
});
export type SoDrawingHistory = z.infer<typeof soDrawingHistorySchema>;
