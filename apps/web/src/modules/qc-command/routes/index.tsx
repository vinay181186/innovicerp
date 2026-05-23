// QC Command Center (legacy renderQCCommandCenter L18613). 5-tab QC control
// board: Queue / First-Pass Yield / Rejection Pareto / Inspector Performance /
// Rework. Frontend-only — composes the existing qc-history (pending) and
// qc-dashboard (inspector perf + rejection reasons + rates) endpoints into the
// Command Center layout. Legacy chrome.
//
// Partial vs legacy: FPY and Rework tabs need per-op QC-attempt history (not in
// the current op_log read) — surfaced with the available proxy + a note. The
// legacy Pick-Up / Assign actions need a qc_assignments table (deferred).

import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { useQcDashboard } from '@/modules/qc-dashboard/api';
import { useQcHistory } from '@/modules/qc-history/api';
import { authenticatedRoute } from '@/routes/_authenticated';

const searchSchema = z.object({
  tab: z.enum(['queue', 'fpy', 'pareto', 'inspector', 'rework']).optional(),
});

export const qcCommandRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-command',
  validateSearch: searchSchema,
  component: QcCommandPage,
});

type Tab = 'queue' | 'fpy' | 'pareto' | 'inspector' | 'rework';
const TABS: { id: Tab; label: string }[] = [
  { id: 'queue', label: '📝 QC Queue' },
  { id: 'fpy', label: '📈 First-Pass Yield' },
  { id: 'pareto', label: '📊 Rejection Pareto' },
  { id: 'inspector', label: '👤 Inspector Performance' },
  { id: 'rework', label: '🔄 Rework Cycles' },
];

function rateColor(pct: number | null): string {
  if (pct === null) return 'var(--text3)';
  if (pct >= 95) return 'var(--green)';
  if (pct >= 85) return 'var(--amber)';
  return 'var(--red)';
}

