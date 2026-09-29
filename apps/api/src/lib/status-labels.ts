// Screen words for status / type codes that appear inside server messages.
//
// A thrown error is read by the user as a toast, so it must never show a raw
// code like `in_planning` or `full_outsource`. These maps mirror the words the
// screens already use (apps/web plans detail / list); @innovic/shared has no
// label map for these enums yet, so they live here, for messages only.
import type { OpLogType, PlanStatus, PlanType, UserRole } from '@innovic/shared';

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  in_planning: 'In Planning',
  planned: 'Planned',
  jc_created: 'JC Created',
  pr_created: 'PR Created',
  in_production: 'In Production',
  complete: 'Completed',
  cancelled: 'Cancelled',
};

export const PLAN_TYPE_LABEL: Record<PlanType, string> = {
  manufacture: 'Manufacture',
  direct_purchase: 'Direct Purchase',
  full_outsource: 'Full Outsource',
  assembly: 'Assembly',
};

/** Same words as apps/web/src/lib/role-label.ts. */
export const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  operator: 'Operator',
  qc: 'QC',
  procurement: 'Procurement',
  dispatch: 'Dispatch',
  design: 'Design',
  viewer: 'Viewer',
};

export const OP_LOG_TYPE_LABEL: Record<OpLogType, string> = {
  start: 'Start',
  complete: 'Completed',
  qc: 'QC',
};

/** Title Case fallback for a code with no label map: `under_rework` → `Under Rework`. */
export function codeLabel(code: string | null | undefined): string {
  if (!code) return '';
  return code
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Label from a map, falling back to Title Case of the code. */
export function labelOf<K extends string>(
  map: Record<K, string>,
  code: string | null | undefined,
): string {
  if (!code) return '';
  return (map as Record<string, string>)[code] ?? codeLabel(code);
}
