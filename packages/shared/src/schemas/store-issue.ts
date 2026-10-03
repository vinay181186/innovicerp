// Store Issue shared schemas — ADR-193 phase 3b.
//
// An Item Issue is a SLIP (header) with LINES. It is issued against one of:
//   job_card    — a Job Card's raw material (capped at the card's To Issue when
//                 the card has an RM requirement; over that needs a reason from
//                 an approve-tier user)
//   assembly_so — the parts of an assembly (Equipment) SO, only its BOM parts
//   general     — consumables / general use, Department required
// Every line moves stock through the single stock writer (Available only).
// Leftovers come back with a Return (any qty up to what is unused); a whole
// slip can be Reversed only while nothing was returned from it.
// Numbering: ISS-NNNNN (live series, not renumbered).

import { z } from 'zod';
import { sfRawParamSchema } from './list-query';

/** Kept for the Tool Issue register (tool-issue.ts), which still uses it. */
export const STORE_ISSUE_REF_TYPES = [
  'Job Card',
  'SO',
  'Production',
  'Maintenance',
  'Other',
] as const;
export type StoreIssueRefType = (typeof STORE_ISSUE_REF_TYPES)[number];
export const storeIssueRefTypeSchema = z.enum(STORE_ISSUE_REF_TYPES);

export const ISSUE_AGAINST = ['job_card', 'assembly_so', 'general'] as const;
export type IssueAgainst = (typeof ISSUE_AGAINST)[number];
export const ISSUE_AGAINST_LABELS: Record<IssueAgainst, string> = {
  job_card: 'Job Card',
  assembly_so: 'Assembly SO',
  general: 'General / Consumable',
};

export const STORE_ISSUE_REVERSE_REASON_MIN = 10;
const reason = z
  .string()
  .trim()
  .min(
    STORE_ISSUE_REVERSE_REASON_MIN,
    `Give a reason (at least ${STORE_ISSUE_REVERSE_REASON_MIN} characters)`,
  )
  .max(500);
const qty = z.number().positive('Qty must be more than 0').multipleOf(0.001);

// ─── Write inputs ──────────────────────────────────────────────────────────

export const createStoreIssueInputSchema = z
  .object({
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    issueAgainst: z.enum(ISSUE_AGAINST),
    jobCardId: z.string().uuid().optional(),
    salesOrderId: z.string().uuid().optional(),
    /** Who received the material — an Operator (preferred) or free text. */
    operatorId: z.string().uuid().optional(),
    issuedToText: z.string().trim().max(255).optional(),
    department: z.string().trim().max(100).optional(),
    purpose: z.string().trim().min(3, 'Enter the Purpose (at least 3 characters)').max(255),
    remarks: z.string().trim().max(500).optional(),
    lines: z
      .array(z.object({ itemId: z.string().uuid(), qty }))
      .min(1, 'Add at least one item')
      .max(200)
      .refine((ls) => new Set(ls.map((l) => l.itemId)).size === ls.length, {
        message: 'An item is listed twice — keep one line per item',
      }),
    /** Needed only when the server answers 409 needsConfirmation (more than To Issue). */
    confirmReason: z.string().trim().min(STORE_ISSUE_REVERSE_REASON_MIN).max(500).optional(),
  })
  .refine((v) => v.issueAgainst !== 'job_card' || Boolean(v.jobCardId), {
    message: 'Pick the Job Card',
    path: ['jobCardId'],
  })
  .refine((v) => v.issueAgainst !== 'assembly_so' || Boolean(v.salesOrderId), {
    message: 'Pick the Assembly SO',
    path: ['salesOrderId'],
  })
  .refine((v) => v.issueAgainst !== 'general' || Boolean(v.department?.trim()), {
    message: 'Enter the Department that uses it',
    path: ['department'],
  })
  .refine((v) => Boolean(v.operatorId) || Boolean(v.issuedToText?.trim()), {
    message: 'Pick who received it (Operator) or type a name',
    path: ['operatorId'],
  });
export type CreateStoreIssueInput = z.infer<typeof createStoreIssueInputSchema>;

export const returnStoreIssueInputSchema = z.object({
  lines: z.array(z.object({ issueLineId: z.string().uuid(), qty })).min(1),
  reason,
});
export type ReturnStoreIssueInput = z.infer<typeof returnStoreIssueInputSchema>;

/** ADR-189 — reversing a whole slip (only while nothing was returned). */
export const reverseStoreIssueInputSchema = z.object({ reason });
export type ReverseStoreIssueInput = z.infer<typeof reverseStoreIssueInputSchema>;

// ─── Read shapes ───────────────────────────────────────────────────────────

export interface StoreIssueLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string | null;
  uom: string | null;
  qty: number;
  returnedQty: number;
  storeTransactionId: string | null;
}

