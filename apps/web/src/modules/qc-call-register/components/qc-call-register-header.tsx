// QC Call Register — the list header band (title · count · the register totals
// summary line · search · Stage filter · Mine toggle · the Pending|Completed
// switch · Full History · Export). Split out of routes/index.tsx so that file
// stays under the 400-line ceiling. Presentational — every lever is a prop.
//
// ADR-251: a GRN Type filter beside Stage, and an 'incoming' mode for the
// Incoming QC screen (its own title, no Stage / Mine / Full History, and the
// GRN Type choices narrowed to Against PO + Party GRN).

import {
  INCOMING_QC_GRN_TYPES,
  QC_GRN_TYPES,
  QC_GRN_TYPE_LABELS,
  type QcGrnType,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { ListHeader } from '@/ui/layout';
import { QC_STAGES, type QcStage, type QcView, type StageStat } from './qc-sheet';

/** The Pending | Completed segmented toggle: the chosen side filled dark, the
 *  other outlined — the mockup's two-button switch on the .btn base. */
function viewBtn(
  v: QcView,
  label: string,
  view: QcView,
  setView: (v: QcView) => void,
): React.JSX.Element {
  const on = view === v;
  return (
    <button
      key={v}
      type="button"
      className="btn btn-sm"
      aria-pressed={on}
      onClick={() => setView(v)}
      style={{
        background: on ? 'var(--text)' : 'var(--bg2)',
        color: on ? 'var(--bg2)' : 'var(--text)',
        border: `1px solid ${on ? 'var(--text)' : 'var(--border2)'}`,
        fontSize: 12,
      }}
    >
      {label}
    </button>
  );
}

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
}): React.JSX.Element {
  const { mode, view, stage, stageStats, mineOnly, search, grnType, grnTypeStats } = props;
  const incoming = mode === 'incoming';
  // The GRN Types this screen offers, and the "All" count over them.
  const types: readonly QcGrnType[] = incoming ? INCOMING_QC_GRN_TYPES : QC_GRN_TYPES;
  const allTypesCount = types.reduce((n, t) => n + grnTypeStats[t].count, 0);
  return (
    <ListHeader
      title={incoming ? 'Incoming QC' : 'QC Call Register'}
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
                fontSize: 12,
              }}
            >
              👤 Mine
            </button>
          ) : null}
        </>
      }
      onClearFilters={props.onClearFilters}
      filtersActive={stage !== null || grnType !== null || mineOnly || search.trim() !== ''}
      tools={
        <>
          <div style={{ display: 'flex', gap: 4 }}>
            {viewBtn('pending', 'Pending', view, props.setView)}
            {viewBtn('completed', 'Completed', view, props.setView)}
          </div>
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
            ⬇ Export
          </button>
        </>
      }
    >
      <div className="text3" style={{ fontSize: 12 }}>
        {props.pendingCount} calls · {props.pcsPending} pcs QC Pending · {props.completeCount}{' '}
        completed
      </div>
    </ListHeader>
  );
}
