// Pure stuck-rule helpers for the Stuck Activity Dashboard (legacy
// renderStuckDashboard L18043-18103). No DB / env dependency, so these are
// directly unit-testable; the service composes them with the SQL loaders.

import type { StuckItem, StuckThresholds } from '@innovic/shared';
import { type SoPhaseData, diffDays } from '../../lib/so-phase-data';

// Stage colours — legacy renderStuckDashboard inline hex.
export const STAGE_COLOR = {
  design: '#8B5CF6',
  planning: '#8B5CF6',
  jc: '#06B6D4',
  material: '#2563EB',
  productionOp: '#06B6D4',
  qc: '#EF4444',
  assembly: '#06B6D4',
  dispatch: '#0D9488',
} as const;

function daysSince(dateStr: string | null, today: string): number {
  return diffDays(dateStr, today) ?? 0;
}

/**
 * Phase-level stuck rules over the SO phase-data set. Excludes the two op-level
 * rules (Production Op / QC Pending) which need the v_jc_op_status view. Pure —
 * `today` is injected for deterministic tests.
 */
export function derivePhaseStuckItems(
  data: SoPhaseData[],
  thr: StuckThresholds,
  today: string,
): StuckItem[] {
  const items: StuckItem[] = [];
  for (const d of data) {
    if (d.status === 'closed' || d.status === 'cancelled') continue;
    if (d.phases.dispatched) continue; // already dispatched = not stuck
    const p = d.phases;
    const base = { soId: d.soId, soNo: d.soNo, customer: d.customer };

    if (p.designAssigned && !p.designApproved) {
      const days = daysSince(p.designAssigned, today);
      if (days > thr.design) {
        items.push({ ...base, stage: 'Design', days, threshold: thr.design, detail: 'Design in progress, not approved', since: p.designAssigned, color: STAGE_COLOR.design });
      }
    }
    const designReady = p.designApproved ?? p.bomLinked;
    if (designReady && !p.planCreated) {
      const days = daysSince(designReady, today);
      if (days > thr.designToPlan) {
        items.push({ ...base, stage: 'Planning', days, threshold: thr.designToPlan, detail: 'Design ready but no plan created', since: designReady, color: STAGE_COLOR.planning });
      }
    }
    if (p.planCreated && !p.jcCreated) {
      const days = daysSince(p.planCreated, today);
      if (days > thr.planToJc) {
        items.push({ ...base, stage: 'JC Creation', days, threshold: thr.planToJc, detail: 'Plan created but JC not generated', since: p.planCreated, color: STAGE_COLOR.jc });
      }
    }
    if (p.prRaised && !p.grnReceived) {
      const days = daysSince(p.prRaised, today);
      if (days > thr.materialProc) {
        items.push({ ...base, stage: 'Material Procurement', days, threshold: thr.materialProc, detail: 'PR raised, GRN pending', since: p.prRaised, color: STAGE_COLOR.material });
      }
    }
    if (p.assemblyStarted && !p.assemblyDone) {
      const days = daysSince(p.assemblyStarted, today);
      if (days > thr.assembly) {
        items.push({ ...base, stage: 'Assembly', days, threshold: thr.assembly, detail: 'Assembly in progress', since: p.assemblyStarted, color: STAGE_COLOR.assembly });
      }
    }
    if (p.assemblyDone && !p.dispatched) {
      const days = daysSince(p.assemblyDone, today);
      if (days > thr.assemblyToDispatch) {
        items.push({ ...base, stage: 'Dispatch Pending', days, threshold: thr.assemblyToDispatch, detail: 'Assembly done, awaiting dispatch', since: p.assemblyDone, color: STAGE_COLOR.dispatch });
      }
    }
  }
  return items;
}

export interface OpStuckCandidate {
  soId: string;
  soNo: string;
  customer: string | null;
  jcNo: string;
  opSeq: number;
  operation: string;
  available: number;
  qcPending: number;
  lastEntry: string | null;
  jcDate: string | null;
}

/**
 * Classify one op candidate (legacy L18073-18089). QC-pending qty → QC Pending
 * stage (qc threshold); otherwise an available production op → Production Op
 * stage (productionOp threshold). Returns null if under threshold. Pure.
 */
export function classifyOpStuck(
  c: OpStuckCandidate,
  thr: StuckThresholds,
  today: string,
): StuckItem | null {
  const since = c.lastEntry ?? c.jcDate;
  const days = daysSince(since, today);
  const base = { soId: c.soId, soNo: c.soNo, customer: c.customer };
  if (c.qcPending > 0) {
    if (days > thr.qc) {
      return { ...base, stage: 'QC Pending', days, threshold: thr.qc, detail: `${c.jcNo} Op${c.opSeq}: ${c.operation} — ${c.qcPending} pcs`, since, color: STAGE_COLOR.qc };
    }
    return null;
  }
  if (c.available > 0 && days > thr.productionOp) {
    return { ...base, stage: 'Production Op', days, threshold: thr.productionOp, detail: `${c.jcNo} Op${c.opSeq}: ${c.operation} — ${c.available} avail`, since, color: STAGE_COLOR.productionOp };
  }
  return null;
}
