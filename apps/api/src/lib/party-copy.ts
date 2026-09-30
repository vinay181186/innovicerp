// Legal copy of the customer + Place of Supply (plan v3 Steps 3 + 4, owner
// decisions D2 / D6 / D7, migration 0186).
//
// Used by the Tax Invoice, JW Invoice, customer Dispatch and JW Return
// Challan services: read the customer master ONCE when the paper is made,
// save the copy on the paper, and decide the Place of Supply / tax type with
// the shared rule (packages/shared lib/place-of-supply.ts). Nothing here
// guesses a state: an unknown Place of Supply is a warning (warn mode) or a
// refusal (enforce mode), never "Gujarat".

import { and, eq } from 'drizzle-orm';
import {
  type ClientCopy,
  PLACE_OF_SUPPLY_REFUSAL,
  type ServicePoTaxType,
  companyStateCodeFor,
  placeOfSupplyFor,
  taxTypeForSupply,
} from '@innovic/shared';
import { clients, companies } from '../db/schema';
import type { DbTransaction } from '../db/with-user-context';
import { ValidationError } from './errors';
import { loadMasterRuleSettings } from './master-rules';

/** The customer master fields a legal paper copies. */
export interface ClientMasterForCopy {
  id: string;
  code: string;
  name: string;
  gstNumber: string | null;
  gstCategory: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
  paymentDays: number | null;
}

export async function loadClientForCopy(
  tx: DbTransaction,
  clientId: string | null | undefined,
  companyId: string,
): Promise<ClientMasterForCopy | null> {
  if (!clientId) return null;
  const rows = await tx
    .select({
      id: clients.id,
      code: clients.code,
      name: clients.name,
      gstNumber: clients.gstNumber,
      gstCategory: clients.gstCategory,
      addressLine1: clients.addressLine1,
      city: clients.city,
      state: clients.state,
      stateCode: clients.stateCode,
      pincode: clients.pincode,
      paymentDays: clients.paymentDays,
    })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
    .limit(1);
  return rows[0] ?? null;
}

const blank = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t ? t : null;
};

/** The copy every legal paper stores (0186). `clientName` / `clientGstText`
 *  are returned too; each service writes them into its own name columns. */
export function clientCopyValues(c: ClientMasterForCopy | null): {
  clientName: string | null;
  clientGstText: string | null;
  clientAddressLine1: string | null;
  clientCity: string | null;
  clientState: string | null;
  clientStateCode: string | null;
  clientPincode: string | null;
  placeOfSupply: string | null;
  clientCopyAt: Date;
} {
  return {
    clientName: c?.name ?? null,
    clientGstText: blank(c?.gstNumber),
    clientAddressLine1: blank(c?.addressLine1),
    clientCity: blank(c?.city),
    clientState: blank(c?.state),
    clientStateCode: c?.stateCode ?? null,
    clientPincode: blank(c?.pincode),
    placeOfSupply: c ? placeOfSupplyFor(c) : null,
    clientCopyAt: new Date(),
  };
}

/** A paper row's copy as the API returns it; null when no copy was taken
 *  (row made before 0186 → the print falls back to the live master). */
export function readClientCopy(r: {
  clientCopyAt: Date | null;
  clientName: string | null;
  clientGstText: string | null;
  clientAddressLine1: string | null;
  clientCity: string | null;
  clientState: string | null;
  clientStateCode: string | null;
  clientPincode: string | null;
  placeOfSupply: string | null;
}): ClientCopy | null {
  if (!r.clientCopyAt) return null;
  return {
    name: r.clientName,
    gstNumber: r.clientGstText,
    addressLine1: r.clientAddressLine1,
    city: r.clientCity,
    state: r.clientState,
    stateCode: r.clientStateCode,
    pincode: r.clientPincode,
    placeOfSupply: r.placeOfSupply,
  };
}

/** The company's own GST State Code — from its GSTIN, else its State. */
export async function loadCompanyStateCode(
  tx: DbTransaction,
  companyId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ gstNumber: companies.gstNumber, state: companies.state })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  const r = rows[0];
  return r ? companyStateCodeFor(r) : null;
}

export interface SupplyDecision {
  /** Place of Supply saved on the paper (null = unknown). */
  placeOfSupply: string | null;
  /** The tax type the rule gives. */
  taxType: ServicePoTaxType;
  /** True when the rule could not decide (a state unknown) and the tax type
   *  is the warn-mode same-state default. */
  unknown: boolean;
}

/**
 * Place of Supply → tax type for an outward invoice (D2).
 *   known   → IGST when it differs from the company's State (SEZ / Overseas
 *             always IGST), else SGST + CGST;
 *   unknown (customer State + GSTIN blank, or the company's own State blank):
 *     warn    → SGST + CGST (the company's State), `unknown: true`;
 *     enforce → 400 "Fill the customer's State / GSTIN first."
 * `forSave: false` = a read-only preview (the create form): never refuses.
 */
export async function decideSupply(
  tx: DbTransaction,
  companyId: string,
  client: ClientMasterForCopy | null,
  opts: { forSave: boolean },
): Promise<SupplyDecision> {
  const placeOfSupply = client ? placeOfSupplyFor(client) : null;
  const companyStateCode = await loadCompanyStateCode(tx, companyId);
  const rule = taxTypeForSupply({
    placeOfSupply,
    companyStateCode,
    gstCategory: client?.gstCategory,
  });
  if (rule) return { placeOfSupply, taxType: rule, unknown: false };
  if (opts.forSave) {
    const { masterRulesMode } = await loadMasterRuleSettings(tx, companyId);
    if (masterRulesMode === 'enforce') {
      throw new ValidationError(
        companyStateCode
          ? PLACE_OF_SUPPLY_REFUSAL
          : "Fill the company's GSTIN / State (Settings → Company) first.",
      );
    }
  }
  return { placeOfSupply, taxType: 'sgst_cgst', unknown: true };
}

/** A tax type the user picked that contradicts a KNOWN Place of Supply is
 *  refused — the legal paper must match its Place of Supply. While the Place
 *  of Supply is unknown (warn mode) the user's choice stands. */
export function assertTaxTypeMatches(
  chosen: ServicePoTaxType | undefined,
  decision: SupplyDecision,
): ServicePoTaxType {
  if (!chosen || decision.unknown) return chosen ?? decision.taxType;
  if (chosen !== decision.taxType) {
    throw new ValidationError(
      decision.taxType === 'igst'
        ? 'Tax Type must be IGST — the Place of Supply is a different State from ours (or the customer is SEZ / Overseas).'
        : 'Tax Type must be SGST + CGST — the Place of Supply is our own State.',
    );
  }
  return chosen;
}

/** invoiceDate (YYYY-MM-DD) + days → YYYY-MM-DD. */
export function dueDateFrom(invoiceDate: string, days: number): string {
  const d = new Date(`${invoiceDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
