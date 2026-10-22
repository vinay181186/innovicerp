// Who may see a canned report (/reports) — ONE rule, used by the API (list +
// run + Excel export, so no row leaves the server for a hidden report) and by
// the web catalogue (so a hidden report is never offered).
//
//   - Admin role, Super Admin (fullAccess) and Auditor see every report.
//   - Otherwise a report is visible through either door:
//       own department — access to report.dept, and for a money report a tier
//                        in that department that sees prices;
//       Reports grant  — access to the 'reports' department (the pre-existing
//                        "can open Reports" grant), and for a money report a
//                        'reports' tier that sees prices.
//   - A report with no `dept` is reachable through the Reports grant only.
//   - A money report names the page that owns its figures (`priceForm`).
//     That page's "price OFF" switch hides the report for every user below
//     Super Admin, auditors included, whichever door they come through; that
//     page's Price tick opens it on either door. An unknown `priceForm` fails
//     closed.
//   - An unknown dept string fails closed on the own-department door.

import { isAccessDeptKey, isAccessFormKey, tierSeesPrice } from '../enums/access-control';
import type { UserRole } from '../enums/user-role';
import type { ReportDefinition } from '../schemas/report';
import {
  deptTier,
  effectiveFormPerms,
  hasDeptAccess,
  type EffectiveAccess,
} from '../schemas/access-control';

export function canSeeReport(
  user: { role: UserRole | string } | null | undefined,
  eff: EffectiveAccess | null | undefined,
  report: Pick<ReportDefinition, 'dept' | 'showsMoney' | 'priceForm'>,
): boolean {
  if (user?.role === 'admin') return true;
  if (!eff) return false;
  if (eff.fullAccess) return true;

  const page =
    report.showsMoney && report.priceForm !== undefined
      ? isAccessFormKey(report.priceForm)
        ? effectiveFormPerms(eff, report.priceForm)
        : null
      : undefined;
  if (page === null || page?.priceOff) return false;
  if (eff.auditor) return true;

  const through = (dept: string | undefined): boolean => {
    if (!dept || !isAccessDeptKey(dept)) return false;
    if (!hasDeptAccess(eff, dept)) return false;
    if (!report.showsMoney) return true;
    if (page?.price) return true;
    const tier = deptTier(eff, dept);
    return tier !== null && tierSeesPrice(dept, tier);
  };

  return through(report.dept) || through('reports');
}
