// QC Call Register (ADR-284) — the Operation and Stage of a call, read the same
// way by the Pending table, the Completed table and the Excel export, and the
// register's two filters over them (Stage + the "All Operations" select).
// The server's Operation ▾ filter reads exactly the words qcOperationText gives.

import {
  QC_GRN_TYPES,
  QC_GRN_TYPE_LABELS,
  opSrNo,
  type QcGrnType,
  type QcRegisterCompletedItem,
  type QcRegisterPendingItem,
} from '@innovic/shared';
import type { DataTableColumn } from '@/ui/data';
import { QC_STAGES, type QcStage, type StageStat } from './qc-sheet';

type QcCallVm = QcRegisterPendingItem | QcRegisterCompletedItem;

/** The two stages the register shows: GRN + Party GRN calls, and every job-card
 *  call including the last op. 'process' is what the API's stage filter takes. */
export type QcRegisterStageChoice = 'incoming' | 'process';
const stageLabel = (k: QcStage): string => QC_STAGES.find((s) => s.key === k)?.label ?? '';
export const QC_REGISTER_STAGE_LABELS: Record<QcRegisterStageChoice, string> = {
  incoming: stageLabel('incoming'),
  process: stageLabel('inprocess'),
};

/** The Operation cell: the job-card op as stored ("DIR"), else the GRN Type. */
export function qcOperationText(vm: QcCallVm): string {
  if (vm.kind === 'op') return vm.row.operation;
  return QC_GRN_TYPE_LABELS[vm.kind === 'pgrn' ? 'party_grn' : vm.grnType];
}

/** The vendor (GRN line) or customer (Party GRN line) the call stands against;
 *  a job-card call has neither. */
export function qcPartyText(vm: QcCallVm): string | null {
  if (vm.kind === 'pgrn') return vm.row.customerName;
  return vm.kind === 'op' ? null : vm.row.vendorName;
}

/** Its hover: Op 20 DIR tells two DIRs on one job card apart. */
function qcOperationTitle(vm: QcCallVm): string {
  return vm.kind === 'op' ? `Op ${opSrNo(vm.row.opSeq)} ${vm.row.operation}` : qcOperationText(vm);
}

/** The Stage cell. */
function qcStageText(vm: QcCallVm): string {
  return QC_REGISTER_STAGE_LABELS[vm.kind === 'op' ? 'process' : 'incoming'];
}

export function operationColumn<T extends QcCallVm>(): DataTableColumn<T> {
  return {
    id: 'operation',
    sortFilterField: 'operation',
    header: 'Operation',
    align: 'left',
    ellipsis: true,
    render: (vm) => qcOperationText(vm),
    title: (vm) => qcOperationTitle(vm),
  };
}

export function stageColumn<T extends QcCallVm>(): DataTableColumn<T> {
  return {
    id: 'stage',
    kind: 'badge',
    header: 'Stage',
    nowrap: true,
    render: (vm) => (
      <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text2)' }}>
        {qcStageText(vm)}
      </span>
    ),
    filterValue: (vm) => qcStageText(vm),
  };
}

// ─── the filters ─────────────────────────────────────────────────────────────

export interface QcFilter {
  stage: QcRegisterStageChoice | null;
  grnType: QcGrnType | null;
  operation: string | null;
}
export const NO_QC_FILTER: QcFilter = { stage: null, grnType: null, operation: null };

/** One choice of the Operation filter, counted for the view on show. */
export interface QcOperationChoice {
  name: string;
  count: number;
}

/** A new Stage. A choice the new stage no longer lists is cleared with it. */
export function withStage(f: QcFilter, stage: QcRegisterStageChoice | null): QcFilter {
  if (stage === 'incoming') return { ...f, stage, operation: null };
  if (stage === 'process') return { ...f, stage, grnType: null };
  return { ...f, stage };
}

/** The Operation select's value for this filter ('' = All Operations). */
export function qcChoiceValue(f: QcFilter): string {
  if (f.operation !== null) return `op:${f.operation}`;
  return f.grnType ? `type:${f.grnType}` : '';
}

/** A pick in the Operation select. An operation or a type also sets its stage. */
export function withChoice(f: QcFilter, value: string): QcFilter {
  if (value.startsWith('op:')) {
    return { stage: 'process', grnType: null, operation: value.slice(3) };
  }
  if (value.startsWith('type:')) {
    return { stage: 'incoming', grnType: value.slice(5) as QcGrnType, operation: null };
  }
  return { ...f, grnType: null, operation: null };
}

/** The select's options: operations first, then the GRN Types, as Stage allows.
 *  A chosen operation whose count has gone stays listed, at (0). */
export function qcChoiceOptions(
  f: QcFilter,
  operations: readonly QcOperationChoice[],
  grnTypeStats: Record<QcGrnType, StageStat>,
): { value: string; label: string }[] {
  const ops =
    f.operation !== null && !operations.some((o) => o.name === f.operation)
      ? [...operations, { name: f.operation, count: 0 }]
      : operations;
  return [
    ...(f.stage === 'incoming'
      ? []
      : ops.map((o) => ({ value: `op:${o.name}`, label: `${o.name} (${o.count})` }))),
    ...(f.stage === 'process'
      ? []
      : QC_GRN_TYPES.map((t) => ({
          value: `type:${t}`,
          label: `${QC_GRN_TYPE_LABELS[t]} (${grnTypeStats[t].count})`,
        }))),
  ];
}

/** The header's filter note: "In-Process · DIR"; null when nothing is chosen. */
export function qcFilterNote(f: QcFilter): string | null {
  const parts = [
    f.stage ? QC_REGISTER_STAGE_LABELS[f.stage] : null,
    f.operation ?? (f.grnType ? QC_GRN_TYPE_LABELS[f.grnType] : null),
  ].filter((p) => p !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}
