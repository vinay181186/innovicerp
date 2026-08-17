// Admin/Manager home — mirror of legacy _homeAdminView (L2560). Headline KPIs,
// Today snapshot, Needs Attention, Quick Access.

import type { HomeResponse } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { StatStrip } from '@/components/shared/stat-strip';
import { QuickLinks } from './quick-links';

function StatRow({
  icon,
  label,
  value,
  navPage,
}: {
  icon: string;
  label: string;
  value: number;
  navPage: string;
}): React.JSX.Element {
  return (
    <Link to={navPage} className="dash-link">
      <div
        className="dash-surface"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 10px',
          background: 'var(--bg3)',
          border: '1px solid transparent',
          borderRadius: 6,
        }}
      >
        {/* Decorative: the label beside it already says what this is, so a screen
            reader announcing the emoji name would only add noise. */}
        <span aria-hidden="true" style={{ fontSize: 16 }}>
          {icon}
        </span>
        <div style={{ flex: 1, fontSize: 12, color: 'var(--text2)' }}>{label}</div>
        <div
          style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--mono)', color: 'var(--text)' }}
        >
          {value}
        </div>
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
      {/* Headline KPIs — ONE strip, per the `styling` skill Rule 3. These were
          four floating cards, each with its own border, radius and 4px coloured
          left edge, in a flex row ~90px tall. */}
      <StatStrip
        items={[
          {
            key: 'so',
            label: 'Active SOs',
            count: k.activeSOs,
            color: 'var(--sig-info)',
            to: '/so-overview',
            sub:
              k.overdueSOs > 0 ? (
                <span style={{ color: 'var(--sig-critical)', fontWeight: 700 }}>
                  {k.overdueSOs} overdue
                </span>
              ) : (
                'All on track'
              ),
          },
          {
            key: 'jc',
            label: 'Open Job Cards',
            count: k.openJCs,
            color: 'var(--dept-production)',
            to: '/job-cards',
            sub:
              k.overdueJCs > 0 ? (
                <span style={{ color: 'var(--sig-critical)', fontWeight: 700 }}>
                  {k.overdueJCs} overdue
                </span>
              ) : (
                'Healthy'
              ),
          },
          {
            key: 'mach',
            label: 'Machines Running',
            count: `${k.machsRunning}/${k.machsTotal}`,
            color: 'var(--dept-production)',
            to: '/production-dashboard',
            sub:
              k.machsTotal > 0
                ? `${Math.round((k.machsRunning / k.machsTotal) * 100)}% utilization`
                : 'No machines',
          },
          {
            key: 'output',
            label: "Today's Output",
            count: `${k.todayOutputQty} pcs`,
            color: 'var(--sig-ok)',
            to: '/op-entry',
            sub: 'Completed across all ops',
          },
        ]}
      />

      {/* Today + Needs Attention. auto-fit, not a hard '1fr 1fr': at 900px the
          fixed pair gave each panel ~440px, and the nested Today grid inside it
          then split that again — four stat rows at ~200px each on a laptop and
          ~80px on a phone, where an 18px mono number sat on top of its own label. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 14,
          marginBottom: 14,
        }}
      >
        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-hdr">
            <h2 className="panel-title">Today</h2>
          </div>
          <div
            style={{
              padding: '12px 16px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 10,
            }}
          >
            <StatRow
              icon="📥"
              label="GRNs received"
              value={t.grnReceived}
              navPage="/goods-receipt-notes"
            />
            <StatRow
              icon="🚚"
              label="Dispatches"
              value={t.dispatches}
              navPage="/customer-dispatches"
            />
            <StatRow
              icon="▶"
              label="Ops running"
              value={t.opsRunning}
              navPage="/production-dashboard"
            />
            <StatRow icon="✅" label="Ops completed" value={t.opsCompleted} navPage="/op-entry" />
          </div>
        </div>

        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-hdr">
            <h2 className="panel-title">Needs Attention</h2>
          </div>
          <div style={{ padding: '10px 16px' }}>
            {attn.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: 20,
                  color: 'var(--sig-ok)',
                  fontWeight: 700,
                }}
              >
                ✅ All clear — nothing needs attention.
              </div>
            ) : (
              attn.map((it, i) => (
                <Link key={i} to={it.navPage} className="dash-link">
                  <div
                    className="dash-surface"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 6px',
                      borderBottom: '1px solid var(--border)',
                      borderRadius: 4,
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: 14 }}>
                      {it.icon}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: 13,
                        fontWeight: 600,
                        color:
                          it.severity === 'critical'
                            ? 'var(--sig-critical)'
                            : it.severity === 'warn'
                              ? 'var(--sig-warn)'
                              : 'var(--sig-info)',
                      }}
                    >
                      {it.label}
                    </span>
                    <span aria-hidden="true" style={{ color: 'var(--text3)', fontSize: 11 }}>
                      View →
                    </span>
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
