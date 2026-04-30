// clients transform — legacy `clients` collection to the Postgres `clients`
// table (apps/api/src/db/schema.ts).
//
// Field mapping:
//   id        → _legacyId (carried), uuidv5 → id
//   code      → code
//   name      → name
//   contact   → contactPerson
//   email     → email (lowercased + trimmed; null if empty)
//   address   → addressLine1 (trimmed; null if empty)
// New columns left null at transform time (legacy doesn't carry them):
//   phone, gstNumber, city, state, pincode
// isActive defaults to true — legacy doesn't have a status field.

import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformResult } from './types';

interface LegacyClient {
  id: string;
  code?: string;
  name?: string;
  address?: string;
  contact?: string;
  email?: string;
}

export interface TransformedClient {
  _legacyId: string;
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  gstNumber: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  isActive: boolean;
  _legacyExtras: Record<string, unknown>;
}

export function legacyClientIdToUuid(legacyId: string): string {
  return uuidv5(`clients/${legacyId}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function transformClients(records: LegacyClient[]): TransformResult<TransformedClient> {
  const rows: TransformedClient[] = [];
  const anomalies: Anomaly[] = [];

  for (const r of records) {
    if (!r.code) {
      anomalies.push({ legacyId: r.id, type: 'code_missing' });
      continue;
    }
    if (!r.name) {
      anomalies.push({ legacyId: r.id, type: 'name_missing' });
      continue;
    }

    const known = new Set(['id', 'code', 'name', 'address', 'contact', 'email']);
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (!known.has(k)) extras[k] = v;
    }

    rows.push({
      _legacyId: r.id,
      id: legacyClientIdToUuid(r.id),
      code: r.code.trim(),
      name: r.name.trim(),
      contactPerson: emptyToNull(r.contact),
      email: r.email ? r.email.trim().toLowerCase() || null : null,
      phone: null,
      gstNumber: null,
      addressLine1: emptyToNull(r.address),
      city: null,
      state: null,
      pincode: null,
      isActive: true,
      _legacyExtras: extras,
    });
  }

  return {
    table: 'clients',
    sourceCollection: 'clients',
    transformedAt: new Date().toISOString(),
    rows,
    anomalies,
  };
}
