// QC Call Register — the list header band (title · count · the register totals
// summary line · search · Stage filter · Mine toggle · Full History · Export ·
// the Pending|Completed tabs). Split out of routes/index.tsx so that file
// stays under the 400-line ceiling. Presentational — every lever is a prop.
//
// ADR-251: an 'incoming' mode for the Incoming QC screen (its own title, no Stage
// / Mine / Full History, and a GRN Type filter of Direct Purchase + Party GRN).
// ADR-284: the register filters on Stage (Incoming | In-Process) and on one
// "All Operations" select holding the operations and the four GRN Types.

import { Icon } from '@/ui/core';
import type { ReactNode } from 'react';
import { INCOMING_QC_GRN_TYPES, QC_GRN_TYPE_LABELS, type QcGrnType } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { ListHeader } from '@/ui/layout';
import {
  QC_REGISTER_STAGE_LABELS,
  type QcFilter,
  type QcOperationChoice,
  type QcRegisterStageChoice,
  qcChoiceOptions,
  qcChoiceValue,
  withChoice,
  withStage,
} from './qc-call-operation';
import type { QcStage, QcView, StageStat } from './qc-sheet';
import { TabStrip } from '@/ui/navigation';

/** Which screen the register body is drawn for (ADR-251). */
export type QcScreenMode = 'register' | 'incoming';

export function QcCallRegisterHeader(props: {
  mode: QcScreenMode;
  view: QcView;
  setView: (v: QcView) => void;
  /** Stage + GRN Type + operation. Every change goes through here. */
  filter: QcFilter;
  onFilter: (f: QcFilter) => void;
  stageName: string | null;
  mineOnly: boolean;
  onToggleMine: () => void;
  search: string;
  setSearch: (s: string) => void;
  /** ADR-200: a column filter is applied on the table on show. */
  sfFiltering: boolean;
  onClearFilters: () => void;
  stageStats: Record<QcStage, StageStat>;
  grnTypeStats: Record<QcGrnType, StageStat>;
  operationStats: QcOperationChoice[];
  shownCount: number;
  pendingCount: number;
  completeCount: number;
  pcsPending: number;
  isEmpty: boolean;
  onExport: () => void;
  orderFilter: ReactNode;
  /** The register's QC Calls | TPI tabs (none on Incoming QC). */
  tabs?: ReactNode;
}): React.JSX.Element {
  const { mode, view, filter, onFilter, stageStats, mineOnly, search, grnTypeStats } = props;
  const incoming = mode === 'incoming';
  // Incoming QC's "All" count over its GRN Types.
  const allTypesCount = INCOMING_QC_GRN_TYPES.reduce((n, t) => n + grnTypeStats[t].count, 0);
  const stageCount: Record<QcRegisterStageChoice, number> = {
    incoming: stageStats.incoming.count,
    process: stageStats.inprocess.count + stageStats.final.count,
  };
  return (
    <ListHeader
      title={incoming ? 'Incoming QC' : 'QC Call Register'}
      orderFilter={props.orderFilter}
      icon={incoming ? '🔬' : '📋'}
      count={props.shownCount}
      noun={view === 'pending' ? 'pending call' : 'completed entry'}
      nounPlural={view === 'pending' ? 'pending calls' : 'completed entries'}
      filterNote={props.stageName ?? undefined}
      search={search}
      onSearch={props.setSearch}
      searchPlaceholder={
        incoming
          ? 'Search GRN, Party GRN, vendor, customer, POL, item…'
          : 'Search JC, GRN, SO, POL, item, part, vendor…'
      }
      filters={
        <>
          {incoming ? (
            <select
              className="innovic-select"
              aria-label="GRN Type"
              title="GRN Type"
              value={filter.grnType ?? ''}
              onChange={(e) =>
                onFilter({
                  ...filter,
                  grnType: e.target.value === '' ? null : (e.target.value as QcGrnType),
                })
              }
            >
              <option value="">{`All GRN Types (${allTypesCount})`}</option>
              {INCOMING_QC_GRN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {`${QC_GRN_TYPE_LABELS[t]} (${grnTypeStats[t].count})`}
                </option>
              ))}
            </select>
          ) : (
            <>
              <select
                className="innovic-select"
                aria-label="QC stage"
                title="QC stage"
                value={filter.stage ?? ''}
                onChange={(e) =>
                  onFilter(
                    withStage(
                      filter,
                      e.target.value === '' ? null : (e.target.value as QcRegisterStageChoice),
                    ),
                  )
                }
              >
                <option value="">
                  {`All stages (${stageCount.incoming + stageCount.process})`}
                </option>
                {(['incoming', 'process'] as const).map((s) => (
                  <option key={s} value={s}>
                    {`${QC_REGISTER_STAGE_LABELS[s]} (${stageCount[s]})`}
                  </option>
                ))}
              </select>
              <select
                className="innovic-select"
                aria-label="Operation"
                title="Operation"
                value={qcChoiceValue(filter)}
                onChange={(e) => onFilter(withChoice(filter, e.target.value))}
              >
                {/* "All" is no narrowing at all, so no count. */}
                <option value="">All Operations</option>
                {qcChoiceOptions(filter, props.operationStats, grnTypeStats).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </>
          )}
          {view === 'pending' && !incoming ? (
            <button
              type="button"
              className="btn btn-sm"
              aria-pressed={mineOnly}
              title="Only the QC calls assigned to you on QC Command"
              onClick={props.onToggleMine}
              style={{
                background: mineOnly ? 'var(--text)' : 'var(--bg2)',
                color: mineOnly ? 'var(--bg2)' : 'var(--text)',
                border: `1px solid ${mineOnly ? 'var(--text)' : 'var(--border2)'}`,
                fontSize: 'var(--fs-sm)',
              }}
            >
              👤 Mine
            </button>
          ) : null}
        </>
      }
      onClearFilters={props.onClearFilters}
      filtersActive={
        filter.stage !== null ||
        filter.grnType !== null ||
        filter.operation !== null ||
        mineOnly ||
        search.trim() !== '' ||
        props.sfFiltering
      }
      tools={
        <>
          {view === 'completed' && !incoming ? (
            <Link
              to="/qc-history"
              className="btn btn-ghost btn-sm"
              title="The full QC history log — pending ops and completed entries, with dates"
            >
              Full History →
            </Link>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={props.isEmpty}
            title={`Export every ${view} call matching the filters to Excel`}
            onClick={props.onExport}
          >
            <Icon name="download" size={13} /> Export
          </button>
        </>
      }
    >
      {props.tabs}
      <TabStrip
        label="QC call status"
        tabs={[
          { key: 'pending', label: 'Pending' },
          { key: 'completed', label: 'Completed' },
        ]}
        activeKey={view}
        onChange={(k) => props.setView(k === 'completed' ? 'completed' : 'pending')}
      />
      <div className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
        {props.pendingCount} calls · {props.pcsPending} pcs QC Pending · {props.completeCount}{' '}
        completed
      </div>
    </ListHeader>
  );
}
