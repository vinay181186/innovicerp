// Drawing Register — release control for Item + Drawing Rev (ADR-290,
// SOP INN-ERP-SOP-ENG-001 §4).
//
// Every Item + Rev record (item_revisions) carries a release status:
//
//   unverified  — existed before release control; work may continue with a
//                 warning until Design verifies and releases it (never guessed)
//   draft       — typed on an SO / JWSO / Route Card / BOM line, not checked yet
//                 (on screen: "Not released"; NOT the Route Card "Draft")
//   under_review → approved → released — Design's check
//   superseded  — a newer Rev of the same item was released; existing orders
//                 may still use it, with a warning
//   obsolete    — never to be used for new work
//   rejected    — sent back by the reviewer, with a reason
//
// Plan / Execute / PRO / Job Card creation is allowed only for a Rev whose
// status is in REV_WORK_ALLOWED (released, superseded, unverified); the last two
// show a warning. Rework children of an existing Job Card keep their Rev.

import { z } from 'zod';
import { expectedUpdatedAtSchema } from '../lib/edit-conflict';
import { REVISION_PATTERN } from '../lib/revision';

export const REV_RELEASE_STATUSES = [
  'unverified',
  'draft',
  'under_review',
  'approved',
  'released',
  'superseded',
  'obsolete',
  'rejected',
] as const;
export type RevReleaseStatus = (typeof REV_RELEASE_STATUSES)[number];

/** The words the screens show. "draft" reads "Not released" so it never looks
 *  like the Route Card's own Draft status. */
export const REV_RELEASE_STATUS_LABELS: Record<RevReleaseStatus, string> = {
  unverified: 'Unverified',
  draft: 'Not released',
  under_review: 'Under Review',
  approved: 'Approved',
  released: 'Released',
  superseded: 'Superseded',
  obsolete: 'Obsolete',
  rejected: 'Rejected',
};

/** Statuses a NEW Plan / PRO / Job Card may be made on. */
export const REV_WORK_ALLOWED: readonly RevReleaseStatus[] = [
  'released',
  'superseded',
  'unverified',
];
/** Of those, the ones that carry a warning. */
export const REV_WORK_WARN: readonly RevReleaseStatus[] = ['superseded', 'unverified'];

export function isRevWorkAllowed(status: RevReleaseStatus | null | undefined): boolean {
  // No Rev record at all (Buy item, or a make item with no Rev yet) is the
  // separate "No Drawing Rev" case — not decided here.
  if (!status) return true;
  return REV_WORK_ALLOWED.includes(status);
}

/** ADR-311 — a Rev in one of these statuses goes STRAIGHT to under_review the
 *  moment it holds a drawing file (born with one, first file adopted, file
 *  replaced, or replaced after a Reject). There is no "Send for Review" step.
 *  under_review / approved move back to under_review on a replace (checked
 *  again). unverified / released / superseded / obsolete are never moved here. */
export const REV_AUTO_REVIEW_FROM: readonly RevReleaseStatus[] = [
  'draft',
  'rejected',
  'under_review',
  'approved',
];

/** ADR-311 — the refusal when a new SO / JWSO line (make item) has no drawing
 *  file, or its Item / Rev changed and the new Rev has none. One sentence for
 *  the server and the forms. */
export function drawingFileRequiredMessage(lineNo: number, label: string): string {
  return `Ln ${lineNo}: upload the drawing file for ${label} — it is compulsory on every Sales Order / JWSO line.`;
}

/** The sentence every refusal uses, so all create paths say the same thing. */
export function revNotReleasedMessage(label: string, status: RevReleaseStatus): string {
  return `${label} is ${REV_RELEASE_STATUS_LABELS[status]} — Design must release it in the Drawing Register before Plan, PRO or Job Card.`;
}

// ─── Status actions (POST /item-revisions/:id/<action>) ────────────────────
//
// §20.2 — every action is a conditional UPDATE on the expected FROM status;
// 0 rows = 409 naming who acted. Rights:
//   submit            — Drawing Register Entry or Edit (draft | rejected | unverified → under_review; needs a file).
//                       ADR-311: no screen offers it any more — a Rev with a file is moved to
//                       under_review automatically (REV_AUTO_REVIEW_FROM). Kept for old clients.
//   approve / reject  — Drawing Register Approve tick (under_review → approved | rejected)
//   release           — per-person "Drawing Release button" switch (approved → released, or
//                       unverified → released = "Verify & Release" for records made before
//                       release control; file required). Server stores the file hash; older
//                       released Revs of the item → superseded; releasing a Rev older than an
//                       already released one makes it superseded at once.
//   obsolete          — Drawing Register Approve tick (any but obsolete → obsolete)

export const REV_STATUS_ACTIONS = ['submit', 'approve', 'reject', 'release', 'obsolete'] as const;
export type RevStatusAction = (typeof REV_STATUS_ACTIONS)[number];

export const revStatusActionInputSchema = z.object({
  /** §20.4 — the record's updatedAt as loaded. */
  expectedUpdatedAt: expectedUpdatedAtSchema,
  /** What changed in this Rev (submit) or why (reject / obsolete — required there, min 5). */
  note: z.string().trim().max(500).optional(),
});
export type RevStatusActionInput = z.infer<typeof revStatusActionInputSchema>;

