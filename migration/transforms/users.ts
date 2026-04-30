// users transform — legacy ERP user records (with PIN-based custom auth) to
// the shape that T-015 (load) will use to drive Supabase Auth signup +
// public.users activation.
//
// Notes on the legacy schema:
// - `id` is an 8-char custom short-id, NOT a Firebase Auth UID. The legacy
//   ERP uses email + 4-digit PIN, not Firebase Auth. We cannot preserve PINs;
//   T-015 will create Supabase Auth users with a temporary password and
//   send them a reset link.
// - `status` may be 'Active' (observed) or absent. Absent → assume active
//   (the legacy ERP's default — there's no "pending" notion).
// - `approvalLimit` (number) is captured in `_legacyExtras` for future use
//   when we add an approvals table.

import type { UserRole } from '@innovic/shared';
import type { Anomaly, TransformResult } from './types';

interface LegacyUser {
  id: string;
  email: string;
  name?: string;
  role?: string;
  pin?: string;
  status?: string;
  approvalLimit?: number;
}

export interface TransformedUser {
  _legacyId: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  isActive: boolean;
  // Carried for T-015 (load) — not loaded into public.users; may seed an
  // initial password reset email or a separate approvals table.
  _legacyPin: string | null;
  _legacyExtras: Record<string, unknown>;
}

const VALID_ROLES: ReadonlyArray<UserRole> = [
  'admin',
  'manager',
  'operator',
  'qc',
  'procurement',
  'dispatch',
  'design',
  'viewer',
];

function normalizeRole(legacy: string | undefined): {
  role: UserRole;
  anomaly?: Anomaly['type'];
  from?: string;
} {
  if (!legacy) return { role: 'viewer', anomaly: 'role_missing' };
  const lower = legacy.toLowerCase().trim();
  if ((VALID_ROLES as readonly string[]).includes(lower)) {
    return { role: lower as UserRole };
  }
  // Unknown role → fall back to viewer so the user can log in but can't act.
  return { role: 'viewer', anomaly: 'role_unrecognised', from: legacy };
}

export function transformUsers(records: LegacyUser[]): TransformResult<TransformedUser> {
  const rows: TransformedUser[] = [];
  const anomalies: Anomaly[] = [];

  for (const r of records) {
    if (!r.email) {
      anomalies.push({ legacyId: r.id, type: 'email_missing' });
      continue; // skip — Supabase Auth requires email
    }

    const { role, anomaly: roleAnomaly, from: roleFrom } = normalizeRole(r.role);
    if (roleAnomaly) {
      anomalies.push({ legacyId: r.id, type: roleAnomaly, details: { from: roleFrom } });
    }

    const isActive = r.status === undefined || r.status === 'Active';
    if (r.status !== undefined && r.status !== 'Active') {
      anomalies.push({
        legacyId: r.id,
        type: 'status_inactive',
        details: { from: r.status, willActivate: false },
      });
    }

    const known = new Set(['id', 'email', 'name', 'role', 'pin', 'status', 'approvalLimit']);
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (!known.has(k)) extras[k] = v;
    }
    if (typeof r.approvalLimit === 'number') {
      extras['approvalLimit'] = r.approvalLimit;
    }

    rows.push({
      _legacyId: r.id,
      email: r.email.trim().toLowerCase(),
      fullName: r.name?.trim() || null,
      role,
      isActive,
      _legacyPin: r.pin ?? null,
      _legacyExtras: extras,
    });
  }

  return {
    table: 'users',
    sourceCollection: 'users',
    transformedAt: new Date().toISOString(),
    rows,
    anomalies,
  };
}
