// Widgets view — mirror of legacy _dashWidgetView (L3313). Renders the
// server-computed widget cards in the user's saved order. my_alerts +
// quick_links are composed client-side.

import type { WidgetData } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useAlerts } from '@/modules/alerts/api';
import { useWidgets } from '../api';
import { QuickLinks } from './quick-links';

function toneColor(t: string | null): string {
  switch (t) {
    case 'red': return 'var(--red)';
    case 'green': return 'var(--green)';
    case 'amber': return 'var(--amber)';
    case 'cyan': return 'var(--cyan)';
    case 'blue': return 'var(--blue, #2563EB)';
    default: return 'var(--text)';
  }
}

function WidgetBody({ w }: { w: WidgetData }): React.JSX.Element {
  const hasContent = w.stats.length || w.bars.length || w.rows.length;
  return (
    <>
      <div style={{ fontSize: 12, fontWeight: 700, color: w.color, marginBottom: 8 }}>{w.icon} {w.label}</div>
      {w.stats.length ? (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {w.stats.map((s, i) => (
            <div key={i}>
              <div className="mono fw-700" style={{ fontSize: 22, color: toneColor(s.tone) }}>{s.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      ) : null}
      {w.bars.length ? (
        <div>
          {w.bars.map((b, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 10, width: 70, color: 'var(--cyan)', fontWeight: 600 }}>{b.label}</span>
              <div style={{ flex: 1, height: 8, background: 'var(--bg5, var(--bg4))', borderRadius: 4 }}>
                <div style={{ width: `${b.pct}%`, height: '100%', background: toneColor(b.tone), borderRadius: 4 }} />
              </div>
              <span className="mono" style={{ fontSize: 10, width: 30, textAlign: 'right' }}>{b.pct}%</span>
            </div>
          ))}
        </div>
      ) : null}
      {w.rows.length ? (
        <div>
          {w.rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11, borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>{r.left}</span>
              <span className="mono">{r.mid}</span>
              <span>{r.right}</span>
            </div>
          ))}
        </div>
      ) : null}
      {!hasContent && w.emptyText ? <div style={{ fontSize: 12, color: 'var(--text3)' }}>{w.emptyText}</div> : null}
    </>
  );
}

function AlertsWidget(): React.JSX.Element {
  const { data } = useAlerts();
  const visible = (data?.alerts ?? []).filter((a) => a.count > 0);
  const total = visible.reduce((s, a) => s + a.count, 0);
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: total > 0 ? 'var(--red)' : 'var(--green)', marginBottom: 8 }}>
        🔔 Alerts {total > 0 ? <span className="mono" style={{ fontSize: 16, marginLeft: 6 }}>{total}</span> : null}
      </div>
      {visible.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--green)' }}>✅ All clear! No pending alerts.</div>
      ) : (
        visible.slice(0, 8).map((a) => (
          <div key={a.code} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11, borderBottom: '1px solid var(--border)' }}>
            <span>{a.name}</span>
            <span className="mono fw-700" style={{ color: 'var(--red)' }}>{a.count}</span>
          </div>
        ))
      )}
    </div>
  );
}

export function HomeWidgets({ quickLinkPages }: { quickLinkPages: string[] }): React.JSX.Element {
  const { data, isLoading } = useWidgets();
  if (isLoading || !data) {
    return <div className="empty-state" style={{ padding: 40 }}><Loader2 className="inline h-4 w-4 animate-spin" /> Loading widgets…</div>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
      {data.widgets.map((w) => {
        const cardStyle: React.CSSProperties = {
          background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, borderTop: `3px solid ${w.color}`,
        };
        if (w.key === 'quick_links') {
          return <div key={w.key} style={{ ...cardStyle, gridColumn: '1 / -1' }}><QuickLinks pages={quickLinkPages} /></div>;
        }
        if (w.key === 'my_alerts') {
          return <div key={w.key} style={cardStyle}><AlertsWidget /></div>;
        }
        return (
          <Link key={w.key} to={w.navPage} style={{ ...cardStyle, cursor: 'pointer', textDecoration: 'none', color: 'var(--text)' }}>
            <WidgetBody w={w} />
          </Link>
        );
      })}
    </div>
  );
}
