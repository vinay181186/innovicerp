// activity-log transform — legacy `activityLog` collection (14 records in
// Run 1 export) to Postgres `activity_log`.
//
// Per ADR-019 (T-051):
// - `action` is text not enum (legacy emits ad-hoc strings)
// - user_name preserved as snapshot regardless — survives later user
//   deletion + handles unmapped legacy entries gracefully
// - user_id is left null at migration time. Resolving it requires the
//   target Supabase users table (see users transform — legacy ids don't
//   map to Supabase Auth uids, only emails do). A future emitter that
//   logs activity from the running app will populate user_id directly.
//
// Field mapping:
//   id              → _legacyId; uuidv5(`activity_log/<id>`) → id
//   ts              → ts (ISO timestamp; pass through)
//   user            → user_name (snapshot, default 'System' if absent)
//   action          → action (text, trimmed)
//   entity          → entity (text, trimmed)
//   detail          → detail (default '')
//   refId           → ref_id (null if absent or empty)

import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformResult } from './types';

interface LegacyActivityLogEntry {
  id: string;
  ts?: string;
  user?: string;
  action?: string;
  entity?: string;
  detail?: string;
  refId?: string;
}

export interface TransformedActivityLog {
  _legacyId: string;
  id: string;
  ts: string;
  userId: string | null;
  userName: string;
  action: string;
  entity: string;
  detail: string;
  refId: string | null;
}

export function legacyActivityLogIdToUuid(legacyId: string): string {
  return uuidv5(`activity_log/${legacyId}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function transformActivityLog(
  records: LegacyActivityLogEntry[],
): TransformResult<TransformedActivityLog> {
  const rows: TransformedActivityLog[] = [];
  const anomalies: Anomaly[] = [];

  for (const r of records) {
    if (!r.ts || r.ts.trim().length === 0) {
      anomalies.push({ legacyId: r.id, type: 'ts_missing' });
      continue;
    }
    if (!r.action || r.action.trim().length === 0) {
      anomalies.push({ legacyId: r.id, type: 'action_missing' });
      continue;
    }
    if (!r.entity || r.entity.trim().length === 0) {
      anomalies.push({ legacyId: r.id, type: 'entity_missing' });
      continue;
    }

    const userName = (r.user ?? 'System').trim() || 'System';

    rows.push({
      _legacyId: r.id,
      id: legacyActivityLogIdToUuid(r.id),
      ts: r.ts,
      userId: null,
      userName,
      action: r.action.trim(),
      entity: r.entity.trim(),
      detail: r.detail?.trim() ?? '',
      refId: emptyToNull(r.refId),
    });
  }

  return {
    table: 'activity_log',
    sourceCollection: 'activityLog',
    transformedAt: new Date().toISOString(),
    rows,
    anomalies,
  };
}
