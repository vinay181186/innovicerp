// Place of Supply + the tax type it decides (plan v3 Step 3, owner decision D2,
// ERPNext India Compliance). ONE home for the rule, used by the Tax Invoice,
// the JW Invoice (both on the server) and the PO form's tax-type suggestion.
//
//   Place of Supply = the customer's State Code; else the first two digits of
//                     its GSTIN; Overseas → 96 (Other Countries).
//   Tax type        = SEZ / Overseas → IGST (always inter-state);
//                     same state as the company → SGST + CGST; else IGST.
//
// Nothing here guesses a state. When the customer's state is unknown the
// caller decides (Master Rules Mode): warn → bill as same-state with a note on
// the screen; enforce → refuse. There is no "Gujarat" default anywhere.
//
// Source (india-compliance@develop): gst_india/utils/__init__.py
// get_place_of_supply, is_inter_state_supply (SEZ is always inter-state).

import { resolveStateCode, stateLabel, stateNameForCode } from './gst';
import type { ServicePoTaxType } from '../schemas/service-po';

/** GST State Code for a party outside India (India Compliance "96-Other Countries"). */
export const OVERSEAS_STATE_CODE = '96';

/** The State Code a GSTIN starts with, only when it is a real GST State Code. */
export function gstinStateCode(gstin: string | null | undefined): string | null {
  const m = /^(\d{2})/.exec((gstin ?? '').trim());
  if (!m) return null;
  return stateNameForCode(m[1]) ? m[1]! : null;
}

/** What the rule reads off a customer / vendor master. */
export interface SupplyParty {
  stateCode?: string | null | undefined;
  gstNumber?: string | null | undefined;
  gstCategory?: string | null | undefined;
}

/** Place of Supply (2-digit State Code) for a party, or null when unknown. */
export function placeOfSupplyFor(party: SupplyParty): string | null {
  if (party.gstCategory === 'overseas') return OVERSEAS_STATE_CODE;
  const own = (party.stateCode ?? '').trim();
  if (own && stateNameForCode(own)) return own;
  return gstinStateCode(party.gstNumber);
}

/** The company's own GST State Code: its GSTIN's first two digits, else the
 *  code its State text names. Null when neither is filled (Settings → Company). */
export function companyStateCodeFor(company: {
  gstNumber?: string | null | undefined;
  state?: string | null | undefined;
}): string | null {
  return gstinStateCode(company.gstNumber) ?? resolveStateCode(company.state);
}

/** Tax type for a supply, or null when it cannot be decided (a state unknown). */
export function taxTypeForSupply(args: {
  placeOfSupply: string | null;
  companyStateCode: string | null;
  gstCategory?: string | null | undefined;
}): ServicePoTaxType | null {
  if (args.gstCategory === 'sez' || args.gstCategory === 'overseas') return 'igst';
  if (!args.placeOfSupply || !args.companyStateCode) return null;
  return args.placeOfSupply === args.companyStateCode ? 'sgst_cgst' : 'igst';
}

/** 'Maharashtra (27)' — the screen / print rendering of a Place of Supply. */
export function placeOfSupplyLabel(code: string | null | undefined): string {
  return stateLabel(code);
}

/** The amber note the invoice screens show when the Place of Supply is unknown
 *  (warn mode). Screen only — never printed on the legal copy. */
export const PLACE_OF_SUPPLY_UNKNOWN_NOTE =
  "Place of Supply unknown — customer State missing. Billed as same-state (the company's State). Fill the customer's State / GSTIN.";

/** The enforce-mode refusal. */
export const PLACE_OF_SUPPLY_REFUSAL = "Fill the customer's State / GSTIN first.";
