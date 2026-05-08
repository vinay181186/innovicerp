// Alerts registry (T-041d Phase A, ADR-024).
//
// Each alert is a (definition, run) pair. The registry exports ALERTS as a
// map keyed by code (`AL-001` etc.). Definitions are static metadata
// returned by GET /alerts/config; run executes the rule against the user's
// company context and returns drill-down records.
//
// Adding a new alert = drop a new file under alerts/definitions/, register
// it here, and ensure tests cover it. No DSL, no codegen — hand-written
// SQL per rule. See ADR-024 for the rationale (vs. saved-reports-style
// declarative spec).
//
// 8 of legacy's 23 rules deferred (doc_missing source data) per ADR-024
// carve-out.

import type { AlertDefinition, AlertRow } from '@innovic/shared';
import type { DbTransaction } from '../../db/with-user-context';
import { al001PosTodayApproved } from './definitions/al-001-pos-today-approved';
import { al002PrsPendingStale } from './definitions/al-002-prs-pending-stale';
import { al003ItemsOutOfStock } from './definitions/al-003-items-out-of-stock';
import { al004SoDue7Days } from './definitions/al-004-so-due-7-days';
import { al005SoOverdue } from './definitions/al-005-so-overdue';
import { al006PrsPending } from './definitions/al-006-prs-pending';
import { al007GrnToday } from './definitions/al-007-grn-today';
import { al008GrnPendingQc } from './definitions/al-008-grn-pending-qc';
import { al009NcRecent } from './definitions/al-009-nc-recent';
import { al011BomPending } from './definitions/al-011-bom-pending';
import { al012JcOverdue } from './definitions/al-012-jc-overdue';
import { al013MachinesIdle } from './definitions/al-013-machines-idle';
import { al014PoOverdue } from './definitions/al-014-po-overdue';
import { al015OspPrsPendingPo } from './definitions/al-015-osp-prs-pending-po';
import { al018NcPendingDisposition } from './definitions/al-018-nc-pending-disposition';

export interface AlertRunContext {
  tx: DbTransaction;
  companyId: string;
}

export interface AlertRunResult {
  records: AlertRow[];
}

export interface RegisteredAlert {
  definition: AlertDefinition;
  run: (ctx: AlertRunContext) => Promise<AlertRunResult>;
}

export const ALERTS: Record<string, RegisteredAlert> = {
  [al001PosTodayApproved.definition.code]: al001PosTodayApproved,
  [al002PrsPendingStale.definition.code]: al002PrsPendingStale,
  [al003ItemsOutOfStock.definition.code]: al003ItemsOutOfStock,
  [al004SoDue7Days.definition.code]: al004SoDue7Days,
  [al005SoOverdue.definition.code]: al005SoOverdue,
  [al006PrsPending.definition.code]: al006PrsPending,
  [al007GrnToday.definition.code]: al007GrnToday,
  [al008GrnPendingQc.definition.code]: al008GrnPendingQc,
  [al009NcRecent.definition.code]: al009NcRecent,
  [al011BomPending.definition.code]: al011BomPending,
  [al012JcOverdue.definition.code]: al012JcOverdue,
  [al013MachinesIdle.definition.code]: al013MachinesIdle,
  [al014PoOverdue.definition.code]: al014PoOverdue,
  [al015OspPrsPendingPo.definition.code]: al015OspPrsPendingPo,
  [al018NcPendingDisposition.definition.code]: al018NcPendingDisposition,
};

export function listAlertDefinitions(): AlertDefinition[] {
  // Stable code-order so the dashboard renders predictably.
  return Object.values(ALERTS)
    .map((a) => a.definition)
    .sort((a, b) => a.code.localeCompare(b.code));
}
