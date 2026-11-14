// Engineering Change (ECR) — ADR-291, SOP INN-ERP-SOP-ENG-001 §4–§6.
//
// A customer Rev change on work that has already started goes through an ECR
// instead of moving Job Cards silently:
//
//   draft → submitted (impact list built, affected operations put on HOLD)
//         → approved (Design + Quality + Production, each L4+, one decision each)
//         → implemented (not-started qty moved to the new Rev on a new PRO / Job
//           Card; finished qty stays on the old Rev; holds stay until each one
//           is released)
//         → closed (no hold of this ECR left)
//   Any approver may reject (submitted → rejected; holds lifted). The raiser may
//   cancel a draft or submitted ECR (holds lifted).
//
// Document code IN-ECR-##### (server states it, ADR-227). Page /ecrs, form key
// ecr_create (Design). Approvals page kind 'ecr'.

import { z } from 'zod';
import { expectedUpdatedAtSchema } from '../lib/edit-conflict';

export const ECR_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'implemented',
  'closed',
  'cancelled',
] as const;
export type EcrStatus = (typeof ECR_STATUSES)[number];
export const ECR_STATUS_LABELS: Record<EcrStatus, string> = {
  draft: 'Draft',
  submitted: 'Waiting Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  implemented: 'Implemented',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/** SOP §2 — what kind of change it is. Non-interchangeable means a new item
 *  code: the ECR records the replacement item and moves no work. */
export const ECR_CLASSIFICATIONS = [
  'documentation_only',
  'interchangeable',
  'non_interchangeable',
] as const;
export type EcrClassification = (typeof ECR_CLASSIFICATIONS)[number];
export const ECR_CLASSIFICATION_LABELS: Record<EcrClassification, string> = {
  documentation_only: 'Documentation only',
  interchangeable: 'Interchangeable',
  non_interchangeable: 'Not interchangeable (new item code)',
};

export const ECR_CUSTOMER_APPROVAL = ['not_required', 'pending', 'received'] as const;
export type EcrCustomerApproval = (typeof ECR_CUSTOMER_APPROVAL)[number];
export const ECR_CUSTOMER_APPROVAL_LABELS: Record<EcrCustomerApproval, string> = {
  not_required: 'Not required',
  pending: 'Waiting for customer',
  received: 'Received',
};

/** The three sign-offs. Each is given by a person whose department tier for
 *  that department is L4 or higher (or Full Access). */
export const ECR_APPROVER_ROLES = ['design', 'qc', 'production'] as const;
export type EcrApproverRole = (typeof ECR_APPROVER_ROLES)[number];
export const ECR_APPROVER_ROLE_LABELS: Record<EcrApproverRole, string> = {
  design: 'Design',
  qc: 'Quality',
  production: 'Production',
};

/** What happens to one affected Job Card's pieces. */
export const ECR_DISPOSITIONS = ['keep_old', 'move_new', 'decide_later'] as const;
export type EcrDisposition = (typeof ECR_DISPOSITIONS)[number];
export const ECR_DISPOSITION_LABELS: Record<EcrDisposition, string> = {
  keep_old: 'Keep on old Rev',
  move_new: 'Move not-started qty to new Rev',
  decide_later: 'Hold — decide per operation',
};

// ─── Read shapes ───────────────────────────────────────────────────────────

export const ecrImpactSchema = z.object({
  id: z.string().uuid(),
  docType: z.enum(['so_line', 'jw_line', 'job_card', 'stock']),
  docId: z.string().uuid().nullable(),
  /** "IN-SO-00012 Ln 1", "IN-JC-00045", "ABC/1 stock". */
  label: z.string(),
  /** Job Card only: pieces finished (credited) / in progress / not started. */
  qtyDone: z.number().nonnegative().default(0),
  qtyWip: z.number().nonnegative().default(0),
  qtyNotStarted: z.number().nonnegative().default(0),
  /** Stock row only: on hand of the old Rev. */
  qtyStock: z.number().nonnegative().default(0),
  disposition: z.enum(ECR_DISPOSITIONS).nullable(),
  /** Pieces to move to the new Rev (≤ qtyNotStarted). */
  moveQty: z.number().nonnegative().default(0),
  heldOps: z.number().int().nonnegative().default(0),
  note: z.string().nullable().default(null),
  /** After implement: the new Production Order / Job Card made for moveQty. */
  newDocLabel: z.string().nullable().default(null),
  /** The new Job Card's id, for the link on the Impact table. */
  newJobCardId: z.string().uuid().nullable().default(null),
});
export type EcrImpact = z.infer<typeof ecrImpactSchema>;

export const ecrApprovalSchema = z.object({
  role: z.enum(ECR_APPROVER_ROLES),
  decision: z.enum(['approved', 'rejected']),
  decidedBy: z.string().uuid(),
  decidedByName: z.string().nullable().default(null),
  decidedAt: z.string(),
  note: z.string().nullable().default(null),
});
export type EcrApproval = z.infer<typeof ecrApprovalSchema>;

export const ecrSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: z.enum(ECR_STATUSES),
  itemId: z.string().uuid(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  fromItemRevisionId: z.string().uuid(),
  fromLabel: z.string(),
  toItemRevisionId: z.string().uuid().nullable(),
  toLabel: z.string().nullable(),
  /** Status of the new Rev — implement needs it Released. */
  toReleaseStatus: z.string().nullable().default(null),
  replacementItemId: z.string().uuid().nullable(),
  replacementItemCode: z.string().nullable().default(null),
  classification: z.enum(ECR_CLASSIFICATIONS),
  description: z.string(),
  customerApproval: z.enum(ECR_CUSTOMER_APPROVAL),
  customerApprovalRef: z.string().nullable(),
  impacts: z.array(ecrImpactSchema).default([]),
  approvals: z.array(ecrApprovalSchema).default([]),
  createdAt: z.string(),
  createdBy: z.string().uuid().nullable(),
  createdByName: z.string().nullable().default(null),
  /** Who sent it for approval — like the creator, may not sign it. */
  submittedBy: z.string().uuid().nullable().default(null),
  updatedAt: z.string(),
});
export type Ecr = z.infer<typeof ecrSchema>;

