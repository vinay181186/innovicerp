// Admin/Manager home — mirror of legacy _homeAdminView (L2560). Headline KPIs,
// Today snapshot, Needs Attention, Quick Access.

import type { HomeResponse } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { KpiCard } from './kpi-card';
import { QuickLinks } from './quick-links';

function StatRow({ icon, label, value, navPage }: { icon: string; label: string; value: number; navPage: string }): React.JSX.Element {
  return (
    <Link to={navPage} style={{ textDecoration: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 6, cursor: 'pointer' }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <div style={{ flex: 1, fontSize: 12, color: 'var(--text2)' }}>{label}</div>
        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--mono)', color: 'var(--text)' }}>{value}</div>
      </div>
    </Link>
  );
}

export function HomeAdmin({ home }: { home: HomeResponse }): React.JSX.Element {
  const k = home.kpis!;
  const t = home.today!;
  const attn = home.needsAttention ?? [];
  return (
    <div>
      {/* Headline KPIs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <KpiCard label="Active SOs" value={k.activeSOs} color="var(--sig-info)" navPage="/so-overview"
          sub={k.overdueSOs > 0 ? <span style={{ color: 'var(--sig-critical)' }}><b>{k.overdueSOs} overdue</b></span> : 'All on track'} />
        <KpiCard label="Open Job Cards" value={k.openJCs} color="var(--dept-production)" navPage="/job-cards"
          sub={k.overdueJCs > 0 ? <span style={{ color: 'var(--sig-critical)' }}><b>{k.overdueJCs} overdue</b></span> : 'Healthy'} />
        <KpiCard label="Machines Running" value={`${k.machsRunning}/${k.machsTotal}`} color="var(--dept-production)" navPage="/production-dashboard"
          sub={k.machsTotal > 0 ? `${Math.round((k.machsRunning / k.machsTotal) * 100)}% utilization` : 'No machines'} />
        <KpiCard label="Today's Output" value={`${k.todayOutputQty} pcs`} color="var(--sig-ok)" navPage="/op-entry" sub="Completed across all ops" />
      </div>

      {/* Today + Needs Attention */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-hdr"><span className="panel-title">Today</span></div>
          <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <StatRow icon="📥" label="GRNs received" value={t.grnReceived} navPage="/goods-receipt-notes" />
            <StatRow icon="🚚" label="Dispatches" value={t.dispatches} navPage="/customer-dispatches" />
            <StatRow icon="▶" label="Ops running" value={t.opsRunning} navPage="/production-dashboard" />
            <StatRow icon="✅" label="Ops completed" value={t.opsCompleted} navPage="/op-entry" />
          </div>
        </div>

        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-hdr"><span className="panel-title">Needs Attention</span></div>
          <div style={{ padding: '10px 16px' }}>
            {attn.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--sig-ok)', fontWeight: 700 }}>
                ✅ All clear — nothing needs attention.
              </div>
            ) : (
              attn.map((it, i) => (
                <Link key={i} to={it.navPage} style={{ textDecoration: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                    <span style={{ fontSize: 14 }}>{it.icon}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: it.severity === 'critical' ? 'var(--sig-critical)' : it.severity === 'warn' ? 'var(--sig-warn)' : 'var(--sig-info)' }}>
                      {it.label}
                    </span>
                    <span style={{ color: 'var(--text3)', fontSize: 11 }}>View →</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Quick Access */}
      <div className="panel" style={{ padding: '12px 16px' }}>
        <QuickLinks pages={home.quickLinks} />
      </div>
    </div>
  );
}
