// Design Project detail (Design slice C) — header + 4 tabs.
// Mirrors legacy _dpRenderDetail (HTML L7623) + sub-renderers.
//
// ADR-199 (table standard, 2026-10-01): this was the biggest file in the app at
// 2083 lines. It is now split — each tab, its modals and the shared bits live in
// ./components/* (every file < 400 lines) and each tab's DATA TABLE renders on
// the shared FIT table (DataTable + tableKey). This file is just the route, the
// project header and the tab switch.

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
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
  const tabs: Array<{ k: TabKey; label: string; badge: string }> = [
    { k: 'tasks', label: 'Tasks', badge: `${p.taskDone}/${p.taskTotal} completed` },
    {
      k: 'issues',
      label: 'Issues',
      badge: `${p.openIssuesCount}/${data.issues.length} open`,
    },
    { k: 'checklist', label: 'Checklist', badge: `${checkDone}/${CHECKLIST.length}` },
    { k: 'dcr', label: 'DCR/DCN', badge: `${data.dcrs.length}/${data.dcns.length}` },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <Link to="/design-projects" className="btn btn-ghost btn-sm">
          ← Back to Design Projects
        </Link>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{p.projectName}</div>
          <div className="text3" style={{ fontSize: 11 }}>
            {p.code} · {p.soCodeText ?? ''} · {p.clientText ?? ''} · Lead: {p.leadText ?? ''}
          </div>
        </div>
        <StatusBadge status={p.status} />
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button
            key={t.k}
            type="button"
            className={`btn btn-sm ${tab === t.k ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontWeight: 700 }}
            onClick={() => setTab(t.k)}
          >
            {t.label} ({t.badge})
          </button>
        ))}
      </div>

      {tab === 'tasks' ? <TasksTab detail={data} /> : null}
      {tab === 'issues' ? <IssuesTab detail={data} /> : null}
      {tab === 'checklist' ? <ChecklistTab detail={data} checkDone={checkDone} /> : null}
      {tab === 'dcr' ? <DcrDcnTab detail={data} /> : null}

      <RelatedDocsPanel module="design-projects" id={id} />
    </div>
  );
}
