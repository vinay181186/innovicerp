// SO / JWSO status by day (ADR-325) — the days list. ONE component, used by
// Reports › SO / JWSO Status (range kept in the address) and by the Home menu
// view of the same name (range kept on the page). One table, its header the
// frozen heading bar; weeks Mon–Sun newest first, each a heading row that
// hides / shows its days; each day an SO row then a JWSO row.

import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { todayIst } from '@/lib/date';
import { oneOf, usePersistentState } from '@/lib/use-persistent-state';
import { useMyCompany } from '@/modules/settings/api';
import { Icon } from '@/ui/core';
import { DataTable, Panel } from '@/ui/data';
import { ReportFilter, ReportShell } from '@/ui/data/ReportShell';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { useToast } from '@/ui/feedback';
import { PageState } from '@/ui/layout';
import { useSoJwsoDays } from '../api';
import {
  type DayRow,
  type DaysMode,
  type DaysRange,
  QUICK_RANGES,
  HOME_SHOW_KEY,
  SHOW_KINDS,
  SHOW_OPTIONS,
  type ShowKind,
  buildDayRows,
  quickRange,
  rangeProblem,
  weekHeading,
} from '../lib/days';
import { exportDaysExcel, printDays, REPORT_TITLE } from '../lib/export';
import '../so-jwso-status.css';
import { daysColumns } from './columns';
import { FilterGroup, SegButtons } from './filters';

const MODES: { value: DaysMode; label: string }[] = [
  { value: 'all', label: 'Every day' },
  { value: 'weekEnd', label: 'Week end only' },
];

export interface SoJwsoDaysViewProps {
  range: DaysRange;
  onRange: (next: DaysRange) => void;
  /** Home view: a date opens the day with from=home, so Back returns to Home. */
  home?: boolean | undefined;
}

export function SoJwsoDaysView({
  range,
  onRange,
  home = false,
}: SoJwsoDaysViewProps): React.JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: company } = useMyCompany();
  const problem = rangeProblem(range);
  const q = useSoJwsoDays(range.from, range.to, problem === null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [exporting, setExporting] = useState(false);
  const today = q.data?.today ?? todayIst();
  const { rows, weeks, dayCount } = useMemo(
    () =>
      buildDayRows(
        q.data?.days ?? [],
        { from: range.from, to: range.to, mode: range.mode, show: range.show },
        today,
      ),
    [q.data, range.from, range.to, range.mode, range.show, today],
  );
  const columns = useMemo(() => daysColumns(), []);

  const anyCollapsed = collapsed.size > 0;
  const quickOn =
    QUICK_RANGES.find((r) => {
      const qr = quickRange(r.key, today);
      return qr.from === range.from && qr.to === range.to;
    })?.key ?? null;

  const toggleWeek = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const openDay = (r: DayRow): void => {
    void navigate({
      to: '/so-jwso-status/$date',
      params: { date: r.date },
      search: home
        ? { from: 'home', show: range.show }
        : { from: range.from, to: range.to, mode: range.mode, show: range.show },
    });
  };

  const onExcel = async (): Promise<void> => {
    setExporting(true);
    try {
      await exportDaysExcel(rows, range);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not make the Excel file.');
    } finally {
      setExporting(false);
    }
  };

  const onPrint = (): void => {
    if (!printDays(rows, weeks, range, company)) toast.error('Allow popups to print.');
  };

  return (
    <ReportShell
      fill
      title={REPORT_TITLE}
      icon="📅"
      subtitle="SO and JWSO figures day by day — today live, past days from the copy saved that day."
      actions={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void q.refetch()}
            disabled={problem !== null || q.isFetching}
          >
            <Icon name="refresh-cw" size={13} /> {q.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onPrint}
            disabled={rows.length === 0}
          >
            <Icon name="printer" size={13} /> Print
          </button>
        </>
      }
      onExport={{ excel: () => void onExcel(), busy: exporting }}
      exportDisabled={rows.length === 0}
      filters={
        <>
          <ReportFilter label="From" htmlFor="sjs-from">
            <input
              id="sjs-from"
              type="date"
              className="innovic-input"
              value={range.from}
              max={range.to || today}
              onChange={(e) => e.target.value && onRange({ ...range, from: e.target.value })}
            />
          </ReportFilter>
          <ReportFilter label="To" htmlFor="sjs-to">
            <input
              id="sjs-to"
              type="date"
              className="innovic-input"
              value={range.to}
              max={today}
              onChange={(e) =>
                e.target.value &&
                e.target.value <= today &&
                onRange({ ...range, to: e.target.value })
              }
            />
          </ReportFilter>
          <FilterGroup label="Quick range">
            <SegButtons
              options={QUICK_RANGES.map((r) => ({ value: r.key, label: r.label }))}
              value={quickOn}
              onChange={(k) => onRange({ ...range, ...quickRange(k, today) })}
            />
          </FilterGroup>
          <FilterGroup label="Days">
            <SegButtons
              options={MODES}
              value={range.mode}
              onChange={(mode) => onRange({ ...range, mode })}
            />
          </FilterGroup>
          <FilterGroup label="Show">
            <SegButtons
              options={SHOW_OPTIONS}
              value={range.show}
              onChange={(show) => onRange({ ...range, show })}
            />
          </FilterGroup>
          <div className="sjs-f sjs-end">
            <span className="form-label">&nbsp;</span>
            <div className="sjs-ctl">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={weeks.size === 0}
                onClick={() => setCollapsed(anyCollapsed ? new Set() : new Set(weeks.keys()))}
              >
                {anyCollapsed ? 'Expand all' : 'Collapse all'}
              </button>
            </div>
          </div>
        </>
      }
      rowCount={problem || q.isError ? undefined : dayCount}
      rowNoun="day"
    >
      {problem ? (
        <PageState state="error" message={problem} />
      ) : q.isError ? (
        <PageState
          state="error"
          message={
            q.error instanceof Error ? q.error.message : 'Could not load the days. Try again.'
          }
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable<DayRow>
            tableKey={TABLE_KEYS.soJwsoDays}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.key}
            loading={q.isLoading}
            sortFilter={false}
            emptyText="No days in this range."
            onRowClick={openDay}
            isRowClickable={(r) => r.first && !r.future}
            rowClassName={(r) => (collapsed.has(r.weekKey) ? 'sjs-hidden' : undefined)}
            groupRow={(r, _i, prev) => {
              if (prev?.weekKey === r.weekKey) return null;
              const w = weeks.get(r.weekKey);
              if (!w) return null;
              const shut = collapsed.has(w.key);
              return (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-expanded={!shut}
                  onClick={() => toggleWeek(w.key)}
                >
                  <Icon name={shut ? 'chevron-right' : 'chevron-down'} size={12} /> {weekHeading(w)}
                </button>
              );
            }}
          />
        </Panel>
      )}
    </ReportShell>
  );
}

/** The Home menu view: the same list, its range kept on the page (This week
 *  when Home opens); Show is kept for the browser tab, so Back from a day keeps it. */
export function SoJwsoDaysHome(): React.JSX.Element {
  const [show, setShow] = usePersistentState<ShowKind>(HOME_SHOW_KEY, 'all', oneOf(SHOW_KINDS));
  const [range, setRange] = useState<Omit<DaysRange, 'show'>>(() => {
    const t = todayIst();
    return { ...quickRange('thisWeek', t), mode: 'all' };
  });
  const onRange = (next: DaysRange): void => {
    const { show: nextShow, ...rest } = next;
    setRange(rest);
    setShow(nextShow);
  };
  return <SoJwsoDaysView range={{ ...range, show }} onRange={onRange} home />;
}
