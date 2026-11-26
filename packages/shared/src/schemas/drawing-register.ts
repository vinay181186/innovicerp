// Drawing Register — Item + Drawing Rev records and their check status
// (ADR-290, ADR-323 two statuses, SOP INN-ERP-SOP-ENG-001 §4).
//
// Every Item + Rev record (item_revisions) carries ONE of three statuses
// (owner 2026-11-26, ADR-323 — the Review / Approve / Release steps are gone):
//
//   unverified — no drawing PDF yet, or a PDF Design has not checked
//   verified   — Design opened the PDF and pressed Verify (needs a PDF)
//   obsolete   — retired; never used for new work
//
// A replaced PDF (different file) turns a Verified Rev back to Unverified.
// Plan / PRO / Job Card may be made on an Unverified Rev with an orange
// warning; only Obsolete is refused. Running Job Cards are never stopped by a
// drawing status.
//
// The database column is still item_revisions.release_status (API field
// `releaseStatus`). Until migration 0264 tightens it, the column also accepts
// the old ADR-290 words; read every raw value through normalizeRevStatus().

import { z } from 'zod';
import { expectedUpdatedAtSchema } from '../lib/edit-conflict';
import { REVISION_PATTERN } from '../lib/revision';

export const REV_RELEASE_STATUSES = ['unverified', 'verified', 'obsolete'] as const;
export type RevReleaseStatus = (typeof REV_RELEASE_STATUSES)[number];

/** The words the screens show (docs/NAMING.md "Drawing Rev Status"). */
export const REV_RELEASE_STATUS_LABELS: Record<RevReleaseStatus, string> = {
  unverified: 'Unverified',
  verified: 'Verified',
  obsolete: 'Obsolete',
};

/** ADR-290 words a row may still hold during the release window (0263 maps
 *  them; 0264 removes them from the CHECK). Never written by new code. */
export const LEGACY_VERIFIED_STATUSES = ['released', 'superseded', 'approved'] as const;
export const LEGACY_UNVERIFIED_STATUSES = ['draft', 'under_review', 'rejected'] as const;

/** Any stored value → one of the three statuses. Unknown → unverified. */
export function normalizeRevStatus(raw: string | null | undefined): RevReleaseStatus {
  if (raw === 'verified' || raw === 'obsolete' || raw === 'unverified') return raw;
  if ((LEGACY_VERIFIED_STATUSES as readonly string[]).includes(raw ?? '')) return 'verified';
  return 'unverified';
}

/** Statuses a NEW Plan / PRO / Job Card may be made on (ADR-323 D1 = A). */
export const REV_WORK_ALLOWED: readonly RevReleaseStatus[] = ['verified', 'unverified'];
/** Of those, the ones that carry the orange warning. */
export const REV_WORK_WARN: readonly RevReleaseStatus[] = ['unverified'];

export function isRevWorkAllowed(status: RevReleaseStatus | null | undefined): boolean {
  // No Rev record at all (Buy item, or a make item with no Rev yet) is the
  // separate "No Drawing Rev" case — not decided here.
  if (!status) return true;
  return REV_WORK_ALLOWED.includes(status);
}

/** The refusal for new work on an Obsolete Rev. */
export function revNotReleasedMessage(label: string, status: RevReleaseStatus): string {
  return `${label} is ${REV_RELEASE_STATUS_LABELS[status]} — pick another Drawing Rev for Plan, PRO or Job Card.`;
}

/** The orange warning on Plan / PRO / Job Card for an Unverified Rev. */
export function revUnverifiedWarning(label: string): string {
  return `Drawing ${label} is Unverified — Design has not checked the PDF yet.`;
}

// ─── Route Card: the drawing PDF is compulsory on a NEW card (ADR-323) ─────
// Old Route Cards are left as they are. The card itself has no file box; the
// PDF is uploaded only in the Drawing Register (Drawing Register Entry right).

export function routeCardRevMissingMessage(label: string): string {
  return `${label} is not in the Drawing Register. Add it there with its drawing PDF first.`;
}
export function routeCardDrawingMissingMessage(label: string): string {
  return `No drawing file for ${label}. Upload it in the Drawing Register first.`;
}

