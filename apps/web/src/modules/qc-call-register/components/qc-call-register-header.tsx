// QC Call Register — the list header band (title · count · the register totals
// summary line · search · Stage filter · Mine toggle · Full History · Export ·
// the Pending|Completed tabs). Split out of routes/index.tsx so that file
// stays under the 400-line ceiling. Presentational — every lever is a prop.
//
// ADR-251: a GRN Type filter beside Stage, and an 'incoming' mode for the
// Incoming QC screen (its own title, no Stage / Mine / Full History, and the
// GRN Type choices narrowed to Direct Purchase + Party GRN).

import { Icon } from '@/ui/core';
import type { ReactNode } from 'react';
import {
  INCOMING_QC_GRN_TYPES,
  QC_GRN_TYPES,
  QC_GRN_TYPE_LABELS,
  type QcGrnType,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { ListHeader } from '@/ui/layout';
import { QC_STAGES, type QcStage, type QcView, type StageStat } from './qc-sheet';
import { TabStrip } from '@/ui/navigation';

/** Which screen the register body is drawn for (ADR-251). */
export type QcScreenMode = 'register' | 'incoming';

export function QcCallRegisterHeader(props: {
  mode: QcScreenMode;
  view: QcView;
  setView: (v: QcView) => void;
  stage: QcStage | null;
  setStage: (s: QcStage | null) => void;
  stageName: string | null;
  mineOnly: boolean;
  onToggleMine: () => void;
  search: string;
  setSearch: (s: string) => void;
  /** ADR-200: a column filter is applied on the table on show. */
  sfFiltering: boolean;
  onClearFilters: () => void;
  stageStats: Record<QcStage, StageStat>;
  grnType: QcGrnType | null;
  setGrnType: (t: QcGrnType | null) => void;
  grnTypeStats: Record<QcGrnType, StageStat>;
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
  const { mode, view, stage, stageStats, mineOnly, search, grnType, grnTypeStats } = props;
  const incoming = mode === 'incoming';
  // The GRN Types this screen offers, and the "All" count over them.
  const types: readonly QcGrnType[] = incoming ? INCOMING_QC_GRN_TYPES : QC_GRN_TYPES;
  const allTypesCount = types.reduce((n, t) => n + grnTypeStats[t].count, 0);
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
          {incoming ? null : (
            <select
              className="innovic-select"
              aria-label="QC stage"
              title="QC stage"
              value={stage ?? ''}
              onChange={(e) =>
                props.setStage(e.target.value === '' ? null : (e.target.value as QcStage))
              }
            >
              <option value="">
                {`All stages (${stageStats.incoming.count + stageStats.inprocess.count + stageStats.final.count})`}
              </option>
              {QC_STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {`${s.label} (${stageStats[s.key].count})`}
                </option>
              ))}
            </select>
          )}
          <select
            className="innovic-select"
            aria-label="GRN Type"
            title="GRN Type"
            value={grnType ?? ''}
            onChange={(e) =>
              props.setGrnType(e.target.value === '' ? null : (e.target.value as QcGrnType))
            }
          >
            {/* Register: "All" is no GRN Type filter (job-card calls included),
                so no count; Incoming QC: both of its types, counted. */}
            <option value="">
              {incoming ? `All GRN Types (${allTypesCount})` : 'All GRN Types'}
            </option>
            {types.map((t) => (
              <option key={t} value={t}>
                {`${QC_GRN_TYPE_LABELS[t]} (${grnTypeStats[t].count})`}
              </option>
            ))}
          </select>
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
        stage !== null || grnType !== null || mineOnly || search.trim() !== '' || props.sfFiltering
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
