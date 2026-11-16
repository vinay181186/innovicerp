// ADR-264 — My to-do: tabs Late · Today · Planned · Done. No tick box (owner
// 2026-11-16: one click must not complete a to-do): the to-do number opens the
// task's detail on the Task Board (`?task=<id>`), where ✅ Complete lives with
// its own rights and checks. Done = today's done list, yesterday's under it.
// "Create to-do" opens the inline form.

import type { DashTodoRow, HomeResponse } from '@innovic/shared';
import { useState } from 'react';
import { useCanWrite } from '@/components/shared/action-link';
import { fmtDate, fmtTime } from '@/lib/date';
import { EmptyState } from '@/ui/data';
import { DashTextView, DocRef } from './dash-text';
import { TodoCreate } from './todo-create';
import { ViewHead } from './view-head';
import { TabStrip } from '@/ui/navigation';

type Tab = 'late' | 'today' | 'planned' | 'done';
const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'late', label: 'Late' },
  { key: 'today', label: 'Today' },
  { key: 'planned', label: 'Planned' },
  { key: 'done', label: 'Done' },
];
const DUE_TONE: Record<Exclude<Tab, 'done'>, string> = {
  late: 't-late',
  today: 't-due',
  planned: '',
};
const EMPTY: Record<Tab, string> = {
  late: 'Nothing late.',
  today: 'Nothing due today.',
  planned: 'Nothing planned.',
  done: 'Nothing done yet today.',
};

function TodoLine({ t, tab }: { t: DashTodoRow; tab: Exclude<Tab, 'done'> }): React.JSX.Element {
  return (
    <div className={`dh-todo${t.unread ? ' dh-unread' : ''}`}>
      <span className="dh-todo-code">
        <DocRef code={t.taskCode} href={`/task-board?task=${t.taskId}`} />
      </span>
      <span className="dh-todo-title" title={t.title}>
        {t.title}
        {t.ref ? (
          <>
            {' · '}
            <span className="dh-doc">
              <DocRef code={t.ref.code} href={t.ref.href} />
            </span>
          </>
        ) : null}
      </span>
      <span className={`dh-due ${DUE_TONE[tab]}`}>{t.dueDate ? fmtDate(t.dueDate) : ''}</span>
    </div>
  );
}

function DoneLines({ done }: { done: HomeResponse['done'] }): React.JSX.Element {
  const line = (d: HomeResponse['done']['today'][number], i: number): React.JSX.Element => (
    <div key={`${d.ts}-${i}`} className="dh-todo">
      <span className="dh-todo-code">{fmtTime(d.ts)}</span>
      <span className="dh-todo-title">
        <DashTextView text={d.text} />
      </span>
    </div>
  );
  return (
    <>
      {done.today.length === 0 ? (
        <div className="dh-emptytab">{EMPTY.done}</div>
      ) : (
        done.today.map(line)
      )}
      {done.yesterday.length > 0 ? (
        <>
          <div className="dh-dayhead">Yesterday ({done.yesterdayTotal})</div>
          {done.yesterday.map(line)}
        </>
      ) : null}
    </>
  );
}

export function TodoView({ home }: { home: HomeResponse }): React.JSX.Element {
  const { todo, done } = home;
  const canWrite = useCanWrite();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<Tab>(
    todo.late.length > 0
      ? 'late'
      : todo.today.length > 0
        ? 'today'
        : todo.planned.length > 0
          ? 'planned'
          : 'today',
  );

  const none = todo.late.length + todo.today.length + todo.planned.length === 0;
  const count = (k: Tab): number => (k === 'done' ? done.todayTotal : todo[k].length);

  const openCreate = canWrite ? () => setCreating(true) : undefined;

  let body: React.ReactNode;
  if (tab === 'done') body = <DoneLines done={done} />;
  else if (none && !creating) {
    body = (
      <EmptyState icon="☑">
        <div style={{ fontWeight: 700 }}>No to-dos yet.</div>
        <div>Write down what you must do today, or give a task to someone in your team.</div>
        {openCreate ? (
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 'var(--sp-2)' }}
            onClick={openCreate}
          >
            + Create to-do
          </button>
        ) : null}
      </EmptyState>
    );
  } else if (todo[tab].length === 0) {
    // The header's "+ Create to-do" stays visible here — one control per label.
    body = <div className="dh-emptytab">{EMPTY[tab]}</div>;
  } else {
    const rowsTab = tab;
    body = todo[rowsTab].map((t) => <TodoLine key={t.taskId} t={t} tab={rowsTab} />);
  }

  return (
    <>
      <ViewHead title="My to-do" hint="Click a to-do number to open it">
        {/* Hidden while the empty state shows its own big "Create to-do" button. */}
        {openCreate && !creating && !(none && tab !== 'done') ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            + Create to-do
          </button>
        ) : null}
      </ViewHead>
      {creating ? <TodoCreate onClose={() => setCreating(false)} /> : null}
      <TabStrip
        label="My to-do"
        tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: count(t.key) }))}
        activeKey={tab}
        onChange={(k) => setTab(TABS.find((t) => t.key === k)?.key ?? tab)}
      />
      {body}
    </>
  );
}
