// ADR-262 — the home's left menu: My to-do · Day Log · Approvals, then
// "Departments" and one item per department the server sent (badge = the
// department's total). Stacks above the content on a phone (home.css).

import { ACCESS_DEPTS, type DashCheckDeptBlock } from '@innovic/shared';
import type { HomeView } from '../home-views';

export interface MenuItem {
  view: HomeView;
  label: string;
  badge?: number | undefined;
}

export function deptLabel(dept: string): string {
  return ACCESS_DEPTS.find((d) => d.key === dept)?.label ?? dept;
}

function Item({
  item,
  current,
  onView,
}: {
  item: MenuItem;
  current: HomeView;
  onView: (v: HomeView) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="dh-mi"
      aria-current={current === item.view ? 'page' : undefined}
      onClick={() => onView(item.view)}
    >
      <span>{item.label}</span>
      {item.badge != null && item.badge > 0 ? (
        <span className="dh-mbadge">{item.badge}</span>
      ) : null}
    </button>
  );
}

export function HomeMenu({
  top,
  depts,
  deptsState,
  current,
  onView,
}: {
  top: MenuItem[];
  depts: DashCheckDeptBlock[];
  /** 'error' / 'loading' are said in the menu, so a failed read never looks
   *  like "no departments". */
  deptsState: 'ok' | 'loading' | 'error';
  current: HomeView;
  onView: (v: HomeView) => void;
}): React.JSX.Element {
  return (
    <nav className="dh-menu" aria-label="Dashboard menu">
      {top.map((m) => (
        <Item key={m.view} item={m} current={current} onView={onView} />
      ))}
      {deptsState !== 'ok' || depts.length > 0 ? <div className="dh-mhead">Departments</div> : null}
      {deptsState === 'loading' ? <div className="dh-mhead">⟳ Loading…</div> : null}
      {deptsState === 'error' ? (
        <div className="dh-mhead" style={{ color: 'var(--red2)' }}>
          Could not load departments.
        </div>
      ) : null}
      {depts.map((b) => (
        <Item
          key={b.dept}
          item={{ view: b.dept, label: deptLabel(b.dept), badge: b.total }}
          current={current}
          onView={onView}
        />
      ))}
    </nav>
  );
}
