// SO/JWSO Planning list — source, search, Sort & Filter and 25-row paging on
// the SERVER (ADR-201). The list's coverage figures are worked out in code
// (service.ts getPlanningSoList), so the rows are filtered / sorted / paged
// here, over every open order, and only the page goes to the browser.

import type {
  PlanningSoListItem,
  PlanningSoListQuery,
  PlanningSoListResponse,
} from '@innovic/shared';

import { readSf } from '../../lib/list-query';
import { type MemFieldMap, pageRows, sfFilterRows, sfSortRows } from '../so-overview/sf-memory';

/** The Plan Status words the screen shows (searched as shown). */
const STATUS_LABEL: Record<PlanningSoListItem['planningStatus'], string> = {
  fully_planned: 'Fully Planned',
  partial: 'Partly Planned',
  unplanned: 'Unplanned',
};

export const PLANNING_LIST_SF_FIELDS: MemFieldMap<PlanningSoListItem> = {
  soCode: { type: 'text', get: (r) => r.soCode },
  soInternalNo: { type: 'text', get: (r) => r.soInternalNo },
  customerName: { type: 'text', get: (r) => r.customerName },
  soType: { type: 'list', get: (r) => r.soType },
  dueDate: { type: 'date', get: (r) => r.dueDate },
  totalLines: { type: 'num', get: (r) => r.totalLines },
  totalQty: { type: 'num', get: (r) => r.totalQty },
  totalPlannedQty: { type: 'num', get: (r) => r.totalPlannedQty },
  planningPct: { type: 'num', get: (r) => r.planningPct },
  planningStatus: { type: 'list', get: (r) => r.planningStatus },
};

function matchesTerm(r: PlanningSoListItem, needle: string): boolean {
  return [
    r.soCode,
    r.soInternalNo,
    r.customerName,
    r.soType,
    r.dueDate,
    STATUS_LABEL[r.planningStatus],
    r.itemsText,
  ].some((f) => f != null && String(f).toLowerCase().includes(needle));
}

/**
 * Every order (input order = the list's own: SO No. descending per source) →
 * the page the screen asked for. No params → every order, as before.
 */
export function pagePlanningSoList(
  items: PlanningSoListItem[],
  query: PlanningSoListQuery,
): PlanningSoListResponse {
  const sf = readSf(query.sf);
  const needle = (query.search ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const bySource = query.src ? items.filter((r) => r.source === query.src) : items;
  const searched = needle === '' ? bySource : bySource.filter((r) => matchesTerm(r, needle));
  const sorted = sfSortRows(
    sfFilterRows(searched, PLANNING_LIST_SF_FIELDS, sf),
    PLANNING_LIST_SF_FIELDS,
    sf,
  );
  return {
    generatedAt: new Date().toISOString(),
    total: sorted.length,
    items: pageRows(sorted, query.limit, query.offset),
  };
}
