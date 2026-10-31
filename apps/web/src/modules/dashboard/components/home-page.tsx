// ADR-264 — the home: ONE board, a left menu and a content area (owner design
// 2026-10-31). The server sends only what the caller may see (departments,
// checks, approvals); this file lays it out and keeps the chosen view in the
// URL. Replaces the ADR-250 layout (Widgets / Customize modes, headline + cue
// strip, Waiting on others, Sent by me, Shortcuts, the right column).

import { useEffect } from 'react';
import { useCanOpen } from '@/components/shared/action-link';
import { useMyAccess } from '@/lib/access-control';
import { useWaitingApprovals } from '@/modules/approvals/api';
import { PageState } from '@/ui/layout';
import { useDashChecks, useHome } from '../api';
import '../home-rows.css';
import '../home.css';
import { DAY_LOG_HREF, type HomeView, isDeptView } from '../home-views';
import '../notifications.css';
import { ApprovalsView } from './approvals-view';
import { DayLogView } from './daylog-view';
import { DeptView } from './dept-view';
import { deptLabel, HomeMenu, type MenuItem } from './home-menu';
import { NotificationsView } from './notifications-view';
import { TodoView } from './todo-view';

function LoadState({ error }: { error: boolean }): React.JSX.Element {
  return error ? (
    <PageState state="error" message="Could not load the dashboard. Try again." />
  ) : (
    <PageState state="loading" />
  );
}

export function HomePage({
  view,
  onView,
}: {
  view: HomeView;
  onView: (v: HomeView, replace?: boolean) => void;
}): React.JSX.Element {
  const home = useHome();
  const checks = useDashChecks();
  const access = useMyAccess();
  const canOpen = useCanOpen();
  // ADR-265 — the same query as the Approvals page and the top-menu badge.
  const waiting = useWaitingApprovals();

  const accessKnown = access.data !== undefined || access.isError;
  // A failed access read: show it rather than hide it — the server still judges.
  const canDayLog = access.isError || canOpen(DAY_LOG_HREF);
  const h = home.data;
  const blocks = checks.data?.depts ?? [];
  const block = isDeptView(view) ? blocks.find((b) => b.dept === view) : undefined;

  // A view this person does not have (hidden Day Log, a department the server
  // did not send) falls back to My to-do — replace, so Back skips it.
  const hiddenDayLog = view === 'daylog' && accessKnown && !canDayLog;
  const hiddenDept = isDeptView(view) && checks.data !== undefined && !block;
  useEffect(() => {
    if (hiddenDayLog || hiddenDept) onView('todo', true);
  }, [hiddenDayLog, hiddenDept, onView]);

  const showApprovals = waiting.data?.canApprove === true;
  const top: MenuItem[] = [
    {
      view: 'todo',
      label: 'My to-do',
      badge: h ? h.todo.late.length + h.todo.today.length : undefined,
    },
    ...(canDayLog ? [{ view: 'daylog' as const, label: 'Day Log' }] : []),
    ...(showApprovals || view === 'approvals'
      ? [
          {
            view: 'approvals' as const,
            label: 'Approvals',
            badge: waiting.data?.total,
          },
        ]
      : []),
  ];

  let content: React.ReactNode;
  if (view === 'daylog') {
    content = canDayLog ? <DayLogView /> : <LoadState error={false} />;
  } else if (view === 'notifications') {
    content = <NotificationsView />;
  } else if (isDeptView(view)) {
    content = block ? (
      <DeptView block={block} label={deptLabel(block.dept)} />
    ) : (
      <LoadState error={checks.isError} />
    );
  } else if (view === 'approvals') {
    content = <ApprovalsView />;
  } else if (!h) {
    content = <LoadState error={home.isError} />;
  } else {
    content = <TodoView home={h} />;
  }

  return (
    <div className="dh">
      <div className="dh-board">
        <HomeMenu
          top={top}
          depts={blocks}
          deptsState={checks.data ? 'ok' : checks.isError ? 'error' : 'loading'}
          current={view}
          onView={(v) => onView(v)}
        />
        <section className="dh-main" aria-label="Dashboard content">
          {content}
        </section>
      </div>
    </div>
  );
}
