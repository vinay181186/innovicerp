// Quick Access links — mirror of legacy _renderQuickLinks (L3380). Renders the
// colored chip row from the registry, filtered to the page keys the home
// payload says are visible (access + user selection).

import { DASHBOARD_QUICK_LINKS } from '@innovic/shared';
import { Link } from '@tanstack/react-router';

export function QuickLinks({ pages }: { pages: string[] }): React.JSX.Element {
  const set = new Set(pages);
  const links = DASHBOARD_QUICK_LINKS.filter((l) => set.has(l.page));
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>🚀 Quick Access</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {links.map((l) => (
          <Link
            key={l.page}
            to={l.page}
            className="btn btn-sm"
            style={{ background: `${l.color}12`, color: l.color, border: `1px solid ${l.color}40`, fontSize: 11, padding: '5px 10px' }}
          >
            {l.icon} {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
