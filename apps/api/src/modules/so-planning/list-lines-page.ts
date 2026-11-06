// SO/JWSO Planning list, one row per line (ADR-268) — source, search, Sort &
// Filter and 25-row paging on the SERVER, in memory like list-page.ts: the
// figures are worked out in code, so there is no SQL expression to filter on.

import {
  docDrawingRev,
  docText,
  itemCodeWithRev,
  linePros,
  lineJcs,
  lineRouteCards,
  planningLineStatus,
  rcText,
  type PlanningLineListItem,
  type PlanningLineListQuery,
  type PlanningLineListResponse,
  type PlanningLineStatusResult,
} from '@innovic/shared';

import { readSf } from '../../lib/list-query';
import { type MemFieldMap, pageRows, sfFilterRows, sfSortRows } from '../so-overview/sf-memory';
import { istDay } from './list-page';

/** One line + what the search and the headings read, worked out once per row. */
export interface PlanningLinePageRow {
  item: PlanningLineListItem;
  /** The line's typed text, kept searchable though the row does not send it. */
  itemCodeText: string | null;
  partName: string | null;
  itemCodeRev: string;
  status: PlanningLineStatusResult;
  rcNo: string;
  proNo: string;
  jcNo: string;
}

export function toPlanningLinePageRow(
  item: PlanningLineListItem,
  typed: { itemCodeText: string | null; partName: string | null },
): PlanningLinePageRow {
  return {
    item,
    ...typed,
    itemCodeRev: itemCodeWithRev(item.itemCode, docDrawingRev(item), ''),
    status: planningLineStatus({
      orderQty: item.orderQty,
      remaining: item.remaining,
      totalPlanned: item.totalPlanned,
      directJcQty: item.directJcQty,
      plans: item.plans,
      shortClosed: item.shortClosed,
    }),
    rcNo: rcText(lineRouteCards(item)),
    proNo: docText(linePros(item)),
    jcNo: docText(lineJcs(item)),
  };
}

// Keys = PLANNING_LINE_LIST_SF_FIELD (packages/shared), the screen's headings.
export const PLANNING_LINE_LIST_SF_FIELDS: MemFieldMap<PlanningLinePageRow> = {
  soCode: { type: 'text', get: (r) => r.item.soCode },
  soInternalNo: { type: 'text', get: (r) => r.item.soInternalNo },
  pol: { type: 'text', get: (r) => r.item.clientPoLineNo },
  itemCode: { type: 'text', get: (r) => r.itemCodeRev },
  itemName: { type: 'text', get: (r) => r.item.itemName },
  // ADR-261 Created On — the line's created_at as the India-time day.
  createdOn: { type: 'date', get: (r) => istDay(r.item.createdAt) },
  lineNo: { type: 'num', get: (r) => r.item.lineNo },
  customerName: { type: 'text', get: (r) => r.item.customerName },
  soType: { type: 'list', get: (r) => r.item.soType },
  dueDate: { type: 'date', get: (r) => r.item.dueDate },
  orderQty: { type: 'num', get: (r) => r.item.orderQty },
  planQty: { type: 'num', get: (r) => r.item.totalPlanned },
  toPlan: { type: 'num', get: (r) => r.item.remaining },
  planningPct: { type: 'num', get: (r) => r.status.pct },
  planState: { type: 'list', get: (r) => r.status.state },
  partyGrnStatus: { type: 'list', get: (r) => r.item.partyGrnStatus },
  createdBy: { type: 'text', get: (r) => r.item.createdByName },
};

/** YYYY-MM-DD → 03-11-2026, as the screen prints a date. */
function shownDate(iso: string | null | undefined): string | null {
  return iso ? iso.split('-').reverse().join('-') : null;
}

/** "Pending" is what a blank RC / PRO / JC cell reads, not a value: it must not
 *  make every undone line match a search for "pen". */
function docSearchText(cell: string): string | null {
  return cell === 'Pending' ? null : cell;
}

function matchesTerm(r: PlanningLinePageRow, needle: string): boolean {
  const { item } = r;
  return [
    item.soCode,
    item.soInternalNo,
    item.clientPoLineNo,
    `L${item.lineNo}`,
    r.itemCodeRev,
    item.itemCode,
    item.itemName,
    r.itemCodeText,
    r.partName,
    item.customerName,
    item.soType.replace(/_/g, ' '),
    item.dueDate,
    shownDate(item.dueDate),
    shownDate(istDay(item.createdAt)),
    item.createdByName,
    // Without its "(450 pending)": the state's name is what a search means.
    r.status.label.replace(/\s*\(.*\)$/, ''),
    docSearchText(r.rcNo),
    docSearchText(r.proNo),
    docSearchText(r.jcNo),
    ...item.plans.map((p) => p.code),
    ...item.prs.map((p) => p.code),
  ].some((f) => f != null && String(f).toLowerCase().includes(needle));
}

/** ADR-279 — the lines of the home check "Party GRN received, plan pending"
 *  (dashboard/checks/planning.ts jwLinesGrnReceivedSql): To Plan above 0 and
 *  material received. Done / Part Done are exactly "received above 0". */
function isGrnPlanPending({ item }: PlanningLinePageRow): boolean {
  return (
    item.remaining > 0 && (item.partyGrnStatus === 'done' || item.partyGrnStatus === 'part_done')
  );
}

/** Every row (input order = the list's own) → the page the screen asked for. */
export function pagePlanningLines(
  rows: PlanningLinePageRow[],
  query: PlanningLineListQuery,
): PlanningLineListResponse {
  const sf = readSf(query.sf);
  const needle = (query.search ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const bySource = query.src ? rows.filter((r) => r.item.source === query.src) : rows;
  const pool = query.grnPlanPending === '1' ? bySource.filter(isGrnPlanPending) : bySource;
  const searched = needle === '' ? pool : pool.filter((r) => matchesTerm(r, needle));
  const sorted = sfSortRows(
    sfFilterRows(searched, PLANNING_LINE_LIST_SF_FIELDS, sf),
    PLANNING_LINE_LIST_SF_FIELDS,
    sf,
  );
  return {
    generatedAt: new Date().toISOString(),
    total: sorted.length,
    items: pageRows(sorted, query.limit, query.offset).map((r) => r.item),
  };
}
