// Inactive-master rule (audit A10 / A14, plan D4).
//
// A Customer or Vendor switched to Inactive in its master must not be linked to
// a NEW document. Documents that already carry the party keep working — they
// can be edited, printed, received against and closed — so the check runs:
//   - on CREATE, always;
//   - on EDIT, only when the party is being CHANGED to a different one
//     (pass the document's current party id as `keepId`; re-saving the same
//     inactive party is allowed).
//
// Wording follows ERPNext ("Customer X is disabled") and the refusal is a 409
// Conflict: the request is well-formed, the master's state forbids it.
//
// Items have no active flag (items table has no is_active column), so there is
// no item half of this rule yet.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { clients, vendors } from '../db/schema';
import type { DbTransaction } from '../db/with-user-context';
import { ConflictError, ValidationError } from './errors';

export type PartyKind = 'customer' | 'vendor';

export interface PartyRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

const LABEL: Record<PartyKind, string> = { customer: 'Customer', vendor: 'Vendor' };

async function loadParties(
  tx: DbTransaction,
  kind: PartyKind,
  ids: readonly string[],
  companyId: string,
): Promise<PartyRow[]> {
  if (ids.length === 0) return [];
  const t = kind === 'customer' ? clients : vendors;
  return tx
    .select({ id: t.id, code: t.code, name: t.name, isActive: t.isActive })
    .from(t)
    .where(and(inArray(t.id, [...ids]), eq(t.companyId, companyId), isNull(t.deletedAt)));
}

/** The 409 message for a disabled party — "Customer ACME is disabled". */
export function disabledPartyMessage(kind: PartyKind, p: Pick<PartyRow, 'code' | 'name'>): string {
  return `${LABEL[kind]} ${p.name || p.code} is disabled`;
}

/**
 * Load the party and refuse it when it is not in the master (400) or is
 * inactive (409). `keepId` = the party the document already carries: when the
 * caller passes the SAME id back (an edit that does not change the party) an
 * inactive party is allowed through.
 */
export async function assertActiveParty(
  tx: DbTransaction,
  kind: PartyKind,
  id: string,
  companyId: string,
  keepId?: string | null,
): Promise<PartyRow> {
  const [row] = await loadParties(tx, kind, [id], companyId);
  if (!row) {
    throw new ValidationError(
      `Selected ${LABEL[kind]} was not found. Please select the ${LABEL[kind]} again.`,
    );
  }
  if (!row.isActive && id !== keepId) {
    throw new ConflictError(disabledPartyMessage(kind, row));
  }
  return row;
}

/**
 * Batch form for documents that link several vendors at once (Route Card ops).
 * Returns the rows keyed by id; a missing id is left out (the caller decides
 * how to word that). An inactive id not in `keepIds` is refused with 409.
 */
export async function assertActivePartiesBatch(
  tx: DbTransaction,
  kind: PartyKind,
  ids: readonly string[],
  companyId: string,
  keepIds: ReadonlySet<string> = new Set(),
): Promise<Map<string, PartyRow>> {
  const rows = await loadParties(tx, kind, [...new Set(ids)], companyId);
  for (const r of rows) {
    if (!r.isActive && !keepIds.has(r.id)) {
      throw new ConflictError(disabledPartyMessage(kind, r));
    }
  }
  return new Map(rows.map((r) => [r.id, r]));
}
