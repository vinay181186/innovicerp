// Live operations board columns (ADR-199 fit table). Moved out of
// running-ops-board.tsx so both the "Running now" and "Recent" tables share one
// set of render helpers and neither file grows past the 400-line ceiling.
//
// The display is the only thing that changed: every start / stop mutation, the
// machine split (ADR-164) and the Started-By audit line (ADR-197) are preserved
// exactly, now rendered through DataTable columns instead of hand-written <td>s.

import { ActionLink } from '@/components/shared/action-link';
import type { RunningOp } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { ActualMachineCell, PlannedMachineCell } from '@/components/shared/machine-split';
import { fmtDate, fmtDateAndTime, fmtDateTime } from '@/lib/date';
import { leadColumns, type DataTableColumn } from '@/ui/data';
import { RunningOpStatusBadge } from './status-badge';

/** GET /op-entry/running-ops rows carry `startedByName` — the logged-in user
 *  who pressed Start (ADR-197) — which the shared RunningOp type does not
 *  declare yet. `operatorName` is the operator on the floor. */
export type RunningOpRow = RunningOp & { startedByName?: string | null };

/** The JC number, as a way INTO that card rather than a code to copy and hunt
 *  for on another screen. Colour, mono face and weight are inherited from the
 *  cell it sits in, so the code keeps exactly the identity it has on every other
 *  board. A JC number is short, so it stays on one line. */
function JcLink({ id, code }: { id: string; code: string }): React.JSX.Element {
  return (
    <ActionLink
      fallback="text"
      to="/job-cards/$id"
      params={{ id }}
      title="View job card status"
      style={{ color: 'inherit', textDecoration: 'none', whiteSpace: 'nowrap' }}
    >
      {code}
    </ActionLink>
  );
}

/** Nothing hidden by default — the six lead columns are always shown (owner
 *  rule 2026-10-31, ADR-261). Kept as the board's defaultHidden hook. */
export const RUNNING_OPS_DEFAULT_HIDDEN: string[] = [];

/** True when a different person pressed Start than the operator on the floor. */
function startedByDiffers(r: RunningOpRow): string | null {
  const startedBy = r.startedByName?.trim() ?? '';
  const differs =
    startedBy !== '' && startedBy.toLowerCase() !== (r.operatorName ?? '').trim().toLowerCase();
  return differs ? startedBy : null;
}

/** The six lead columns (ADR-261), shared by both tables so the look cannot
 *  drift. `server` = the paged board's server Sort & Filter field names
 *  (running-ops-read.ts RUNNING_OPS_SF_COLUMNS); the keyless Recent table
 *  filters its page locally. Spread FIRST — `doc` (the JC No.) is drawn first
 *  and locked with the block; Op and the rest follow Item Name (ADR-261
 *  amendment 31-Oct). */
function identityColumns(
  server: boolean,
  doc: DataTableColumn<RunningOpRow>,
): DataTableColumn<RunningOpRow>[] {
  return leadColumns<RunningOpRow>({
    doc,
    docDate: {
      id: 'jc_date',
      kind: 'date',
      header: 'JC Date',
      className: 'mono',
      nowrap: true,
      render: (r) => fmtDate(r.jcDate ?? null),
      filterValue: (r) => r.jcDate ?? '',
      ...(server ? { sortFilterField: 'jcDate' } : {}),
    },
    soNo: (r) => r.soCode,
    internalSoNo: (r) => r.soInternalNo,
    pol: (r) => r.clientPoLineNo,
    createdOn: (r) => r.createdAt,
    itemCode: (r) => r.itemCode,
    itemRev: (r) => r.itemRevision,
    itemName: (r) => r.itemName,
    ...(server
      ? {
          overrides: {
            so_no: { sortFilterField: 'soCode' },
            so_internal_no: { sortFilterField: 'soInternalNo' },
            client_po_line_no: { sortFilterField: 'clientPoLineNo' },
            created_on: { sortFilterField: 'createdOn' },
            item_code: { sortFilterField: 'itemCode' },
            item_name: { sortFilterField: 'itemName' },
          },
        }
      : {}),
  });
}

