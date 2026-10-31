// ADR-264 — the home's left menu: My to-do · Day Log · Approvals, then
// "Departments" and one item per department the server sent (badge = the
// department's total). Stacks above the content on a phone (home.css).

import { ACCESS_DEPTS, type DashCheckDeptBlock } from '@innovic/shared';
import { SECTIONS } from '@/components/shared/nav-sections';
import { DAY_LOG_HREF, type HomeView, isDeptView } from '../home-views';

export interface MenuItem {
  view: HomeView;
  label: string;
  badge?: number | undefined;
}

export function deptLabel(dept: string): string {
  return ACCESS_DEPTS.find((d) => d.key === dept)?.label ?? dept;
}

const NAV_ITEMS = SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items));

/** The icon the top menu already shows for the same place (nav-sections.ts —
 *  one list, so the home menu and the header never disagree). */
function viewIcon(view: HomeView): string | undefined {
  if (isDeptView(view)) return SECTIONS.find((s) => s.key === view)?.icon;
  if (view === 'todo') return SECTIONS.find((s) => s.key === 'tasks')?.icon;
  if (view === 'daylog')
    return NAV_ITEMS.find((i) => `${i.to}?view=${i.search?.view ?? ''}` === DAY_LOG_HREF)?.icon;
  if (view === 'approvals') return NAV_ITEMS.find((i) => i.to === '/approvals')?.icon;
  return undefined;
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
      <span className="dh-mi-icon" aria-hidden>
        {viewIcon(item.view)}
      </span>
      <span className="dh-mi-label">{item.label}</span>
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
