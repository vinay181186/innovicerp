// Bridges the `companies` row → the print builder's DocCompany header + a flat
// address string for {companyAddress} substitution. Shared by every
// template-consuming print (PO / OSP DC / JW DC). Keeps doc-print.ts free of
// domain types.

import type { Company } from '@innovic/shared';
import type { DocCompany } from './doc-print';

/** The works address EXACTLY as it appears on the company business card.
 *
 *  The `companies` row says nearly the same thing but splits it differently
 *  ("...Phase-II, G.I.D.C. Estate" on line 1, "Vitthal Udhyog Nagar" on line 2)
 *  and has nowhere to put the country. The card is the address the company
 *  actually hands people, so the Purchase Order prints this.
 *
 *  This is a STOPGAP and should not spread. The right home for it is the
 *  company master, where one edit would correct the letterhead on every
 *  document at once — Settings → Company, address line 1 -> "Plot No. 12,
 *  Phase-II" and line 2 -> "G.I.D.C., Vitthal Udhyog Nagar". Once that is
 *  done this constant can be deleted and the PO can go back to reading the
 *  row like every other document. Introduced 2026-09-09 on the user's
 *  instruction, from a photograph of the card. */
//  NO trailing commas on these lines. They are DATA, not a picture of the card.
//  The card prints a comma at each line end because the address is broken over
//  four lines there; carrying that punctuation into the data broke every place
//  that joins the lines with ", " -- the {companyAddress} token and the Print
//  Templates sample both rendered "Plot No. 12, Phase-II,, G.I.D.C., ...".
//  Stacked on the letterhead they read correctly without it; joined they now
//  read correctly too.
export const COMPANY_CARD_ADDRESS_LINES: readonly string[] = [
  'Plot No. 12, Phase-II',
  'G.I.D.C., Vitthal Udhyog Nagar',
  'Anand - 388 325',
  'Gujarat, INDIA',
];

export function companyAddressLines(company: Company | null | undefined): string[] {
  if (!company) return [];
  const cityLine = [company.city, company.state, company.pincode].filter(Boolean).join(', ');
  return [company.addressLine1, company.addressLine2, cityLine].filter((l): l is string =>
    Boolean(l),
  );
}

export function buildDocCompany(company: Company | null | undefined): DocCompany {
  const c: DocCompany = {
    name: company?.name ?? 'Innovic Technology',
    addressLines: companyAddressLines(company),
  };
  if (company?.gstNumber) c.gstin = company.gstNumber;
  if (company?.phone) c.phone = company.phone;
  if (company?.email) c.email = company.email;
  return c;
}