const opColumn: DataTableColumn<RunningOpRow> = {
  id: 'op_seq',
  sortFilterField: 'opSeq',
  filterType: 'num',
  kind: 'code',
  header: 'Op',
  className: 'mono',
  render: (r) => opSrNo(r.opSeq),
};

const operationColumn: DataTableColumn<RunningOpRow> = {
  id: 'operation',
  sortFilterField: 'operation',
  kind: 'text',
  header: 'Operation',
  ellipsis: true,
  render: (r) => r.operation,
  title: (r) => r.operation,
};

/** ADR-164 — the session's machine is the ACTUAL; the op's jc_ops machine is the
 *  PLAN. Each gets its own column on every in-house row; an OSP session has no
 *  machine. */
const plannedMachineColumn: DataTableColumn<RunningOpRow> = {
  id: 'planned_machine',
  sortFilterField: 'plannedMachineCode',
  kind: 'code',
  header: 'Planned Machine',
  className: 'mono text3',
  render: (r) => (r.isOsp ? 'OSP' : <PlannedMachineCell planned={r.plannedMachineCode} />),
};

const actualMachineColumn: DataTableColumn<RunningOpRow> = {
  id: 'actual_machine',
  sortFilterField: 'machineCode',
  kind: 'code',
  header: 'Actual Machine',
  className: 'mono text3',
  render: (r) =>
    r.isOsp ? (
      '—'
    ) : (
      <ActualMachineCell planned={r.plannedMachineCode} activeRunningMachineCode={r.machineCode} />
    ),
};

/** Operator on the floor, plus "Started By" inline (one line) when someone else
 *  pressed Start (ADR-197). */
const operatorColumn: DataTableColumn<RunningOpRow> = {
  id: 'operator',
  sortFilterField: 'operatorName',
  kind: 'text',
  header: 'Operator',
  align: 'left',
  ellipsis: true,
  render: (r) => {
    const startedBy = startedByDiffers(r);
    return (
      <>
        {r.operatorName ?? '—'}
        {startedBy ? <span className="text3"> · by {startedBy}</span> : null}
      </>
    );
  },
  title: (r) => {
    const startedBy = startedByDiffers(r);
    return startedBy
      ? `${r.operatorName ?? '—'} — Started By: ${startedBy}`
      : (r.operatorName ?? '');
  },
};

/** "Running now": the live sessions. `sortFilterField` = the field in the
 *  server's column map (running-ops-read.ts) — the board's Sort & Filter runs
 *  on the server because it is paged (ADR-201). The lead block is locked;
 *  the Stop action is added by the board as the trailing ⋯ menu. */
export function runningNowColumns(): DataTableColumn<RunningOpRow>[] {
  return [
    ...identityColumns(true, {
      id: 'jc_no',
      sortFilterField: 'jobCardCode',
      kind: 'code',
      header: 'JC No.',
      className: 'td-code cyan',
      render: (r) => <JcLink id={r.jobCardId} code={r.jobCardCode} />,
    }),
    opColumn,
    operationColumn,
    actualMachineColumn,
    operatorColumn,
    {
      id: 'started',
      sortFilterField: 'startDate',
      kind: 'date',
      header: 'Started',
      className: 'mono',
      render: (r) => fmtDateAndTime(r.startDate, r.startTime),
    },
    plannedMachineColumn,
  ];
}

/** "Recent": the last finished / cancelled sessions. Same layout as Running now
 *  but Ended + Op Status replace Started + the Stop action. */
export function recentOpsColumns(): DataTableColumn<RunningOpRow>[] {
  return [
    ...identityColumns(false, {
      id: 'jc_no',
      kind: 'code',
      header: 'JC No.',
      className: 'td-code',
      render: (r) => <JcLink id={r.jobCardId} code={r.jobCardCode} />,
    }),
    opColumn,
    operationColumn,
    actualMachineColumn,
    operatorColumn,
    {
      id: 'ended',
      kind: 'date',
      header: 'Ended',
      className: 'mono text3',
      render: (r) => fmtDateTime(r.endedAt),
    },
    {
      id: 'op_status',
      kind: 'badge',
      header: 'Op Status',
      render: (r) => <RunningOpStatusBadge status={r.status} />,
    },
    plannedMachineColumn,
  ];
}
