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
//   - An unknown dept string fails closed on the own-department door.

import { isAccessDeptKey, tierSeesPrice } from '../enums/access-control';
import type { UserRole } from '../enums/user-role';
import type { ReportDefinition } from '../schemas/report';
import { deptTier, hasDeptAccess, type EffectiveAccess } from '../schemas/access-control';

export function canSeeReport(
  user: { role: UserRole | string } | null | undefined,
  eff: EffectiveAccess | null | undefined,
  report: Pick<ReportDefinition, 'dept' | 'showsMoney'>,
): boolean {
  if (user?.role === 'admin') return true;
  if (!eff) return false;
  if (eff.fullAccess || eff.auditor) return true;

  const through = (dept: string | undefined): boolean => {
    if (!dept || !isAccessDeptKey(dept)) return false;
    if (!hasDeptAccess(eff, dept)) return false;
    if (!report.showsMoney) return true;
    const tier = deptTier(eff, dept);
    return tier !== null && tierSeesPrice(dept, tier);
  };

  return through(report.dept) || through('reports');
}
