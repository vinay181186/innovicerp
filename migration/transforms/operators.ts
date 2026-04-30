// operators transform — legacy `operators` collection to Postgres `operators`.
//
// Field mapping:
//   id          → _legacyId, uuidv5 → id
//   opId        → code
//   name        → name
//   department  → department (null if empty)
//   skills      → skills (null if empty)
//   status === 'Active' → isActive=true; anything else → false
//
// userId is left null at transform time. T-015 (load) may attempt to match
// operators to existing public.users rows by name or email; for now we
// leave the link unset (most shop-floor operators don't have logins).

import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformResult } from './types';

interface LegacyOperator {
  id: string;
  opId?: string;
  name?: string;
  department?: string;
  skills?: string;
  status?: string;
}

export interface TransformedOperator {
  _legacyId: string;
  id: string;
  code: string;
  name: string;
  department: string | null;
  skills: string | null;
  isActive: boolean;
  userId: string | null;
  _legacyExtras: Record<string, unknown>;
}

export function legacyOperatorIdToUuid(legacyId: string): string {
  return uuidv5(`operators/${legacyId}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function transformOperators(
  records: LegacyOperator[],
): TransformResult<TransformedOperator> {
  const rows: TransformedOperator[] = [];
  const anomalies: Anomaly[] = [];

  for (const r of records) {
    if (!r.opId) {
      anomalies.push({ legacyId: r.id, type: 'opId_missing' });
      continue;
    }
    if (!r.name) {
      anomalies.push({ legacyId: r.id, type: 'name_missing' });
      continue;
    }

    const isActive = r.status === undefined || r.status === 'Active';
    if (r.status !== undefined && r.status !== 'Active') {
      anomalies.push({
        legacyId: r.id,
        type: 'status_inactive',
        details: { from: r.status },
      });
    }

    const known = new Set(['id', 'opId', 'name', 'department', 'skills', 'status']);
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (!known.has(k)) extras[k] = v;
    }

    rows.push({
      _legacyId: r.id,
      id: legacyOperatorIdToUuid(r.id),
      code: r.opId.trim(),
      name: r.name.trim(),
      department: emptyToNull(r.department),
      skills: emptyToNull(r.skills),
      isActive,
      userId: null,
      _legacyExtras: extras,
    });
  }

  return {
    table: 'operators',
    sourceCollection: 'operators',
    transformedAt: new Date().toISOString(),
    rows,
    anomalies,
  };
}