export const ecrListRowSchema = ecrSchema.omit({ impacts: true, approvals: true }).extend({
  impactCount: z.number().int().nonnegative(),
  heldOps: z.number().int().nonnegative(),
  approvalsDone: z.number().int().nonnegative(),
});
export type EcrListRow = z.infer<typeof ecrListRowSchema>;

export const listEcrQuerySchema = z.object({
  search: z.string().max(100).optional(),
  status: z.enum(ECR_STATUSES).optional(),
  sf: z.string().max(4000).optional(),
  limit: z.coerce.number().int().positive().max(200).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListEcrQuery = z.infer<typeof listEcrQuerySchema>;
export interface ListEcrResponse {
  items: EcrListRow[];
  total: number;
}

// ─── Writes ────────────────────────────────────────────────────────────────

export const createEcrInputSchema = z.object({
  itemId: z.string().uuid(),
  fromItemRevisionId: z.string().uuid(),
  /** Required unless classification is non_interchangeable. */
  toItemRevisionId: z.string().uuid().nullable().default(null),
  /** Required when classification is non_interchangeable. */
  replacementItemId: z.string().uuid().nullable().default(null),
  classification: z.enum(ECR_CLASSIFICATIONS),
  description: z.string().trim().min(5, 'Describe the change (at least 5 characters)').max(2000),
  customerApproval: z.enum(ECR_CUSTOMER_APPROVAL).default('not_required'),
  customerApprovalRef: z.string().trim().max(200).nullable().default(null),
});
export type CreateEcrInput = z.infer<typeof createEcrInputSchema>;

export const updateEcrInputSchema = createEcrInputSchema.partial().extend({
  expectedUpdatedAt: expectedUpdatedAtSchema,
});
export type UpdateEcrInput = z.infer<typeof updateEcrInputSchema>;

/** Submit: builds the impact list and (by default) holds the affected operations. */
export const submitEcrInputSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  holdAffectedWork: z.boolean().default(true),
});
export type SubmitEcrInput = z.infer<typeof submitEcrInputSchema>;

