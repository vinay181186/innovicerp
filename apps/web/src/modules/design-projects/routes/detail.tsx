// Design Project detail (Design slice C) — header + 4 tabs.
// Mirrors legacy _dpRenderDetail (HTML L7623) + sub-renderers.
//
// ADR-199 (table standard, 2026-10-01): this was the biggest file in the app at
// 2083 lines. It is now split — each tab, its modals and the shared bits live in
// ./components/* (every file < 400 lines) and each tab's DATA TABLE renders on
// the shared FIT table (DataTable + tableKey). This file is just the route, the
// project header and the tab switch.
//
// 2026-11-04 (owner): DetailHeader + ClusterGrid facts + the shared TabStrip +
// Related Documents as tabs. Tabs, their counts and their data are unchanged.

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { RelatedDocsTabs } from '@/components/shared/related-docs-tabs';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { soNoWithInternal } from '@/lib/so-number';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Cluster, ClusterFact, ClusterGrid } from '@/ui/forms';
import { DetailHeader } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
import { useDesignProjectDetail } from '../api';
import { ChecklistTab } from '../components/checklist-tab';
import { CHECKLIST, isChecked } from '../components/checklist-data';
import { DcrDcnTab } from '../components/dcr-dcn-tab';
import { StatusBadge } from '../components/detail-shared';
import { IssuesTab } from '../components/issues-tab';
import { TasksTab } from '../components/tasks-tab';

type TabKey = 'tasks' | 'issues' | 'checklist' | 'dcr';

export const designProjectDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'design-projects/$id',
  component: DesignProjectDetailPage,
});

function DesignProjectDetailPage(): React.JSX.Element {
  const { id } = designProjectDetailRoute.useParams();
  const { data, isLoading, isError, error } = useDesignProjectDetail(id);
  const [tab, setTab] = useState<TabKey>('tasks');
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dsnproj_create');

  // "Hide page": a user whose VIEW was removed for Design Projects sees the
  // no-access panel, not the detail page.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Design Projects. Ask an admin.
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div>
        <Link to="/design-projects" className="btn btn-ghost btn-sm">
          ← Back to Design Projects
        </Link>
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="panel-body">
            {isError ? (
              <div className="empty-state" style={{ color: 'var(--red2)' }}>
                {error instanceof Error
                  ? error.message
                  : 'Could not load design project. Try again.'}
              </div>
            ) : (
              <div className="text3" style={{ fontSize: 12 }}>
                <Loader2 size={14} className="inline animate-spin" /> Loading…
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const p = data.project;
  const checkDone = CHECKLIST.filter((c) => isChecked(data, c.key)).length;
  // The tab badges carry the counts (no separate tiles): Tasks completed/total,
  // Issues open/total.
  const tabs = [
    { key: 'tasks', label: 'Tasks', note: `${p.taskDone}/${p.taskTotal} completed` },
    {
      key: 'issues',
      label: 'Issues',
      note: `${p.openIssuesCount}/${data.issues.length} open`,
    },
    { key: 'checklist', label: 'Checklist', note: `${checkDone}/${CHECKLIST.length}` },
    { key: 'dcr', label: 'DCR/DCN', note: `${data.dcrs.length}/${data.dcns.length}` },
  ];

  return (
    <div>
      <DetailHeader
        backLabel="Back to Design Projects"
        backTo="/design-projects"
        renderLink={(l) => <Link {...l} />}
        code={p.code}
        name={p.projectName}
        badges={<StatusBadge status={p.status} />}
      >
        <ClusterGrid stack>
          <Cluster name="Project">
            <ClusterFact
              num
              label="SO No."
              empty={!p.soCodeText}
              value={p.soCodeText ? soNoWithInternal(p.soCodeText, p.soInternalNo) : '—'}
            />
            <ClusterFact
              label="Customer"
              empty={!p.clientText}
              title={p.clientText ?? undefined}
              value={p.clientText ?? '—'}
            />
            <ClusterFact
              span={2}
              label="Lead"
              empty={!p.leadText}
              title={p.leadText ?? undefined}
              value={p.leadText ?? '—'}
            />
          </Cluster>
        </ClusterGrid>
      </DetailHeader>

      <TabStrip
        label="Design Project lists"
        activeKey={tab}
        onChange={(k) => setTab(k as TabKey)}
        tabs={tabs}
      />

      {tab === 'tasks' ? <TasksTab detail={data} /> : null}
      {tab === 'issues' ? <IssuesTab detail={data} /> : null}
      {tab === 'checklist' ? <ChecklistTab detail={data} checkDone={checkDone} /> : null}
      {tab === 'dcr' ? <DcrDcnTab detail={data} /> : null}

      <RelatedDocsTabs module="design-projects" id={id} />
    </div>
  );
}