export interface StoreIssueListItem {
  id: string;
  code: string;
  issueDate: string;
  issueAgainst: IssueAgainst;
  jobCardId: string | null;
  jobCardCode: string | null;
  salesOrderId: string | null;
  salesOrderCode: string | null;
  /** ADR-207 — that SO's Internal SO No., read live (null when none). */
  salesOrderInternalNo?: string | null;
  operatorId: string | null;
  issuedTo: string;
  department: string | null;
  /** Pre-0157 slips only: the typed "Reference Type + No." (e.g. "SO IN-SO-00012"). */
  legacyReference: string | null;
  purpose: string | null;
  remarks: string | null;
  lineCount: number;
  /** "ITEM-A × 12.5" or "ITEM-A × 12 +2 more" — for the register row. */
  itemsSummary: string;
  issuedByName: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  createdAt: string;
  createdBy: string;
}

export interface StoreIssueDetail extends StoreIssueListItem {
  lines: StoreIssueLine[];
}

// Kept for older imports; the register now returns list items.
export type StoreIssue = StoreIssueDetail;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listStoreIssuesQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  itemId: z.string().uuid().optional(),
  jobCardId: z.string().uuid().optional(),
  salesOrderId: z.string().uuid().optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Sort & Filter (ADR-200): JSON sort + column filters, see list-query.ts. */
  sf: sfRawParamSchema,
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListStoreIssuesQuery = z.infer<typeof listStoreIssuesQuerySchema>;

export interface ListStoreIssuesResponse {
  items: StoreIssueListItem[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Material view (derived; never stored) ─────────────────────────────────

export interface MaterialHolder {
  soCode: string;
  /** ADR-207 — that SO's Internal SO No., read live (null when none). */
  soInternalNo?: string | null;
  qty: number;
}

export interface JcMaterialLine {
  itemId: string;
  itemCode: string;
  itemName: string | null;
  uom: string | null;
  requiredQty: number | null;
  issuedQty: number;
  returnedQty: number;
  /** To Issue = Required − Issued + Returned (null when the card has no RM requirement). */
  toIssueQty: number | null;
  availableQty: number;
}

export interface JcMaterial {
  jobCardId: string;
  jcCode: string;
  orderQty: number;
  /** false = the card has no RM item on its Route Card: issues are not capped. */
  planned: boolean;
  lines: JcMaterialLine[];
  issues: Array<{
    id: string;
    code: string;
    issueDate: string;
    itemsSummary: string;
    issuedTo: string;
    reversedAt: string | null;
  }>;
}

export interface SoMaterialLine {
  itemId: string;
  itemCode: string;
  itemName: string | null;
  uom: string | null;
  qtyPerSet: number;
  requiredQty: number;
  /** Reserved for this SO (phase 3c; 0 until then). */
  reservedQty: number;
  issuedQty: number;
  returnedQty: number;
  /** Issued parts fitted into assembled units by Complete (phase 3c; 0 until then). */
  fittedQty: number;
  /** To Issue = Required − Issued + Returned. */
  toIssueQty: number;
  /** Still Out = Issued − Returned − Fitted (on the shop floor, not yet fitted). */
  stillOutQty: number;
  availableQty: number;
  reservedForOthers: MaterialHolder[];
  /** In the SO's issues but no longer in its BOM → should be returned. */
  notInBom: boolean;
}

export interface SoMaterial {
  salesOrderId: string;
  soCode: string;
  /** ADR-207 — the SO's Internal SO No., read live (null when none). */
  soInternalNo?: string | null;
  units: number;
  hasBom: boolean;
  lines: SoMaterialLine[];
  issues: Array<{
    id: string;
    code: string;
    issueDate: string;
    itemsSummary: string;
    issuedTo: string;
    reversedAt: string | null;
  }>;
}

// ─── Assembly part reservations (ADR-193 phase 3c) ─────────────────────────
// Reserve holds free stock for an assembly SO's BOM parts (never beyond To
// Issue − already Reserved). Release gives this SO's own reservation back.

export const reserveAssemblyPartsInputSchema = z.object({
  lines: z
    .array(z.object({ itemId: z.string().uuid(), qty }))
    .min(1, 'Add at least one part')
    .max(200)
    .refine((ls) => new Set(ls.map((l) => l.itemId)).size === ls.length, {
      message: 'A part is listed twice — keep one line per part',
    }),
});
export type ReserveAssemblyPartsInput = z.infer<typeof reserveAssemblyPartsInputSchema>;

export const releaseAssemblyPartsInputSchema = z.object({
  itemId: z.string().uuid(),
  qty,
  reason,
});
export type ReleaseAssemblyPartsInput = z.infer<typeof releaseAssemblyPartsInputSchema>;

/** 409 details when Complete finds a part not issued enough (not the last units). */
export interface AssemblyShortPart {
  itemCode: string;
  needQty: number;
  stillOutQty: number;
}
/** 409 details (needsConfirmation) on the last units when Still Out ≠ need. */
export interface AssemblyVariancePart {
  itemCode: string;
  needQty: number;
  stillOutQty: number;
}
