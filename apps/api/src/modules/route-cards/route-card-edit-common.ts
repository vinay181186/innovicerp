// Route Card edit-approval (ADR-249 Step B2) — the pieces shared by the
// registry entry (./route-card-edit-registry.ts) and the writers in
// ./service.ts. No database imports, so the summary is unit-testable as is.
//
// The whole routing — every operation plus the raw material — is ONE approval
// box, "Operations" (owner's choice: the smallest approach). Its before / after
// value is the text summary built here. That text is also what the engine's
// freshness check compares at approval time, so it is CANONICAL: every field a
// Route Card op stores is in it (nothing truncated), in a fixed order, numbers
// normalised ("5.00" → 5). Any drift in the stored routing after the request
// therefore changes the text, and the box is marked superseded.

import { AsyncLocalStorage } from 'node:async_hooks';
import { opSrNo, type UpdateRouteCardInput } from '@innovic/shared';

/** The one routing box's field key. */
export const ROUTING_FIELD = 'operations';
export const ROUTING_LABEL = 'Operations';

/** One op as the summary reads it — codes, not ids. */
export interface RoutingSummaryOp {
  opSeq: number;
  operation: string;
  opType: string;
  machineCode: string | null;
  ospVendorCode: string | null;
  cycleTimeMin: number | string | null;
  ospLeadDays: number | null;
  program: string | null;
  toolNo: string | null;
  toolDetails: string | null;
  remarks: string | null;
  qcRequired: boolean | null;
}

/** The card's raw material as the summary reads it. */
export interface RoutingSummaryRm {
  rawMaterialGradeText: string | null;
  rawMaterialSizeText: string | null;
  rawMaterialItemCode: string | null;
  rmQtyPerPiece: number | string | null;
}

const OP_TYPE_WORD: Record<string, string> = { process: 'In-house', outsource: 'OSP', qc: 'QC' };

const txt = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim();
  return s.length > 0 ? s : null;
};

const num = (v: number | string | null | undefined): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : String(v);
};

/** "10 Turning (In-house, CNC-1, 5 min)" — every stored field that is set. */
export function routingOpText(o: RoutingSummaryOp): string {
  const parts: string[] = [OP_TYPE_WORD[o.opType] ?? o.opType];
  const machine = txt(o.machineCode);
  // A QC step carries the 'QC' placeholder as its machine (see service.ts
  // note 3) — saying "QC, QC" tells the approver nothing.
  if (machine && !(o.opType === 'qc' && machine.toUpperCase() === 'QC')) parts.push(machine);
  const vendor = txt(o.ospVendorCode);
  if (vendor) parts.push(vendor);
  parts.push(`${num(o.cycleTimeMin) ?? '0'} min`);
  if (o.ospLeadDays !== null && o.ospLeadDays !== undefined) parts.push(`lead ${o.ospLeadDays}d`);
  const program = txt(o.program);
  if (program) parts.push(`Program ${program}`);
  const toolNo = txt(o.toolNo);
  if (toolNo) parts.push(`Tool ${toolNo}`);
  const toolDetails = txt(o.toolDetails);
  if (toolDetails) parts.push(`Tool details: ${toolDetails}`);
  const remarks = txt(o.remarks);
  if (remarks) parts.push(`Remarks: ${remarks}`);
  if (o.qcRequired) parts.push('QC required');
  return `${opSrNo(o.opSeq)} ${txt(o.operation) ?? '(unnamed)'} (${parts.join(', ')})`;
}

/** "RM: EN24 / DIA 32, RM Item RM-EN24-32 × 1.5 per piece" — or "RM: —". */
export function routingRmText(rm: RoutingSummaryRm): string {
  const grade = txt(rm.rawMaterialGradeText);
  const size = txt(rm.rawMaterialSizeText);
  const item = txt(rm.rawMaterialItemCode);
  const qty = num(rm.rmQtyPerPiece);
  if (!grade && !size && !item && !qty) return 'RM: —';
  let out = `RM: ${grade ?? '—'} / ${size ?? '—'}`;
  if (item || qty) out += `, RM Item ${item ?? '—'} × ${qty ?? '—'} per piece`;
  return out;
}

/** The "Operations" box value: ops in route order, then the raw material. */
export function routingSummary(ops: readonly RoutingSummaryOp[], rm: RoutingSummaryRm): string {
  const sorted = [...ops].sort((a, b) => a.opSeq - b.opSeq);
  const opsText = sorted.length > 0 ? sorted.map(routingOpText).join(' · ') : '(no operations)';
  return `${opsText} | ${routingRmText(rm)}`;
}

/**
 * Set while saveRouteCardForItem stages a routing change from INSIDE a Job Card
 * create/edit or Plan execute transaction. That caller already holds its plan
 * row lock, so the registry's loadForDiff must NOT take the plans pre-lock
 * there: two Executes of two blank-RM plans for one item would each hold their
 * own plan and wait for the other's (40P01). Everywhere else (the PUT staging
 * path, the approver's decide) loadForDiff takes plans BEFORE route_cards, the
 * order updateRouteCard and executePlan already use.
 */
export const stagingFromSourceDoc = new AsyncLocalStorage<true>();

/** The payload a Route Card edit request freezes: the PUT input, plus — for a
 *  routing change staged from a Job Card / plan — the request note (`reason`,
 *  which the engine writes on the request's History row) and the source
 *  document's code, which the approved revision's note names. */
export type RouteCardEditPayload = UpdateRouteCardInput & {
  reason?: string | null;
  sourceCode?: string | null;
  /** Source-document proposals only: whether the proposer could fill blank
   *  raw material (ADR-218 canWriteCard) — the approval fills only then. */
  fillRm?: boolean;
};

/** The plain sentence the saving screen shows when a different routing could
 *  not be sent for approval (ADR-249 Step B2). */
export function routingNotSentReason(cardCode: string, refusal: string | null): string {
  const msg = refusal ?? '';
  if (/already has an edit waiting/i.test(msg)) {
    return (
      `Route Card ${cardCode} already has a change waiting for approval — this routing was not ` +
      'sent; approve or reject that change, then save again.'
    );
  }
  if (/nothing changed/i.test(msg)) {
    return (
      `Route Card ${cardCode} already reads the same as this routing, so nothing was sent ` +
      'for approval.'
    );
  }
  return msg
    ? `Route Card ${cardCode} was not changed and this routing was not sent for approval: ${msg}`
    : `Route Card ${cardCode} was not changed and this routing could not be sent for approval — ` +
        'try saving again, or ask an admin.';
}
