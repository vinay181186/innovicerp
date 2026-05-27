// Bridges the `companies` row → the print builder's DocCompany header + a flat
// address string for {companyAddress} substitution. Shared by every
// template-consuming print (PO / OSP DC / JW DC). Keeps doc-print.ts free of
// domain types.

import type { Company } from '@innovic/shared';
import type { DocCompany } from './doc-print';

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
  return c;
}
