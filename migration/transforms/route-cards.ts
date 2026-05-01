// route-cards transform — legacy `routeCards` to Postgres `route_cards` parent
// + `route_card_ops` children + `route_card_revisions` (jsonb history). Per
// ADR-011 #1, route cards are a master template; ops are split out to their
// own table; revisions are archival jsonb.
//
// Field mapping:
//   id           → _legacyId, uuidv5 → id
//   rcNo         → code
//   itemCode     → resolved via ctx.lookups.byCode.items → item_id (REQUIRED)
//   revision     → current_revision (default 1)
//   ops[]        → route_card_ops rows (1 per element)
//   revisionLog[] → route_card_revisions rows (1 per element, ops_snapshot as jsonb)
//
// Anomalies:
//   - rcNo missing → skip (with anomaly)
//   - itemCode unresolved (no matching items row by code) → skip (with anomaly)

import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformContext, TransformResult } from './types';

interface LegacyOp {
  machineId?: string;
  operation?: string;
  cycleTime?: number;
  program?: string;
  toolNo?: string;
  toolDetails?: string;
}

interface LegacyRevisionEntry {
  rev?: number;
  date?: string;
  changedBy?: string;
  notes?: string;
  opsSnapshot?: LegacyOp[];
}

interface LegacyRouteCard {
  id: string;
  rcNo?: string;
  itemCode?: string;
  ops?: LegacyOp[];
  revision?: number;
  revisionLog?: LegacyRevisionEntry[];
  updatedDate?: string;
}

export interface TransformedRouteCard {
  _legacyId: string;
  id: string;
  code: string;
  itemId: string;
  currentRevision: number;
  notes: string | null;
  _legacyExtras: Record<string, unknown>;
}

export interface TransformedRouteCardOp {
  _legacyId: string; // synthetic: `${rcNo}::${opSeq}`
  id: string;
  routeCardId: string;
  opSeq: number;
  machineId: string | null;
  machineCodeText: string | null;
  operation: string;
  opType: 'process' | 'qc' | 'outsource';
  cycleTimeMin: string; // numeric stored as string in Drizzle
  program: string | null;
  toolNo: string | null;
  toolDetails: string | null;
  qcRequired: boolean;
}

export interface TransformedRouteCardRevision {
  _legacyId: string; // synthetic: `${rcNo}::r${revNo}`
  id: string;
  routeCardId: string;
  revisionNo: number;
  notes: string | null;
  opsSnapshot: LegacyOp[];
}

export function legacyRouteCardIdToUuid(legacyId: string): string {
  return uuidv5(`route_cards/${legacyId}`, MIGRATION_UUID_NAMESPACE);
}

export function routeCardOpIdToUuid(rcNo: string, opSeq: number): string {
  return uuidv5(`route_card_ops/${rcNo}/${opSeq}`, MIGRATION_UUID_NAMESPACE);
}

