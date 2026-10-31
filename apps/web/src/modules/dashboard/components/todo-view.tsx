// ADR-262 — My to-do: tabs Late · Today · Planned · Done. Tick a box →
// POST /tasks/:id/complete; the row is locked while it saves, and a refusal
// (409 already done) shows the server's words and refetches. Done = today's
// done list, yesterday's under it. "Create to-do" opens the inline form.

import type { DashTodoRow, HomeResponse } from '@innovic/shared';
import { useState } from 'react';
import { useCanWrite } from '@/components/shared/action-link';
import { fmtDate, fmtTime } from '@/lib/date';
import { useToast } from '@/ui/feedback';
import { EmptyState } from '@/ui/data';
import { useCompleteTodo } from '../todo-api';
import { DashTextView, DocRef } from './dash-text';
import { TodoCreate } from './todo-create';
import { ViewHead } from './view-head';

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

function TodoLine({
  t,
  tab,
  busy,
  canWrite,
  onDone,
}: {
  t: DashTodoRow;
  tab: Exclude<Tab, 'done'>;
  busy: boolean;
  canWrite: boolean;
  onDone: () => void;
}): React.JSX.Element {
  return (
    <div className={`dh-todo${t.unread ? ' dh-unread' : ''}`} aria-busy={busy}>
      {canWrite ? (
        <input
          type="checkbox"
          checked={busy}
          disabled={busy}
          aria-label={`Mark done: ${t.title}`}
          onChange={onDone}
        />
      ) : null}
      <span className="dh-todo-code">{t.taskCode}</span>
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
  const toast = useToast();
  const complete = useCompleteTodo();
  const [creating, setCreating] = useState(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
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

  const markDone = (t: DashTodoRow): void => {
    if (busyIds.has(t.taskId)) return;
    setBusyIds((s) => new Set(s).add(t.taskId));
    complete.mutate(t.taskId, {
      // On success the row stays locked until the refetch takes it away.
      onError: (e) => {
        toast.error(e.message);
        setBusyIds((s) => {
          const n = new Set(s);
          n.delete(t.taskId);
          return n;
        });
      },
    });
  };

  const openCreate = canWrite ? () => setCreating(true) : undefined;

  let body: React.ReactNode;
  if (tab === 'done') body = <DoneLines done={done} />;
  else if (none && !creating) {
    body = (
      <EmptyState icon="☑">
        <div style={{ fontWeight: 700 }}>No to-dos yet</div>
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
    body = todo[rowsTab].map((t) => (
      <TodoLine
        key={t.taskId}
        t={t}
        tab={rowsTab}
        busy={busyIds.has(t.taskId)}
        canWrite={canWrite}
        onDone={() => markDone(t)}
      />
    ));
  }

  return (
    <>
      <ViewHead title="My to-do" hint="Tick a box when it is done">
        {/* Hidden while the empty state shows its own big "Create to-do" button. */}
        {openCreate && !creating && !(none && tab !== 'done') ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            + Create to-do
          </button>
        ) : null}
      </ViewHead>
      {creating ? <TodoCreate onClose={() => setCreating(false)} /> : null}
      <div className="dh-tabs" role="tablist" aria-label="My to-do">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label} ({count(t.key)})
          </button>
        ))}
      </div>
      {body}
    </>
  );
}
