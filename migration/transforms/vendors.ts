// vendors transform — legacy `vendors` collection to Postgres `vendors`.
//
// Field mapping:
//   id        → _legacyId, uuidv5 → id
//   code      → code
//   name      → name
//   contact   → contactPerson
//   phone     → phone
//   email     → email (lowercased)
//   gst       → gstNumber
//   address   → addressLine1
//   materials → materialsSupplied
//   rating    → rating (kept verbatim — `A`/`B`/`C` etc.)
//   status === 'Active' → isActive=true; anything else → isActive=false
// New columns left null: city, state, pincode.

import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformResult } from './types';

interface LegacyVendor {
  id: string;
  code?: string;
  name?: string;
  contact?: string;
  phone?: string;
  email?: string;
  gst?: string;
  address?: string;
  materials?: string;
  rating?: string;
  status?: string;
}

export interface TransformedVendor {
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
  materialsSupplied: string | null;
  rating: string | null;
  isActive: boolean;
  _legacyExtras: Record<string, unknown>;
}

export function legacyVendorIdToUuid(legacyId: string): string {
  return uuidv5(`vendors/${legacyId}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function transformVendors(records: LegacyVendor[]): TransformResult<TransformedVendor> {
  const rows: TransformedVendor[] = [];
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

    const isActive = r.status === undefined || r.status === 'Active';
    if (r.status !== undefined && r.status !== 'Active') {
      anomalies.push({
        legacyId: r.id,
        type: 'status_inactive',
        details: { from: r.status },
      });
    }

    const known = new Set([
      'id',
      'code',
      'name',
      'contact',
      'phone',
      'email',
      'gst',
      'address',
      'materials',
      'rating',
      'status',
    ]);
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (!known.has(k)) extras[k] = v;
    }

    rows.push({
      _legacyId: r.id,
      id: legacyVendorIdToUuid(r.id),
      code: r.code.trim(),
      name: r.name.trim(),
      contactPerson: emptyToNull(r.contact),
      email: r.email ? r.email.trim().toLowerCase() || null : null,
      phone: emptyToNull(r.phone),
      gstNumber: emptyToNull(r.gst),
      addressLine1: emptyToNull(r.address),
      city: null,
      state: null,
      pincode: null,
      materialsSupplied: emptyToNull(r.materials),
      rating: emptyToNull(r.rating),
      isActive,
      _legacyExtras: extras,
    });
  }

  return {
    table: 'vendors',
    sourceCollection: 'vendors',
    transformedAt: new Date().toISOString(),
    rows,
    anomalies,
  };
}
