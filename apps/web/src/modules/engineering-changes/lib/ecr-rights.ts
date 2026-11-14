// ADR-291 — who may give which ECR sign-off, as the screen shows it. The
// server decides on every call (POST /ecrs/:id/decide); this only hides the
// buttons a user cannot use:
//   · the role's department tier is L4 or higher (or Full Access),
//   · the person who raised OR submitted it never decides it,
//   · one person signs only ONE role,
//   · the role has no decision yet and the ECR is Waiting Approval.

import {
  ACCESS_TIER_KEYS,
  ECR_APPROVER_ROLE_LABELS,
  type AccessDeptKey,
  type Ecr,
  type EcrApproverRole,
  type EcrStatus,
  type EffectiveAccess,
  deptTier,
} from '@innovic/shared';
import type { BadgeTone } from '@/ui/core';

/** Each sign-off is given in its own department. */
export const ECR_ROLE_DEPT: Record<EcrApproverRole, AccessDeptKey> = {
  design: 'design',
  qc: 'qc',
  production: 'production',
};

const L4 = ACCESS_TIER_KEYS.indexOf('L4');

export function holdsL4(eff: EffectiveAccess | null | undefined, role: EcrApproverRole): boolean {
  if (!eff) return false;
  if (eff.fullAccess) return true;
  const t = deptTier(eff, ECR_ROLE_DEPT[role]);
  return t != null && ACCESS_TIER_KEYS.indexOf(t) >= L4;
}

export const RAISER_BLOCK = 'You raised or submitted this ECR — another person must decide it.';

/** Reasons that are about THIS user (shown beside the row), not the row. */
export function isPersonalBlock(reason: string | null): boolean {
  return reason === RAISER_BLOCK || (reason?.startsWith('You already signed') ?? false);
}

/** Why this user may NOT decide `role` on `ecr`, or null when they may. */
export function decideBlock(
  ecr: Pick<Ecr, 'status' | 'createdBy' | 'submittedBy' | 'approvals'>,
  role: EcrApproverRole,
  eff: EffectiveAccess | null | undefined,
  meId: string | null | undefined,
): string | null {
  if (ecr.status !== 'submitted') return 'Not waiting for approval';
  if (ecr.approvals.some((a) => a.role === role)) return 'Already decided';
  if (meId && (ecr.createdBy === meId || ecr.submittedBy === meId)) return RAISER_BLOCK;
  const mine = meId ? ecr.approvals.find((a) => a.decidedBy === meId) : undefined;
  if (mine) return `You already signed this ECR as ${ECR_APPROVER_ROLE_LABELS[mine.role]}`;
  if (!holdsL4(eff, role)) return 'Needs L4 or higher in this department';
  return null;
}

/** ECR Status chip colours (theme tones): Cancelled / Rejected red. */
export const ECR_STATUS_TONE: Record<EcrStatus, BadgeTone> = {
  draft: 'grey',
  submitted: 'orange',
  approved: 'blue',
  rejected: 'red',
  implemented: 'cyan',
  closed: 'green',
  cancelled: 'red',
};