function QcCommandPage(): React.JSX.Element {
  const search = qcCommandRoute.useSearch();
  const navigate = qcCommandRoute.useNavigate();
  const tab: Tab = search.tab ?? 'queue';
  const hist = useQcHistory();
  const dash = useQcDashboard({});

  const pending = hist.data?.pending ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const age = (pendSince: string | null): number =>
    pendSince ? Math.max(0, Math.round((Date.parse(today) - Date.parse(pendSince)) / 864e5)) : 0;
  const oldest = pending.reduce((m, p) => Math.max(m, age(p.pendSince)), 0);

  function setTab(t: Tab): void {
    void navigate({ search: () => (t === 'queue' ? {} : { tab: t }), replace: true });
  }

  const loading = hist.isLoading || dash.isLoading;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          🔬 QC Command Center
        </div>
        {hist.isFetching || dash.isFetching ? (
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            <Loader2 className="inline h-3 w-3 animate-spin" />
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading command center…
          </div>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              marginBottom: 16,
            }}
          >
            <Stat label="QC Pending" value={hist.data?.stats.pendingOps ?? 0} color="var(--red)" />
            <Stat label="Overdue" value={hist.data?.stats.overdue ?? 0} color="var(--red)" />
            <Stat label="Oldest" value={`${oldest}d`} color="var(--amber)" />
            <Stat
              label="Month Acceptance"
              value={`${dash.data?.summary.monthRatePct ?? '—'}%`}
              color={rateColor(dash.data?.summary.monthRatePct ?? null)}
            />
            <Stat label="Inspected Today" value={dash.data?.summary.inspectedToday ?? 0} color="var(--cyan)" />
          </div>

          {/* Tabs */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              borderBottom: '1px solid var(--border)',
              marginBottom: 14,
              flexWrap: 'wrap',
            }}
          >
            {TABS.map((t) => (
              <div
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  borderBottom: `2px solid ${tab === t.id ? 'var(--red)' : 'transparent'}`,
                  color: tab === t.id ? 'var(--red)' : 'var(--text3)',
                }}
              >
                {t.label}
              </div>
            ))}
          </div>

          {tab === 'queue' ? <QueueTab pending={pending} age={age} /> : null}
          {tab === 'pareto' ? <ParetoTab reasons={dash.data?.topRejectionReasons ?? []} /> : null}
          {tab === 'inspector' ? <InspectorTab perf={dash.data?.engineerPerf ?? []} /> : null}
          {tab === 'fpy' ? (
            <NoteTab
              title="First-Pass Yield"
              body={`Month QC acceptance rate (proxy): ${dash.data?.summary.monthRatePct ?? '—'}%. True first-pass yield (% passed on the first inspection attempt) needs per-op QC-attempt history; tracked as a follow-up. See the QC Dashboard for engineer-level rates.`}
            />
          ) : null}
          {tab === 'rework' ? (
            <NoteTab
              title="Rework Cycles"
              body="Rework-cycle analytics need per-op QC-attempt counts (1st / 2nd / 3rd inspection). The op_log QC entries support this once an attempt index is derived; tracked as a follow-up. NC Register shows rework dispositions today."
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function Stat(props: { label: string; value: number | string; color: string }): React.JSX.Element {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: 14,
        borderRadius: 10,
        background: 'var(--bg3)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="text3" style={{ fontSize: 10 }}>
        {props.label}
      </div>
      <div className="mono fw-700" style={{ fontSize: 26, color: props.color }}>
        {props.value}
      </div>
    </div>
  );
}

interface PendingRow {
  jcOpId: string;
  jcCode: string;
  opSeq: number;
  operation: string;
  itemCode: string | null;
  soCode: string | null;
  qcPending: number;
  pendSince: string | null;
  overdue: boolean;
}

function QueueTab({
  pending,
  age,
}: {
  pending: PendingRow[];
  age: (s: string | null) => number;
}): React.JSX.Element {
  const sorted = [...pending].sort((a, b) => age(b.pendSince) - age(a.pendSince));
  return (
    <div className="panel">
      <div className="panel-hdr">
        <span className="panel-title">QC Pending Items — oldest first</span>
        <span className="mono" style={{ color: 'var(--red)', fontSize: 12 }}>
          {pending.length}
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'center' }}>Age</th>
              <th>JC / Op</th>
              <th>Operation</th>
              <th>Item</th>
              <th>SO</th>
              <th style={{ textAlign: 'center', color: 'var(--amber)' }}>Pending</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state" style={{ color: 'var(--green)' }}>
                  ✅ No pending QC items
                </td>
              </tr>
            ) : (
              sorted.map((it) => {
                const d = age(it.pendSince);
                const c = d >= 3 ? 'var(--red)' : d >= 1 ? 'var(--amber)' : 'var(--green)';
                return (
                  <tr key={it.jcOpId} style={it.overdue ? { background: 'rgba(239,68,68,0.04)' } : undefined}>
                    <td className="td-ctr mono fw-700" style={{ color: c, fontSize: 14 }}>
                      {d}d
                    </td>
                    <td className="td-code cyan">
                      {it.jcCode} <span style={{ color: 'var(--red)', fontWeight: 700 }}>Op{it.opSeq}</span>
                    </td>
                    <td style={{ fontSize: 12 }}>{it.operation}</td>
                    <td style={{ fontSize: 11, color: 'var(--purple)' }}>{it.itemCode ?? '—'}</td>
                    <td style={{ fontSize: 11, color: 'var(--cyan)' }}>{it.soCode ?? '—'}</td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--amber)', fontSize: 14 }}>
                      {it.qcPending}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ParetoTab({
  reasons,
}: {
  reasons: { reasonCategory: string; count: number; pct: number }[];
}): React.JSX.Element {
  return (
    <div className="panel">
      <div className="panel-hdr">
        <span className="panel-title">Top Rejection Reasons</span>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>Reason</th>
              <th style={{ textAlign: 'center' }}>Count</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {reasons.length === 0 ? (
              <tr>
                <td colSpan={3} className="empty-state">
                  No rejections recorded.
                </td>
              </tr>
            ) : (
              reasons.map((r) => (
                <tr key={r.reasonCategory}>
                  <td className="fw-700" style={{ fontSize: 12, textTransform: 'capitalize' }}>
                    {r.reasonCategory}
                  </td>
                  <td className="td-ctr mono fw-700" style={{ color: 'var(--red)' }}>
                    {r.count}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div
                        style={{
                          height: 14,
                          width: `${Math.max(r.pct, 2)}%`,
                          background: 'var(--red)',
                          borderRadius: 3,
                          minWidth: 4,
                        }}
                      />
                      <span className="text3" style={{ fontSize: 10 }}>
                        {r.pct}%
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
  );
}

function InspectorTab({
  perf,
}: {
  perf: {
    engineer: string;
    calls: number;
    acceptedQty: number;
    rejectedQty: number;
    ratePct: number | null;
    avgResponseDays: string | null;
  }[];
}): React.JSX.Element {
  return (
    <div className="panel">
      <div className="panel-hdr">
        <span className="panel-title">Inspector Performance — this month</span>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>Inspector</th>
              <th style={{ textAlign: 'center' }}>Calls</th>
              <th style={{ textAlign: 'center', color: 'var(--green)' }}>Accept</th>
              <th style={{ textAlign: 'center', color: 'var(--red)' }}>Reject</th>
              <th style={{ textAlign: 'center' }}>Rate</th>
              <th style={{ textAlign: 'center' }}>Avg Resp</th>
            </tr>
          </thead>
          <tbody>
            {perf.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  No QC logs this month.
                </td>
              </tr>
            ) : (
              perf.map((p) => (
                <tr key={p.engineer}>
                  <td className="fw-700">{p.engineer}</td>
                  <td className="td-ctr mono fw-700">{p.calls}</td>
                  <td className="td-ctr mono" style={{ color: 'var(--green)' }}>
                    {p.acceptedQty}
                  </td>
                  <td className="td-ctr mono" style={{ color: 'var(--red)' }}>
                    {p.rejectedQty}
                  </td>
                  <td className="td-ctr mono fw-700" style={{ color: rateColor(p.ratePct) }}>
                    {p.ratePct === null ? '—' : `${p.ratePct}%`}
                  </td>
                  <td className="td-ctr mono text3">
                    {p.avgResponseDays === null ? '—' : `${p.avgResponseDays}d`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NoteTab({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <div className="panel">
      <div className="panel-hdr">
        <span className="panel-title">{title}</span>
      </div>
      <div className="panel-body">
        <div className="text2" style={{ fontSize: 13, lineHeight: 1.6 }}>
          {body}
        </div>
      </div>
    </div>
  );
}
