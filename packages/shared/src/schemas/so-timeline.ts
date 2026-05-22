// SO Timeline — aggregated event list across an SO's lifecycle.
//
// Mirrors legacy `_soTimeline(soNo)` (HTML L17679) which walks 10+ data
// sources for one SO and renders a chronological event list. See
// docs/PARITY/sotimeline.md for the legacy event taxonomy.
//
// Scope of this port (PL-SOTL-1): SO Created · Plan Created · JC Created /
// Completed · PR Raised · PO Created · GRN Received. Design / BOM / JW DC
// / Party-material / Op-Started events deferred until those tables ship.

import { z } from 'zod';

/** Department/colour grouping per legacy L17688–17763. */
export const soTimelineDeptSchema = z.enum([
  'sales',
  'design',
  'planning',
  'production',
  'store',
  'purchase',
  'dispatch',
  'qc',
]);
export type SoTimelineDept = z.infer<typeof soTimelineDeptSchema>;

/** A single event row in the timeline. */
export const soTimelineEventSchema = z.object({
  /** ISO timestamp (or YYYY-MM-DD) — sort key. */
  date: z.string(),
  /** Stable kind for testing + filtering. */
  kind: z.enum([
    'so_created',
    'plan_created',
    'jc_created',
    'jc_completed',
    'pr_raised',
    'po_created',
    'grn_received',
  ]),
  /** Emoji prefix matching legacy. */
  icon: z.string(),
  /** Headline label, e.g. "Plan Created" / "PO Created". */
  label: z.string(),
  /** One-line detail string (rendered as-is in the body of the event row). */
  detail: z.string(),
  /** Dept tag for colour. */
  dept: soTimelineDeptSchema,
  /** Hex or var colour for the left-border accent. */
  color: z.string(),
});
export type SoTimelineEvent = z.infer<typeof soTimelineEventSchema>;

export const soTimelineResponseSchema = z.object({
  generatedAt: z.string(),
  soId: z.string().uuid(),
  soCode: z.string(),
  customerName: z.string().nullable(),
  type: z.string(),
  events: z.array(soTimelineEventSchema),
});
export type SoTimelineResponse = z.infer<typeof soTimelineResponseSchema>;