export const setEcrDispositionsInputSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  impacts: z
    .array(
      z.object({
        id: z.string().uuid(),
        disposition: z.enum(ECR_DISPOSITIONS),
        moveQty: z.number().nonnegative().default(0),
        note: z.string().trim().max(500).nullable().default(null),
      }),
    )
    .min(1),
});
export type SetEcrDispositionsInput = z.infer<typeof setEcrDispositionsInputSchema>;

export const decideEcrInputSchema = z.object({
  role: z.enum(ECR_APPROVER_ROLES),
  decision: z.enum(['approved', 'rejected']),
  /** Required for a rejection (min 5). */
  note: z.string().trim().max(500).optional(),
});
export type DecideEcrInput = z.infer<typeof decideEcrInputSchema>;

export const ecrActionInputSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  note: z.string().trim().max(500).optional(),
});
export type EcrActionInput = z.infer<typeof ecrActionInputSchema>;

// ─── Hold on a Job Card operation ──────────────────────────────────────────

/** One sentence every refused writer uses. */
export function opOnHoldMessage(jcCode: string, opLabel: string, reason: string | null): string {
  return `${jcCode} · ${opLabel} is on hold${reason ? ` (${reason})` : ''} — release the hold first.`;
}

export const releaseHoldInputSchema = z.object({
  jcOpIds: z.array(z.string().uuid()).min(1),
  note: z.string().trim().min(5, 'Say why the hold is released (at least 5 characters)').max(500),
});
export type ReleaseHoldInput = z.infer<typeof releaseHoldInputSchema>;

// ─── Approved Rev substitution (used by issue / dispatch blocks) ──────────

export const revSubstitutionSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  itemCode: z.string().nullable().default(null),
  itemName: z.string().nullable().default(null),
  /** "IN-SO-00012 Ln 1", "IN-JW-00004 Ln 2" or the Job Card No. */
  scopeLabel: z.string().nullable().default(null),
  /** The Rev of the stock being used. */
  fromItemRevisionId: z.string().uuid(),
  fromLabel: z.string(),
  /** The Rev the order / Job Card asks for. */
  toItemRevisionId: z.string().uuid(),
  toLabel: z.string(),
  salesOrderLineId: z.string().uuid().nullable(),
  jobWorkOrderLineId: z.string().uuid().nullable(),
  jobCardId: z.string().uuid().nullable(),
  qtyAllowed: z.number().positive(),
  qtyUsed: z.number().nonnegative(),
  reason: z.string(),
  ecrId: z.string().uuid().nullable(),
  approvedBy: z.string().uuid(),
  approvedByName: z.string().nullable().default(null),
  approvedAt: z.string(),
});
export type RevSubstitution = z.infer<typeof revSubstitutionSchema>;

/** GET /rev-substitutions — sort / filter fields: itemCode, fromLabel, toLabel,
 *  scopeLabel, qtyAllowed, qtyUsed, reason, approvedByName, approvedAt. */
export interface ListRevSubstitutionsResponse {
  items: RevSubstitution[];
  total: number;
}

export const createRevSubstitutionInputSchema = z
  .object({
    itemId: z.string().uuid(),
    fromItemRevisionId: z.string().uuid(),
    toItemRevisionId: z.string().uuid(),
    salesOrderLineId: z.string().uuid().nullable().default(null),
    jobWorkOrderLineId: z.string().uuid().nullable().default(null),
    jobCardId: z.string().uuid().nullable().default(null),
    qtyAllowed: z.number().positive(),
    reason: z.string().trim().min(5, 'Reason is required (at least 5 characters)').max(500),
    ecrId: z.string().uuid().nullable().default(null),
  })
  .refine((v) => v.fromItemRevisionId !== v.toItemRevisionId, 'The two Revs must differ')
  .refine(
    (v) => [v.salesOrderLineId, v.jobWorkOrderLineId, v.jobCardId].filter(Boolean).length === 1,
    'Name exactly one SO line, JWSO line or Job Card',
  );
export type CreateRevSubstitutionInput = z.infer<typeof createRevSubstitutionInputSchema>;
