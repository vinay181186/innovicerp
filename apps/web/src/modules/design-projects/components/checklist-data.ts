// Design Release Checklist — the rows and the tick logic. Split out of
// detail.tsx (ADR-199) so the Checklist tab and the detail page can share them.

import type { DesignProjectDetail } from '@innovic/shared';

export const CHECKLIST: Array<{ key: string; label: string; cat: string }> = [
  { key: 'allTasksDone', label: 'All design tasks completed', cat: 'Completeness' },
  { key: 'allIssuesClosed', label: 'All design issues resolved/closed', cat: 'Completeness' },
  { key: 'bomGenerated', label: 'BOM generated and verified', cat: 'Completeness' },
  {
    key: 'drawingsNumbered',
    label: 'All drawings properly numbered and titled',
    cat: 'Documentation',
  },
  { key: 'dimensionsChecked', label: 'Critical dimensions verified', cat: 'Quality' },
  { key: 'tolerancesReviewed', label: 'Tolerances and GD&T reviewed', cat: 'Quality' },
  { key: 'interferenceCheck', label: 'Interference / clash check done', cat: 'Quality' },
  { key: 'materialSpecified', label: 'Materials and surface finish specified', cat: 'Quality' },
  { key: 'standardsCompliance', label: 'Relevant standards compliance verified', cat: 'Standards' },
  { key: 'safetyReviewed', label: 'Safety requirements addressed', cat: 'Standards' },
  { key: 'clientApproval', label: 'Customer approval obtained (if required)', cat: 'Approval' },
  { key: 'leadApproval', label: 'Design lead sign-off', cat: 'Approval' },
];

/** The rows the system can answer from data already on the page. They tick
 *  themselves; the user cannot toggle them. "All tasks done" is only a system
 *  row while the project HAS tasks — with none, it is the saved tick. */
export function isSystemCheck(detail: DesignProjectDetail, key: string): boolean {
  if (key === 'allTasksDone') return detail.tasks.length > 0;
  return key === 'allIssuesClosed';
}

export function allTasksDoneOf(detail: DesignProjectDetail): boolean {
  if (detail.tasks.length === 0) return !!detail.project.checklist['allTasksDone'];
  return detail.tasks.every((t) => t.status === 'Completed');
}

export function allIssuesClosedOf(detail: DesignProjectDetail): boolean {
  return detail.issues.every((i) => i.status === 'Resolved' || i.status === 'Closed');
}

/** Whether one checklist row is ticked — computed for the system rows, stored
 *  for the rest. */
export function isChecked(detail: DesignProjectDetail, key: string): boolean {
  if (key === 'allTasksDone') return allTasksDoneOf(detail);
  if (key === 'allIssuesClosed') return allIssuesClosedOf(detail);
  return !!detail.project.checklist[key];
}
