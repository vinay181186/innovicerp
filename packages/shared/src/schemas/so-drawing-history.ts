// Per-SO-line drawing revision history.
//
// This is a record of DRAWINGS, not of saves: a row is written only when a
// line's drawing file actually changes — a new file uploaded over an old one, or
// the drawing cleared away. Re-saving the SO without touching the drawing writes
// nothing.
//
// `revisionNo` counts those changes — "the 3rd drawing this line has had". Since
// migration 0119 it is NOT the line's Rev. The line's Rev is the customer's
// drawing revision, free text a human types ('A', 'B', 'R1'), independent of
// whether anything was uploaded; it is snapshotted onto each row as
// `lineRevisionText` so a history entry can still say which revision it belonged
// to. Before 0119 the two were the same number, and the backfill reflects that
// exactly.
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
  /** How many times this line's drawing has changed, this being the Nth. Not
   *  the line's Rev — see the file header. */
  revisionNo: z.number().int().nonnegative(),
  /** The line's typed Rev when this drawing change was recorded. Null only on a
   *  row the 0119 backfill could not reach. */
  lineRevisionText: z.string().nullable(),
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
  /** The line's current Rev, as typed on the SO line today. Text since 0119,
   *  and no longer tied to revisions[0].revisionNo — the drawing may have
   *  changed three times under one revision, or the revision may have moved on
   *  without the drawing changing at all. */
  currentRevision: z.string(),
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