// ─── Drawing correction after release (point 6) ────────────────────────────
//
// A released (or superseded) Rev's file is never swapped directly. "Replace
// drawing" on such a Rev creates a correction request; a person with the
// release switch approves it, and only then does the file change (old file kept
// in the locked history, new file hash stored). Before release the existing
// direct replace-with-reason stays.

export const DRAWING_CORRECTION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type DrawingCorrectionStatus = (typeof DRAWING_CORRECTION_STATUSES)[number];

export const drawingCorrectionSchema = z.object({
  id: z.string().uuid(),
  itemRevisionId: z.string().uuid(),
  label: z.string(),
  drawingFilePath: z.string(),
  drawingNo: z.string().nullable(),
  reason: z.string(),
  status: z.enum(DRAWING_CORRECTION_STATUSES),
  requestedBy: z.string().uuid().nullable(),
  requestedByName: z.string().nullable().default(null),
  requestedAt: z.string(),
  decidedBy: z.string().uuid().nullable().default(null),
  decidedByName: z.string().nullable().default(null),
  decidedAt: z.string().nullable().default(null),
  decisionNote: z.string().nullable().default(null),
});
export type DrawingCorrection = z.infer<typeof drawingCorrectionSchema>;

export const decideDrawingCorrectionInputSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  /** Required for reject (min 5). */
  note: z.string().trim().max(500).optional(),
});
export type DecideDrawingCorrectionInput = z.infer<typeof decideDrawingCorrectionInputSchema>;

// ─── Drawing Register list (GET /item-revisions/register) ─────────────────

export const drawingRegisterRowSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  customerPartNo: z.string().nullable().default(null),
  drawingRev: z.string(),
  label: z.string(),
  drawingNo: z.string().nullable(),
  hasFile: z.boolean(),
  releaseStatus: z.enum(REV_RELEASE_STATUSES),
  releasedAt: z.string().nullable(),
  releasedByName: z.string().nullable(),
  /** Open SO / JWSO lines and open Job Cards on this Rev. */
  openLines: z.number().int().nonnegative(),
  openJobCards: z.number().int().nonnegative(),
  pendingCorrection: z.boolean().default(false),
  /** ADR-315 — "SO No.": every live SO / JWSO naming this Rev, newest first
   *  (closed ones included — history). `kind` picks the page the number opens. */
  orders: z
    .array(z.object({ kind: z.enum(['so', 'jw']), id: z.string().uuid(), code: z.string() }))
    .default([]),
  updatedAt: z.string(),
});
export type DrawingRegisterRow = z.infer<typeof drawingRegisterRowSchema>;

export const listDrawingRegisterQuerySchema = z.object({
  search: z.string().max(100).optional(),
  status: z.enum(REV_RELEASE_STATUSES).optional(),
  /** Sort & Filter (ADR-200) — JSON, see list-query.ts. */
  sf: z.string().max(4000).optional(),
  limit: z.coerce.number().int().positive().max(200).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListDrawingRegisterQuery = z.infer<typeof listDrawingRegisterQuerySchema>;

export interface ListDrawingRegisterResponse {
  items: DrawingRegisterRow[];
  total: number;
}

// ─── What an SO / JWSO line form shows next to the Drawing Rev ────────────

/** Returned by GET /item-revisions/lookup and on SO / JWSO line reads. */
export const revReleaseInfoSchema = z.object({
  releaseStatus: z.enum(REV_RELEASE_STATUSES).nullable(),
  /** The highest released Rev of the same item, when it is NOT this one —
   *  drives "Latest released drawing is ABC/2. This line specifies ABC/1." */
  latestReleasedRev: z.string().nullable().default(null),
  latestReleasedLabel: z.string().nullable().default(null),
});
export type RevReleaseInfo = z.infer<typeof revReleaseInfoSchema>;

// ─── New Drawing Rev from the register (POST /item-revisions) ─────────────
//
// A customer's new Rev that no order names yet (e.g. ABC/2 arriving while the
// SO line still runs on ABC/1) is added here as "Not released", so Design can
// review and release it before work moves to it. Drawing Register Entry right.

export const createDrawingRevInputSchema = z.object({
  itemId: z.string().uuid(),
  /** Same rule as drawingRevInputSchema (item-revision.ts) — repeated here only
   *  to avoid a circular import between the two schema files. */
  rev: z
    .string()
    .trim()
    .min(1, 'Drawing Rev is required')
    .max(32)
    .transform((v) => v.toUpperCase())
    .refine((v) => REVISION_PATTERN.test(v), 'Drawing Rev: letters, digits, . - / only'),
  drawingNo: z.string().trim().max(64).nullable().default(null),
  drawingFilePath: z.string().max(512).nullable().default(null),
  /** What changed in this Rev. */
  changeNote: z.string().trim().max(500).nullable().default(null),
});
export type CreateDrawingRevInput = z.infer<typeof createDrawingRevInputSchema>;
