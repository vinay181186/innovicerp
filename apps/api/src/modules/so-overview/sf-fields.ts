// Sort & Filter (ADR-200) fields of the SO Overview list. The rows are worked
// out in code (progress roll-up), so each field reads the SAME row value the
// column shows, and sf-memory.ts filters / sorts the whole set on the server.

import type { SoOverviewRow } from '@innovic/shared';

import type { MemFieldMap } from './sf-memory';

export const SO_OVERVIEW_SF_FIELDS: MemFieldMap<SoOverviewRow> = {
  // The SO No. cell shows "IN-SO-00786 · SO-2401" (ADR-207), so the filter
  // reads the same text; sort order is unchanged (the SO No. leads).
  code: {
    type: 'text',
    get: (r) => (r.internalSoNo ? `${r.code} · ${r.internalSoNo}` : r.code),
  },
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
