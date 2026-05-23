// QC Dashboard (legacy renderQCEngineerDash L3963, page `qcengineer`).
// Legacy chrome (.section-hdr / .panel / .innovic-table). Backend query
// (useQcDashboard, T-040g) unchanged — this is a chrome refactor + the legacy
// 7-tile layout, perf TOTAL row, and pending SO column.

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useQcDashboard } from '../api';

const searchSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  engineer: z.string().optional(),
});

export const qcDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-dashboard',
  validateSearch: searchSchema,
  component: QcDashboardPage,
});

function currentMonthIso(): string {
  return new Date().toISOString().slice(0, 7);
}

function rateColor(pct: number | null): string {
  if (pct === null) return 'var(--text3)';
  if (pct >= 95) return 'var(--green)';
  if (pct >= 85) return 'var(--amber)';
  return 'var(--red)';
}

function waitColor(days: number | null): string {
  if (days === null) return 'var(--text3)';
  if (days >= 3) return 'var(--red)';
  if (days >= 2) return 'var(--amber)';
  return 'var(--green)';
}

function QcDashboardPage(): React.JSX.Element {
  const search = qcDashboardRoute.useSearch();
  const navigate = qcDashboardRoute.useNavigate();
  const [monthInput, setMonthInput] = useState(search.month ?? currentMonthIso());

  const { data, isLoading, isError, error, isFetching } = useQcDashboard({
    month: search.month,
    engineer: search.engineer,
  });

  // Sync local month input when URL changes externally (back/forward, deep link).
  useMemo(() => {
    if (search.month && search.month !== monthInput) setMonthInput(search.month);
  }, [search.month, monthInput]);

  function applyMonth(next: string): void {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(next)) return;
    void navigate({ search: (prev) => ({ ...prev, month: next }) });
  }
  function applyEngineer(next: string): void {
    void navigate({ search: (prev) => ({ ...prev, engineer: next === '' ? undefined : next }) });
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          gap: 8,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          📊 QC Dashboard
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : null}
          <input
            type="month"
            className="innovic-input"
            style={{ width: 150, fontSize: 12 }}
            value={monthInput}
            onChange={(e) => setMonthInput(e.target.value)}
            onBlur={(e) => applyMonth(e.target.value)}
          />
          <select
            className="innovic-select"
            style={{ width: 180, fontSize: 12 }}
            value={search.engineer ?? ''}
            onChange={(e) => applyEngineer(e.target.value)}
          >
            <option value="">All Engineers</option>
            {(data?.engineers ?? []).map((eng) => (
              <option key={eng} value={eng}>
                {eng}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading QC dashboard…
          </div>
        </div>
      ) : isError || !data ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load QC dashboard'}
          </div>
        </div>
      ) : (
        <>
          {/* Summary tiles — legacy 7 (L4087-4093) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 8,
              marginBottom: 16,
            }}
          >
            <Tile
              label="PENDING CALLS"
              value={data.summary.pendingCalls}
              color="var(--amber)"
              {...(data.summary.overdueCalls > 0
                ? { hint: `🔴 ${data.summary.overdueCalls} overdue` }
                : {})}
            />
            <Tile label="INSPECTED TODAY" value={data.summary.inspectedToday} color="var(--cyan)" />
            <Tile label="ACCEPTED TODAY" value={data.summary.acceptedToday} color="var(--green)" />
            <Tile label="REJECTED TODAY" value={data.summary.rejectedToday} color="var(--red)" />
            <Tile
              label="TODAY RATE"
              value={data.summary.todayRatePct ?? '—'}
              suffix={data.summary.todayRatePct !== null ? '%' : ''}
              color={rateColor(data.summary.todayRatePct)}
            />
            <Tile label="MONTH CALLS" value={data.summary.monthCalls} color="var(--text)" />
            <Tile
              label="MONTH RATE"
              value={data.summary.monthRatePct ?? '—'}
              suffix={data.summary.monthRatePct !== null ? '%' : ''}
              color={rateColor(data.summary.monthRatePct)}
            />
          </div>

          {/* Two columns: Pending + Engineer Performance */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
              gap: 14,
              marginBottom: 14,
            }}
          >
            <div className="panel">
              <div className="panel-hdr">
                <span className="panel-title">⚠ Pending Calls — Oldest First</span>
                <span className="mono" style={{ color: 'var(--amber)', fontSize: 12 }}>
                  {data.summary.pendingCalls}
                </span>
              </div>
              <div className="tbl-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="innovic-table">
                  <thead>
                    <tr>
                      <th>JC</th>
                      <th>Operation</th>
                      <th>Item</th>
                      <th>Called</th>
                      <th>Wait</th>
                      <th style={{ textAlign: 'center' }}>Qty</th>
                      <th>SO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pending.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="empty-state">
                          ✅ No pending QC
                        </td>
                      </tr>
                    ) : (
                      data.pending.map((row) => (
                        <tr key={row.jcOpId}>
                          <td className="td-code cyan">
                            <Link
                              to="/op-entry"
                              search={{ jc: row.jcCode }}
                              style={{ color: 'var(--cyan)', textDecoration: 'none', fontWeight: 800 }}
                            >
                              {row.jcCode}
                            </Link>
                          </td>
                          <td style={{ fontSize: 11 }}>
                            Op{row.opSeq} {row.operation}
                          </td>
                          <td style={{ fontSize: 11, color: 'var(--purple)' }}>
                            {row.itemCode ?? '—'}
                          </td>
                          <td style={{ fontSize: 11 }}>{row.qcCallDate ?? '—'}</td>
                          <td className="td-ctr">
                            <span
                              className="fw-700"
                              style={{ fontSize: 12, color: waitColor(row.waitDays) }}
                            >
                              {row.waitDays === null ? '—' : `${row.waitDays}d`}
                            </span>
                          </td>
                          <td className="td-ctr mono fw-700" style={{ color: 'var(--amber)' }}>
                            {row.qcPending}
                          </td>
                          <td className="text3" style={{ fontSize: 10 }}>
                            {row.soCode ?? '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel">
              <div className="panel-hdr">
                <span className="panel-title">📊 Engineer Performance — {data.month}</span>
                <span className="mono text3" style={{ fontSize: 11 }}>
                  {data.summary.monthCalls} calls
                </span>
              </div>
              <div className="tbl-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="innovic-table">
                  <thead>
                    <tr>
                      <th>Engineer</th>
                      <th style={{ textAlign: 'center' }}>Calls</th>
                      <th style={{ textAlign: 'center', color: 'var(--green)' }}>Accept</th>
                      <th style={{ textAlign: 'center', color: 'var(--red)' }}>Reject</th>
                      <th style={{ textAlign: 'center' }}>Rate</th>
                      <th style={{ textAlign: 'center' }}>Avg Resp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.engineerPerf.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="empty-state">
                          No QC logs this month.
                        </td>
                      </tr>
                    ) : (
                      <>
                        {data.engineerPerf.map((row) => {
                          const selected = data.engineer === row.engineer;
                          return (
                            <tr
                              key={row.engineer}
                              style={{
                                cursor: 'pointer',
                                background: selected ? 'var(--bg4)' : undefined,
                              }}
                              onClick={() => applyEngineer(selected ? '' : row.engineer)}
                            >
                              <td className="fw-700" style={{ color: selected ? 'var(--cyan)' : undefined }}>
                                {row.engineer}
                                {selected ? ' ◀' : ''}
                              </td>
                              <td className="td-ctr mono fw-700">{row.calls}</td>
                              <td className="td-ctr mono" style={{ color: 'var(--green)' }}>
                                {row.acceptedQty}
                              </td>
                              <td className="td-ctr mono" style={{ color: 'var(--red)' }}>
                                {row.rejectedQty}
                              </td>
                              <td
                                className="td-ctr mono fw-700"
                                style={{ color: rateColor(row.ratePct) }}
                              >
                                {row.ratePct === null ? '—' : `${row.ratePct}%`}
                              </td>
                              <td className="td-ctr mono text3">
                                {row.avgResponseDays === null ? '—' : `${row.avgResponseDays}d`}
                              </td>
                            </tr>
                          );
                        })}
                        <tr style={{ background: 'var(--bg4)', fontWeight: 700 }}>
                          <td>TOTAL</td>
                          <td className="td-ctr mono">{data.summary.monthCalls}</td>
                          <td className="td-ctr mono" style={{ color: 'var(--green)' }}>
                            {data.engineerPerf.reduce((s, r) => s + r.acceptedQty, 0)}
                          </td>
                          <td className="td-ctr mono" style={{ color: 'var(--red)' }}>
                            {data.engineerPerf.reduce((s, r) => s + r.rejectedQty, 0)}
                          </td>
                          <td
                            className="td-ctr mono"
                            style={{ color: rateColor(data.summary.monthRatePct) }}
                          >
                            {data.summary.monthRatePct === null
                              ? '—'
                              : `${data.summary.monthRatePct}%`}
                          </td>
                          <td></td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Rejection reasons */}
          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title">🔴 Top Rejection Reasons — {data.month}</span>
            </div>
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>Reason</th>
                    <th style={{ textAlign: 'center' }}>Count</th>
                    <th>Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topRejectionReasons.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="empty-state">
                        No rejections recorded this month.
                      </td>
                    </tr>
                  ) : (
                    data.topRejectionReasons.map((row) => (
                      <tr key={row.reasonCategory}>
                        <td className="fw-700" style={{ fontSize: 12, textTransform: 'capitalize' }}>
                          {row.reasonCategory}
                        </td>
                        <td className="td-ctr mono fw-700" style={{ color: 'var(--red)' }}>
                          {row.count}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div
                              style={{
                                height: 14,
                                width: `${Math.max(row.pct, 2)}%`,
                                background: 'var(--red)',
                                borderRadius: 3,
                                minWidth: 4,
                              }}
                            />
                            <span className="text3" style={{ fontSize: 10 }}>
                              {row.pct}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Tile(props: {
  label: string;
  value: number | string;
  suffix?: string;
  color: string;
  hint?: string;
}): React.JSX.Element {
  return (
    <div className="panel" style={{ padding: 10, textAlign: 'center' }}>
      <div className="text3" style={{ fontSize: 9 }}>
        {props.label}
      </div>
      <div className="mono fw-700" style={{ fontSize: 24, color: props.color }}>
        {props.value}
        {props.suffix ?? ''}
      </div>
      {props.hint ? (
        <div style={{ fontSize: 9, color: 'var(--red)', fontWeight: 700 }}>{props.hint}</div>
      ) : null}
    </div>
  );
}