export function routeCardRevisionIdToUuid(rcNo: string, revNo: number): string {
  return uuidv5(`route_card_revisions/${rcNo}/${revNo}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// Mirrors the legacy heuristic: machineId 'QC' → opType 'qc'; operations
// whose name contains 'COATING' / outsource keywords → 'outsource'. The
// legacy code also has _isOspOperation() but for route templates we keep
// it light; jc_ops will resolve outsource based on op_type from the JC.
function inferOpType(machineId: string | undefined, operation: string): 'process' | 'qc' | 'outsource' {
  if (machineId?.trim().toUpperCase() === 'QC') return 'qc';
  const opUpper = operation.toUpperCase();
  if (/\b(COATING|PLATING|HEAT TREATMENT|ANODIZING|GALVAN)/.test(opUpper)) return 'outsource';
  return 'process';
}

export function transformRouteCards(
  records: LegacyRouteCard[],
  ctx: TransformContext,
): TransformResult<unknown>[] {
  const cardRows: TransformedRouteCard[] = [];
  const opRows: TransformedRouteCardOp[] = [];
  const revRows: TransformedRouteCardRevision[] = [];
  const cardAnomalies: Anomaly[] = [];
  const opAnomalies: Anomaly[] = [];
  const revAnomalies: Anomaly[] = [];

  const itemsByCode = ctx.lookups.byCode['items'];
  const machinesByCode = ctx.lookups.byCode['machines'];

  for (const r of records) {
    if (!r.rcNo) {
      cardAnomalies.push({ legacyId: r.id, type: 'rcNo_missing' });
      continue;
    }
    const code = r.rcNo.trim();

    if (!r.itemCode) {
      cardAnomalies.push({ legacyId: r.id, type: 'itemCode_missing', details: { rcNo: code } });
      continue;
    }

    const itemId = itemsByCode?.get(r.itemCode.trim());
    if (!itemId) {
      cardAnomalies.push({
        legacyId: r.id,
        type: 'itemCode_unresolved',
        details: { rcNo: code, itemCode: r.itemCode },
      });
      continue;
    }

    const cardUuid = legacyRouteCardIdToUuid(r.id);
    cardRows.push({
      _legacyId: r.id,
      id: cardUuid,
      code,
      itemId,
      currentRevision: typeof r.revision === 'number' && r.revision > 0 ? r.revision : 1,
      notes: null,
      _legacyExtras: r.updatedDate ? { updatedDate: r.updatedDate } : {},
    });

    // ─── Ops ───
    const ops = Array.isArray(r.ops) ? r.ops : [];
    ops.forEach((op, idx) => {
      const opSeq = idx + 1;
      const operation = (op.operation ?? '').trim();
      if (!operation) {
        opAnomalies.push({
          legacyId: r.id,
          type: 'operation_missing',
          details: { rcNo: code, opSeq },
        });
        return;
      }

      const machineCodeRaw = op.machineId?.trim() ?? '';
      const machineId = machineCodeRaw && machineCodeRaw !== 'QC'
        ? machinesByCode?.get(machineCodeRaw) ?? null
        : null;
      const machineCodeText = machineCodeRaw && !machineId ? machineCodeRaw : null;

      const opType = inferOpType(op.machineId, operation);

      opRows.push({
        _legacyId: `${code}::${opSeq}`,
        id: routeCardOpIdToUuid(code, opSeq),
        routeCardId: cardUuid,
        opSeq,
        machineId,
        machineCodeText,
        operation,
        opType,
        cycleTimeMin: typeof op.cycleTime === 'number' ? op.cycleTime.toFixed(2) : '0.00',
        program: emptyToNull(op.program),
        toolNo: emptyToNull(op.toolNo),
        toolDetails: emptyToNull(op.toolDetails),
        qcRequired: opType === 'qc',
      });
    });

    // ─── Revisions ───
    const revLog = Array.isArray(r.revisionLog) ? r.revisionLog : [];
    for (const rev of revLog) {
      if (typeof rev.rev !== 'number') {
        revAnomalies.push({
          legacyId: r.id,
          type: 'revision_no_missing',
          details: { rcNo: code, rev },
        });
        continue;
      }
      revRows.push({
        _legacyId: `${code}::r${rev.rev}`,
        id: routeCardRevisionIdToUuid(code, rev.rev),
        routeCardId: cardUuid,
        revisionNo: rev.rev,
        notes: emptyToNull(rev.notes),
        opsSnapshot: Array.isArray(rev.opsSnapshot) ? rev.opsSnapshot : [],
      });
    }
  }

  return [
    {
      table: 'route_cards',
      sourceCollection: 'routeCards',
      transformedAt: new Date().toISOString(),
      rows: cardRows,
      anomalies: cardAnomalies,
    },
    {
      table: 'route_card_ops',
      sourceCollection: 'routeCards',
      transformedAt: new Date().toISOString(),
      rows: opRows,
      anomalies: opAnomalies,
    },
    {
      table: 'route_card_revisions',
      sourceCollection: 'routeCards',
      transformedAt: new Date().toISOString(),
      rows: revRows,
      anomalies: revAnomalies,
    },
  ];
}
