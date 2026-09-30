// Activity-log display helpers (ADR-197) — the ONE web file that knows
//   1. where a logged document opens (entity → page), and
//   2. which badge colour an action wears.
//
// Names and labels come from @innovic/shared (enums/activity.ts): a stored
// entity or action — standard or legacy spelling — is first mapped to its
// standard form, so `Job Card`, `JobCard` and `JcOp` open the same page and
// `UPDATE` wears the same badge as `EDIT`.

import {
  ACTIVITY_ENTITY_META,
  canonicalActivityAction,
  canonicalActivityEntity,
  type ActivityAction,
  type ActivityEntity,
  type GlobalSearchKind,
} from '@innovic/shared';

/** Document types with a detail page but no global-search kind — opened
 *  straight by id. Everything else goes through its search kind, whose
 *  landing lives in lib/global-search.ts (openSearchResult). */
export const ACTIVITY_DETAIL_ROUTES: Partial<Record<ActivityEntity, string>> = {
  ProductionOrder: '/production-orders/$id',
  StockCount: '/stock-counts/$id',
};

/** Where a stored entity name opens, or null when it has no page. */
export function activityEntityTarget(
  entity: string,
): { kind: GlobalSearchKind; route?: undefined } | { kind?: undefined; route: string } | null {
  const std = canonicalActivityEntity(entity);
  if (!std) return null;
  const kind = ACTIVITY_ENTITY_META[std].searchKind;
  if (kind) return { kind };
  const route = ACTIVITY_DETAIL_ROUTES[std];
  return route ? { route } : null;
}

const ACTION_BADGE: Record<ActivityAction, string> = {
  CREATE: 'b-green',
  EDIT: 'b-blue',
  SUBMIT: 'b-cyan',
  APPROVE: 'b-green',
  REJECT: 'b-red',
  WITHDRAW: 'b-amber',
  REQUEST: 'b-amber',
  START: 'b-amber',
  LOG: 'b-green',
  QC: 'b-purple',
  SEND: 'b-cyan',
  RECEIVE: 'b-teal',
  ISSUE: 'b-cyan',
  RETURN: 'b-amber',
  COMPLETE: 'b-green',
  CLOSE: 'b-blue',
  CLOSE_SHORT: 'b-orange',
  REOPEN: 'b-amber',
  REVERSE: 'b-orange',
  CANCEL: 'b-red',
  DELETE: 'b-red',
  RESTORE: 'b-amber',
  DISPOSE: 'b-amber',
  SPLIT: 'b-grey',
  PAYMENT: 'b-green',
  POST: 'b-blue',
};

/** Legacy names with no standard equivalent that already had a colour on the
 *  Activity Log (the legacy hex map, ISSUE-067) — kept so old rows look the same. */
const LEGACY_BADGE: Record<string, string> = {
  DISPATCH: 'b-cyan',
  PR_CONVERT: 'b-cyan',
  NC_CLOSE_REWORK: 'b-green',
  OP_STOP: 'b-orange',
};

/** Badge class for any stored action; an ad-hoc legacy name is grey. */
export function activityActionBadge(action: string): string {
  const legacy = LEGACY_BADGE[action];
  if (legacy) return legacy;
  const std = canonicalActivityAction(action);
  return std ? ACTION_BADGE[std] : 'b-grey';
}
