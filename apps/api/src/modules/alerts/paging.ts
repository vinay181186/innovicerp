// Alerts dashboard + drill paging (ADR-201 — 25 rows a page).
//
// The rules run in TypeScript (each returns its whole record list), so the
// search / "show zero" filter and the page are applied here, on the server,
// over EVERY alert; the per-department counts and the grand total are worked
// out over every active alert too — never from the page the screen holds.
// A call without `limit` keeps today's answer (the home widgets read it whole).

import type { AlertDept } from '@innovic/shared';
import type { ListAlertsServiceResponse, RunAlertServiceResponse } from './service';

/** The department word the dashboard shows — searched like the screen did. */
const DEPT_LABEL: Record<AlertDept, string> = {
  sales: 'Sales',
  purchase: 'Purchase',
  store: 'Store',
  design: 'Design',
  production: 'Production',
  qc: 'QC',
};

export interface AlertsPageQuery {
  search?: string | undefined;
  /** undefined = every alert (the unpaged callers); false hides 0-record alerts. */
  showZero?: boolean | undefined;
  limit?: number | undefined;
  offset: number;
}

export interface AlertsPage extends ListAlertsServiceResponse {
  total: number;
  totalRecords: number;
  byDept: Record<string, number>;
}

export function pageAlerts(all: ListAlertsServiceResponse, q: AlertsPageQuery): AlertsPage {
  const byDept: Record<string, number> = {};
  let totalRecords = 0;
  for (const a of all.alerts) {
    byDept[a.dept] = (byDept[a.dept] ?? 0) + a.count;
    totalRecords += a.count;
  }
  const needle = (q.search ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  // Code order — codes are unique, so a page never skips or repeats an alert.
  const matching = [...all.alerts]
    .sort((a, b) => a.code.localeCompare(b.code))
    .filter((a) => q.showZero !== false || a.count > 0)
    .filter(
      (a) =>
        needle === '' ||
        [DEPT_LABEL[a.dept], a.code, a.name].some((f) => f.toLowerCase().includes(needle)),
    );
  const alerts =
    q.limit === undefined ? matching.slice(q.offset) : matching.slice(q.offset, q.offset + q.limit);
  return { generatedAt: all.generatedAt, alerts, total: matching.length, totalRecords, byDept };
}

/** One alert's drill records, one page; `alert.count` stays the full count. */
export function pageAlertRecords(
  res: RunAlertServiceResponse,
  q: { limit?: number | undefined; offset: number },
): RunAlertServiceResponse {
  if (q.limit === undefined && q.offset === 0) return res;
  const records =
    q.limit === undefined
      ? res.alert.records.slice(q.offset)
      : res.alert.records.slice(q.offset, q.offset + q.limit);
  return { ...res, alert: { ...res.alert, records } };
}
