// Design Work Log (Design slice E) — engineer timesheet feed.
// Mirrors legacy renderDesignWorkLog (HTML L7935) with 5 tabs.
//
// ADR-203 (frozen header, 2026-10-02): each tab shows ONE table that fills the
// rest of the screen (`page-fill` + `<Panel fill>`, ADR-202) with a column
// header that never scrolls away; everything above it (StatStrip, the entry
// form, date / week navigators, tiles, sub-tabs) is fixed chrome. The active
// tab lives in the URL `tab` (Alerts' sub-tab in `alert`), so Refresh / Back
// keep it. The tabs live in ../components (this file was 1122 lines).

import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListHeader } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation/TabStrip';
import { ALERT_TABS, AlertsTab } from '../components/alerts-tab';
import { DailyTab } from '../components/daily-tab';
import { EntryTab } from '../components/entry-tab';
import { ProjectTab } from '../components/project-tab';
import { WeeklyTab } from '../components/weekly-tab';

const TAB_KEYS = ['entry', 'daily', 'weekly', 'project', 'alerts'] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'entry', label: 'My Log' },
  { key: 'daily', label: 'Daily View' },
  { key: 'weekly', label: 'Weekly View' },
  { key: 'project', label: 'Project Hours' },
  { key: 'alerts', label: 'Alerts' },
];

const searchSchema = z.object({
  /** Active tab; absent = My Log. */
  tab: z.enum(TAB_KEYS).optional(),
  /** Alerts sub-tab; absent = Unlogged Days. */
  alert: z.enum(ALERT_TABS).optional(),
});

export const designWorkLogListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'design-work-log',
  validateSearch: searchSchema,
  component: DesignWorkLogPage,
});

function DesignWorkLogPage(): React.JSX.Element {
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dsnworklog_create');
  const search = designWorkLogListRoute.useSearch();
  const navigate = designWorkLogListRoute.useNavigate();
  const tab: TabKey = search.tab ?? 'entry';
  const alertTab = search.alert ?? 'unlogged';

  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Design Work Log. Ask an admin.
      </div>
    );
  }

  const setTab = (k: string): void => {
    const next = TAB_KEYS.find((t) => t === k);
    void navigate({
      search: (prev) => ({ ...prev, tab: next === 'entry' ? undefined : next }),
      replace: true,
    });
  };

  return (
    <div className="page-fill">
      <ListHeader title="Design Work Log" icon="⏱" />
      <TabStrip label="Design Work Log views" activeKey={tab} onChange={setTab} tabs={TABS} />

      {tab === 'entry' ? <EntryTab /> : null}
      {tab === 'daily' ? <DailyTab /> : null}
      {tab === 'weekly' ? <WeeklyTab /> : null}
      {tab === 'project' ? <ProjectTab /> : null}
      {tab === 'alerts' ? (
        <AlertsTab
          sub={alertTab}
          onSub={(k) =>
            void navigate({
              search: (prev) => ({ ...prev, alert: k === 'unlogged' ? undefined : k }),
              replace: true,
            })
          }
        />
      ) : null}
    </div>
  );
}
