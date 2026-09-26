// A login's stored role code → the word the user reads. The codes
// (packages/shared USER_ROLES) never change; this is display text only.
import type { UserRole } from '@innovic/shared';

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

/** For a role that arrives as a plain string. Unknown codes read as Title Case. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return '';
  return (
    ROLE_LABEL[role as UserRole] ??
    role.replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase())
  );
}
