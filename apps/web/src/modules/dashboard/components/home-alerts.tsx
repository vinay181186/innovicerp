// Classic Alerts view — mirror of legacy _homeAlertsView (L2878). Reuses the
// /alerts engine; groups visible alerts into a single table + a summary banner.

import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useAlerts } from '@/modules/alerts/api';
import { QuickLinks } from './quick-links';

// Map alert dept → the landing route for the row click.
const DEPT_NAV: Record<string, string> = {
  planning: '/planning',
  sales: '/sales-orders',
  store: '/store-inventory',
  design: '/bom-master',
  production: '/production-dashboard',
  qc: '/qc-dashboard',
  purchase: '/purchase-requests',
  finance: '/cost-centers',
  tasks: '/task-board',
};

export function HomeAlerts({ quickLinkPages }: { quickLinkPages: string[] }): React.JSX.Element {
  const { data, isLoading } = useAlerts();
  if (isLoading || !data) {
    return <div className="empty-state" style={{ padding: 40 }}><Loader2 className="inline h-4 w-4 animate-spin" /> Loading alerts…</div>;
  }
  const visible = data.alerts.filter((a) => a.count > 0);
  const total = visible.reduce((s, a) => s + a.count, 0);
  const depts = new Set(visible.map((a) => a.dept));

  return (
    <div>
      <div className="panel" style={{ padding: '12px 16px', marginBottom: 14 }}>
        <QuickLinks pages={quickLinkPages} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, padding: '10px 16px', background: total > 0 ? 'var(--sig-critical-bg)' : 'var(--sig-ok-bg)', border: `1px solid ${total > 0 ? 'var(--sig-critical-bd)' : 'var(--sig-ok-bd)'}`, borderRadius: 8 }}>
        <span style={{ fontSize: 22 }}>{total > 0 ? '🔔' : '✅'}</span>
        <div>
          <div style={{ fontWeight: 700, color: total > 0 ? 'var(--sig-critical)' : 'var(--sig-ok)' }}>{total} Pending Actions</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{visible.length} active alerts across {depts.size} departments</div>
        </div>
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr><th>Department</th><th>Code</th><th>Alert Name</th><th className="td-ctr">Records</th></tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={4} className="empty-state" style={{ color: 'var(--sig-ok)', fontWeight: 700 }}>✅ All clear! No pending actions.</td></tr>
              ) : (
                visible.map((a) => {
                  const urgent = a.name.toLowerCase().includes('overdue');
                  return (
                    <tr key={a.code}>
                      <td><Link to={DEPT_NAV[a.dept] ?? '/'} style={{ fontWeight: 700, fontSize: 12, color: 'var(--cyan)', textDecoration: 'none' }}>{a.dept}</Link></td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{a.code}</td>
                      <td style={{ fontWeight: 600 }}>{a.name}</td>
                      <td className="td-ctr"><span className="mono fw-700" style={{ fontSize: 16, color: urgent ? 'var(--sig-critical)' : 'var(--sig-warn)' }}>{a.count}</span></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
