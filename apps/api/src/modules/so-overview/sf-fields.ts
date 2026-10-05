// Sort & Filter (ADR-200) fields of the SO Overview list. The rows are worked
// out in code (progress roll-up), so each field reads the SAME row value the
// column shows, and sf-memory.ts filters / sorts the whole set on the server.

import type { SoOverviewRow } from '@innovic/shared';

import type { MemFieldMap } from './sf-memory';

export const SO_OVERVIEW_SF_FIELDS: MemFieldMap<SoOverviewRow> = {
  // Each number has its OWN column now, so each field reads one number only.
  code: { type: 'text', get: (r) => r.code },
  internalSoNo: { type: 'text', get: (r) => r.internalSoNo },
  customerName: { type: 'text', get: (r) => r.customerName },
  type: { type: 'list', get: (r) => r.type },
  overallStatus: { type: 'list', get: (r) => r.overallStatus },
  overallPct: { type: 'num', get: (r) => r.overallPct },
  totalRequiredQty: { type: 'num', get: (r) => r.totalRequiredQty },
  totalDoneQty: { type: 'num', get: (r) => r.totalDoneQty },
  totalBalanceQty: { type: 'num', get: (r) => r.totalBalanceQty },
  earliestDueDate: { type: 'date', get: (r) => r.earliestDueDate },
  clientPoNo: { type: 'text', get: (r) => r.clientPoNo },
  equipmentItemName: { type: 'text', get: (r) => r.equipmentItemName },
  lineCount: { type: 'num', get: (r) => r.lineCount },
  soDate: { type: 'date', get: (r) => r.soDate },
};