// ─── Status actions (POST /item-revisions/:id/<action>) ────────────────────
//
// §20.2 — every action is a conditional UPDATE on the expected FROM status and
// the expected updated_at; 0 rows = 409 naming who acted. Rights:
//   verify   — Drawing Register Approve tick. unverified → verified; needs a PDF.
//              `expectedDrawingFilePath` = the file the person looked at; a file
//              replaced meanwhile → 409 "The drawing changed — open it again".
//              Stores the file hash and Verified On / By (released_at / _by).
//   unverify — Drawing Register Approve tick. verified → unverified (note ≥ 5).
//   obsolete — Drawing Register Approve tick. any but obsolete → obsolete (note ≥ 5).

export const REV_STATUS_ACTIONS = ['verify', 'unverify', 'obsolete'] as const;
export type RevStatusAction = (typeof REV_STATUS_ACTIONS)[number];

export const revStatusActionInputSchema = z.object({
  /** §20.4 — the record's updatedAt as loaded. */
  expectedUpdatedAt: expectedUpdatedAtSchema,
  /** verify: the drawing file the person checked. */
  expectedDrawingFilePath: z.string().max(512).nullable().optional(),
  /** Why (unverify / obsolete — required there, min 5). */
  note: z.string().trim().max(500).optional(),
});
export type RevStatusActionInput = z.infer<typeof revStatusActionInputSchema>;

// ─── Drawing corrections (ADR-290, retired by ADR-323) ─────────────────────
// A replace now applies at once and resets the status, so no new correction
// is ever raised. The table and this read shape stay for old history only.

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
  /** "PDF": Available (true) / Missing (false). */
  hasFile: z.boolean(),
  releaseStatus: z.enum(REV_RELEASE_STATUSES),
  /** Verified On / Verified By (stored in released_at / released_by). */
  verifiedAt: z.string().nullable(),
  verifiedByName: z.string().nullable(),
  /** Open SO / JWSO lines and open Job Cards on this Rev. */
  openLines: z.number().int().nonnegative(),
  openJobCards: z.number().int().nonnegative(),
  /** ADR-315 — "SO No.": every live SO / JWSO naming this Rev, newest first
   *  (closed ones included — history). `kind` picks the page the number opens. */
  orders: z
    .array(z.object({ kind: z.enum(['so', 'jw']), id: z.string().uuid(), code: z.string() }))
    .default([]),
  /** ADR-317 — lead block (ADR-261): when the Rev record was made, and by whom. */
  createdAt: z.string(),
  createdByName: z.string().nullable().default(null),
  updatedAt: z.string(),
});
export type DrawingRegisterRow = z.infer<typeof drawingRegisterRowSchema>;

export const listDrawingRegisterQuerySchema = z.object({
  search: z.string().max(100).optional(),
  status: z.enum(REV_RELEASE_STATUSES).optional(),
  /** PDF Available (yes) / Missing (no). */
  pdf: z.enum(['yes', 'no']).optional(),
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

// ─── What an SO / JWSO line form knows about the Drawing Rev ──────────────

/** Returned by GET /item-revisions/lookup and on SO / JWSO line reads. */
export const revReleaseInfoSchema = z.object({
  releaseStatus: z.enum(REV_RELEASE_STATUSES).nullable(),
  /** The highest VERIFIED Rev of the same item, when it is NOT this one —
   *  drives "Latest verified drawing is ABC/2. This line specifies ABC/1." */
  latestReleasedRev: z.string().nullable().default(null),
  latestReleasedLabel: z.string().nullable().default(null),
});
export type RevReleaseInfo = z.infer<typeof revReleaseInfoSchema>;

// ─── New Drawing Rev from the register (POST /item-revisions) ─────────────
//
// An Item + Rev no order names yet (a customer's new Rev, or one a Route Card
// needs) is added here as Unverified, with its PDF when there is one.
// Drawing Register Entry right.

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
