// ADR-250 — the home's right column: Notifications, My to-do, Done, Shortcuts.

import type { DashTodoRow, HomeResponse } from '@innovic/shared';
import { useState } from 'react';
import { fmtDate, fmtDateTime, fmtTime, todayIst } from '@/lib/date';
import { DashTextView, DocRef } from './dash-text';
import { Empty, HomePanel, HomeTabs } from './home-panel';
import { QuickLinks } from './quick-links';

/** Today's notes show the clock time; older ones the date as well. */
function noteWhen(ts: string): string {
  return fmtDate(ts) === fmtDate(todayIst()) ? fmtTime(ts) : fmtDateTime(ts);
}

export function NotificationsPanel({
  notes,
  panelRef,
}: {
  notes: HomeResponse['notifications'];
  panelRef: React.Ref<HTMLElement>;
}): React.JSX.Element {
  return (
    <HomePanel title="Notifications" count={notes.unseen} panelRef={panelRef}>
      {notes.items.length === 0 ? (
        <Empty text="No new notifications." />
      ) : (
        notes.items.map((n) => (
          <div key={n.key} className={`dh-li${n.unseen ? ' dh-unseen' : ''}`}>
            <span className={`dh-dot t-${n.tone}`} />
            <span>
              <DashTextView text={n.text} />
            </span>
            <span className="dh-tm">{noteWhen(n.ts)}</span>
          </div>
        ))
      )}
    </HomePanel>
  );
}

type TodoTab = 'late' | 'today' | 'planned';
const TODO_TONE: Record<TodoTab, string> = { late: 't-late', today: 't-due', planned: 't-ok' };
const TODO_EMPTY: Record<TodoTab, string> = {
  late: 'Nothing late.',
  today: 'Nothing today.',
  planned: 'Nothing planned.',
};

function TodoLine({ t, tab }: { t: DashTodoRow; tab: TodoTab }): React.JSX.Element {
  return (
    <div className={`dh-li${t.unread ? ' dh-unseen' : ''}`}>
      <span className={`dh-dot ${TODO_TONE[tab]}`} />
      <span className="dh-todo" title={t.title}>
        <span className="dh-mut">{t.taskCode}</span> {t.title}
        {t.ref ? (
          <>
            {' · '}
            <DocRef code={t.ref.code} href={t.ref.href} />
          </>
        ) : null}
      </span>
      <span className="dh-tm">{t.dueDate ? fmtDate(t.dueDate) : ''}</span>
    </div>
  );
}

export function TodoPanel({ todo }: { todo: HomeResponse['todo'] }): React.JSX.Element {
  // Open on the first tab with something in it.
  const [tab, setTab] = useState<TodoTab>(
    todo.late.length > 0
      ? 'late'
      : todo.today.length > 0
        ? 'today'
        : todo.planned.length > 0
          ? 'planned'
          : 'today',
  );
  const rows = todo[tab];
  return (
    <HomePanel
      title="My to-do"
      right={
        <HomeTabs
          tabs={[
            { key: 'late', label: `Late (${todo.late.length})` },
            { key: 'today', label: `Today (${todo.today.length})` },
            { key: 'planned', label: `Planned (${todo.planned.length})` },
          ]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      {rows.length === 0 ? (
        <Empty text={TODO_EMPTY[tab]} />
      ) : (
        rows.map((t) => <TodoLine key={t.taskId} t={t} tab={tab} />)
      )}
    </HomePanel>
  );
}

export function DonePanel({ done }: { done: HomeResponse['done'] }): React.JSX.Element {
  const [day, setDay] = useState<'today' | 'yesterday'>('today');
  const rows = done[day];
  return (
    <HomePanel
      title="Done"
      right={
        <HomeTabs
          tabs={[
            { key: 'today', label: `Today (${done.todayTotal})` },
            { key: 'yesterday', label: `Yesterday (${done.yesterdayTotal})` },
          ]}
          value={day}
          onChange={setDay}
        />
      }
    >
      {rows.length === 0 ? (
        <Empty text={day === 'today' ? 'Nothing yet today.' : 'Nothing yesterday.'} />
      ) : (
        rows.map((d, i) => (
          <div key={`${d.ts}-${i}`} className="dh-li">
            <span className="dh-tm">{fmtTime(d.ts)}</span>
            <span>
              <DashTextView text={d.text} />
            </span>
            <span />
          </div>
        ))
      )}
    </HomePanel>
  );
}

export function ShortcutsPanel({ pages }: { pages: string[] }): React.JSX.Element {
  return (
    <HomePanel title="Shortcuts">
      <div className="dh-sc">
        <QuickLinks pages={pages} hideTitle />
      </div>
    </HomePanel>
  );
}
